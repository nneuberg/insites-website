export const ROOT = '1SpgSvuae8ZQ8BEDYGDmr3_0lRF8R-cLs';
const folderType = 'application/vnd.google-apps.folder';
export class GalleryError extends Error { constructor(status, message) { super(message); this.status = status; } }
export function validId(id) { return typeof id === 'string' && /^[A-Za-z0-9_-]{10,150}$/.test(id); }
export function driveClient(apiKey, fetcher=fetch) {
  return async (path, params={}) => {
    const url = new URL(`https://www.googleapis.com/drive/v3/${path}`);
    for (const [key,value] of Object.entries(params)) if (value) url.searchParams.set(key,value);
    const response = await fetcher(url,{headers:{"X-Goog-Api-Key":apiKey},signal:AbortSignal.timeout(12000)});
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
export async function connection(env=process.env,fetcher=fetch) { if (!env.GALLERY_DRIVE_API_KEY) throw new GalleryError(503,'Gallery connection is being set up. Please check back shortly.'); return {drive:driveClient(env.GALLERY_DRIVE_API_KEY,fetcher)}; }
export function errorResponse(error) { return Response.json({error:error instanceof GalleryError?error.message:'Gallery is temporarily unavailable.'},{status:error instanceof GalleryError?error.status:503,headers:{'Cache-Control':'no-store'}}); }
