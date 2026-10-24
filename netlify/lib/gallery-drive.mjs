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
export async function inParent(drive,parent,file) {
  // Public Drive metadata can omit parents. Verify membership through the parent's listing.
  const escaped=file.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  let cursor;
  for(let page=0;page<10;page++){
    const result=await drive('files',{q:`'${parent}' in parents and trashed = false and name = '${escaped}'`,fields:'nextPageToken,files(id)',pageSize:'1000',pageToken:cursor,supportsAllDrives:'true',includeItemsFromAllDrives:'true'});
    if(result.files?.some(row=>row.id===file.id))return true;
    if(!result.nextPageToken)return false;
    cursor=result.nextPageToken;
  }
  throw new GalleryError(503,'Folder verification is temporarily unavailable.');
}
export async function checkAlbum(drive,id) {
  if (!validId(id)) throw new GalleryError(400,'Invalid album.');
  const album = await drive(`files/${id}`,{fields:'id,name,mimeType,parents,trashed',supportsAllDrives:'true'});
  if (album.trashed || album.mimeType!==folderType || album.name.startsWith('_') || !await inParent(drive,ROOT,album)) throw new GalleryError(404,'Album not found.');
  return album;
}
// Walk past hidden files and empty intermediate pages. Only publish albums
// containing photos with a usable Drive preview.
export async function firstGalleryPhoto(drive,albumId) {
  let cursor;
  for(let page=0;page<10;page++){
    const data=await drive('files',{q:`'${albumId}' in parents and trashed = false and mimeType contains 'image/'`,fields:'nextPageToken,incompleteSearch,files(id,name,mimeType,thumbnailLink)',pageSize:'100',pageToken:cursor,orderBy:'name_natural',supportsAllDrives:'true',includeItemsFromAllDrives:'true'});
    if(data.incompleteSearch)throw new GalleryError(503,'Album photo search is temporarily unavailable.');
    const photo=(data.files||[]).find(x=>!x.name.startsWith('_')&&x.thumbnailLink);
    if(photo)return photo;
    if(!data.nextPageToken)return null;
    cursor=data.nextPageToken;
  }
  throw new GalleryError(503,'Album photo search is temporarily unavailable.');
}
export async function listGallery(drive,albumId,cursor) {
  if (cursor && cursor.length>2048) throw new GalleryError(400,'Invalid page.');
  const album = albumId ? await checkAlbum(drive,albumId) : null;
  const parent = albumId || ROOT;
  const kind = album ? "mimeType contains 'image/'" : `mimeType = '${folderType}'`;
  const data = await drive('files',{q:`'${parent}' in parents and trashed = false and (${kind})`,fields:'nextPageToken,incompleteSearch,files(id,name,mimeType,createdTime)',pageSize:'24',pageToken:cursor,orderBy:album?'name_natural':'createdTime desc',supportsAllDrives:'true',includeItemsFromAllDrives:'true'});
  if (data.incompleteSearch) throw new GalleryError(503,'Google Drive could not finish loading the gallery. Please retry.');
  let visible=data.files.filter(x=>!x.name.startsWith('_'));
  if(!album){
    // Bound upstream concurrency while keeping the Drive page cursor intact.
    const publishable=new Set();let index=0;
    await Promise.all(Array.from({length:Math.min(4,visible.length)},async()=>{
      while(index<visible.length){const candidate=visible[index++];if(await firstGalleryPhoto(drive,candidate.id))publishable.add(candidate.id);}
    }));
    visible=visible.filter(x=>publishable.has(x.id));
  }
  return {album:album&&{id:album.id,name:album.name},items:visible.map(x=>({id:x.id,name:x.name,createdTime:x.createdTime,imageUrl:album?`/.netlify/functions/gallery-image?album=${album.id}&photo=${x.id}`:`/.netlify/functions/gallery-image?album=${x.id}`})),nextPageToken:data.nextPageToken||null};
}

export function frontNameScore(name) {
  if (typeof name !== 'string' || name.startsWith('_')) return 0;
  const words=name.replace(/\.[^.]+$/,'').replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  if (!/\bfront(?:\d+)?\b/.test(words) || /\b(back|rear|interior|inside|door|porch|detail|yard|garden)\b/.test(words)) return 0;
  if (/^front(?:\d+)?(?: \d+)*$/.test(words)) return 3;
  if (/\b(house|home|exterior|elevation|facade|view)\b/.test(words)) return 2;
  return 1;
}
export async function namedFrontCover(drive,albumId) {
  let cursor, best, score=0;
  for(let page=0;page<10;page++){
    const data=await drive('files',{q:`'${albumId}' in parents and trashed = false and mimeType contains 'image/'`,fields:'nextPageToken,incompleteSearch,files(id,name,mimeType,thumbnailLink)',pageSize:'1000',pageToken:cursor,orderBy:'name_natural',supportsAllDrives:'true',includeItemsFromAllDrives:'true'});
    if(data.incompleteSearch)throw new GalleryError(503,'Album cover search is temporarily unavailable.');
    for(const photo of data.files||[]){const rank=frontNameScore(photo.name);if(rank>score){best=photo;score=rank;}}
    if(!data.nextPageToken)return best;
    cursor=data.nextPageToken;
  }
  throw new GalleryError(503,'Album cover search is temporarily unavailable.');
}

export async function imageMetadata(drive,albumId,photoId) {
  await checkAlbum(drive,albumId);
  if (!photoId) { const named=await namedFrontCover(drive,albumId); if(named?.thumbnailLink)return named; }
  if(!photoId&&process.env.GALLERY_AI_ENABLED==='true'){
    const {getStore}=await import('@netlify/blobs');
    const cover=await getStore({name:'gallery-front-covers',consistency:'strong'}).get('album/'+albumId,{type:'json'});
    photoId=cover?.best?.photoId;
    // Recognition enhances covers; pending/missing results must not break them.
  }
  if (photoId) {
    if (!validId(photoId)) throw new GalleryError(400,'Invalid photo.');
    const photo = await drive(`files/${photoId}`,{fields:'id,name,mimeType,parents,trashed,thumbnailLink',supportsAllDrives:'true'});
    if (photo.trashed || !photo.mimeType.startsWith('image/') || photo.name.startsWith('_') || !await inParent(drive,albumId,photo)) throw new GalleryError(404,'Photo not found.');
    return photo;
  }
  const photo = await firstGalleryPhoto(drive,albumId);
  if (!photo) throw new GalleryError(404,'No album cover available.');
  return photo;
}
export async function connection(env=process.env,fetcher=fetch) { if (!env.GALLERY_DRIVE_API_KEY) throw new GalleryError(503,'Gallery connection is being set up. Please check back shortly.'); return {drive:driveClient(env.GALLERY_DRIVE_API_KEY,fetcher)}; }
export function errorResponse(error) { return Response.json({error:error instanceof GalleryError?error.message:'Gallery is temporarily unavailable.'},{status:error instanceof GalleryError?error.status:503,headers:{'Cache-Control':'no-store'}}); }
