import { connection, imageMetadata, errorResponse, GalleryError } from '../lib/gallery-drive.mjs';
export default async function(request) {
  if(request.method!=='GET') return new Response(null,{status:405,headers:{Allow:'GET'}});
  try {
    const url=new URL(request.url); const {drive}=await connection();
    const photo=await imageMetadata(drive,url.searchParams.get('album'),url.searchParams.get('photo'));
    if(!photo.thumbnailLink) throw new GalleryError(404,'Photo preview is not ready.');
    const upstream=new URL(photo.thumbnailLink);
    if(upstream.protocol!=='https:' || !(upstream.hostname.endsWith('.googleusercontent.com') || upstream.hostname==='googleusercontent.com')) throw new GalleryError(503,'Photo preview unavailable.');
    // Drive thumbnails are short-lived; resolve them on every request rather than store URLs.
    upstream.href=upstream.href.replace(/=s\d+$/,url.searchParams.get('large')==='1'?'=s1600':'=s640');
    const response=await fetch(upstream,{signal:AbortSignal.timeout(12000)});
    const type=response.headers.get('content-type')||'';
    if(!response.ok || !type.startsWith('image/') || type.includes('svg')) throw new GalleryError(503,'Photo preview unavailable.');
    return new Response(response.body,{headers:{'Content-Type':type,'Cache-Control':'private, max-age=60','X-Content-Type-Options':'nosniff'}});
  } catch(error) { return errorResponse(error); }
}
