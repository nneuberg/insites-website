import { createSign } from 'node:crypto';
export const ROOT = '1SpgSvuae8ZQ8BEDYGDmr3_0lRF8R-cLs';
const folderType = 'application/vnd.google-apps.folder';
export class GalleryError extends Error { constructor(status, message) { super(message); this.status = status; } }
export function validId(id) { return typeof id === 'string' && /^[A-Za-z0-9_-]{10,150}$/.test(id); }
let cachedToken;
async function token(env, fetcher) {
  if (!env.GALLERY_SERVICE_ACCOUNT_EMAIL || !env.GALLERY_SERVICE_ACCOUNT_PRIVATE_KEY) throw new GalleryError(503, 'Gallery connection is being set up. Please check back shortly.');
  if (cachedToken?.email === env.GALLERY_SERVICE_ACCOUNT_EMAIL && cachedToken.expires > Date.now()) return cachedToken.value;
  const now = Math.floor(Date.now()/1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({alg:'RS256',typ:'JWT'})}.${encode({iss:env.GALLERY_SERVICE_ACCOUNT_EMAIL,scope:'https://www.googleapis.com/auth/drive.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600})}`;
  const signer = createSign('RSA-SHA256'); signer.update(unsigned);
  const assertion = `${unsigned}.${signer.sign(env.GALLERY_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g,'\n'),'base64url')}`;
  const response = await fetcher('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(10000)});
  if (!response.ok) throw new GalleryError(503,'Gallery connection is temporarily unavailable.');
  const result = await response.json();
  if (!result.access_token) throw new GalleryError(503,'Gallery connection is temporarily unavailable.');
  cachedToken = {email:env.GALLERY_SERVICE_ACCOUNT_EMAIL,value:result.access_token,expires:Date.now()+(result.expires_in-60)*1000};
  return result.access_token;
}
export function driveClient(accessToken, fetcher=fetch) {
  return async (path, params={}) => {
    const url = new URL(`https://www.googleapis.com/drive/v3/${path}`);
    for (const [key,value] of Object.entries(params)) if (value) url.searchParams.set(key,value);
    const response = await fetcher(url,{headers:{Authorization:`Bearer ${accessToken}`},signal:AbortSignal.timeout(12000)});
    if (!response.ok) throw new GalleryError(response.status===404?404:503,response.status===404?'Album or photo no longer available.':'Photos are temporarily unavailable. Please try again.');
    return response.json();
  };
}
export async function checkAlbum(drive,id) {
  if (!validId(id)) throw new GalleryError(400,'Invalid album.');
  const album = await drive(`files/${id}`,{fields:'id,name,mimeType,parents,trashed',supportsAllDrives:'true'});
  if (album.trashed || album.mimeType!==folderType || !album.parents?.includes(ROOT) || album.name.startsWith('_')) throw new GalleryError(404,'Album not found.');
  return album;
}
export async function listGallery(drive,albumId,cursor) {
  if (cursor && cursor.length>2048) throw new GalleryError(400,'Invalid page.');
  const album = albumId ? await checkAlbum(drive,albumId) : null;
  const parent = albumId || ROOT;
  const kind = album ? "mimeType contains 'image/'" : `mimeType = '${folderType}'`;
  const data = await drive('files',{q:`'${parent}' in parents and trashed = false and (${kind})`,fields:'nextPageToken,incompleteSearch,files(id,name,mimeType,createdTime)',pageSize:'24',pageToken:cursor,orderBy:album?'name_natural':'createdTime desc',supportsAllDrives:'true',includeItemsFromAllDrives:'true'});
  if (data.incompleteSearch) throw new GalleryError(503,'Google Drive could not finish loading the gallery. Please retry.');
  return {album:album&&{id:album.id,name:album.name},items:data.files.filter(x=>!x.name.startsWith('_')).map(x=>({id:x.id,name:x.name,createdTime:x.createdTime,imageUrl:album?`/.netlify/functions/gallery-image?album=${album.id}&photo=${x.id}`:`/.netlify/functions/gallery-image?album=${x.id}`})),nextPageToken:data.nextPageToken||null};
}
export async function imageMetadata(drive,albumId,photoId) {
  await checkAlbum(drive,albumId);
  if (photoId) {
    if (!validId(photoId)) throw new GalleryError(400,'Invalid photo.');
    const photo = await drive(`files/${photoId}`,{fields:'id,name,mimeType,parents,trashed,thumbnailLink',supportsAllDrives:'true'});
    if (photo.trashed || !photo.parents?.includes(albumId) || !photo.mimeType.startsWith('image/') || photo.name.startsWith('_')) throw new GalleryError(404,'Photo not found.');
    return photo;
  }
  const data = await drive('files',{q:`'${albumId}' in parents and trashed = false and mimeType contains 'image/'`,fields:'nextPageToken,files(id,name,mimeType,thumbnailLink)',pageSize:'100',orderBy:'name_natural',supportsAllDrives:'true',includeItemsFromAllDrives:'true'});
  const photo = data.files.find(x=>!x.name.startsWith('_'));
  if (!photo) throw new GalleryError(404,'No album cover available.');
  return photo;
}
export async function connection(env=process.env,fetcher=fetch) { const accessToken=await token(env,fetcher); return {accessToken,drive:driveClient(accessToken,fetcher)}; }
export function errorResponse(error) { return Response.json({error:error instanceof GalleryError?error.message:'Gallery is temporarily unavailable.'},{status:error instanceof GalleryError?error.status:503,headers:{'Cache-Control':'no-store'}}); }
