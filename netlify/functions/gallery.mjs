import { connection, listGallery, errorResponse } from '../lib/gallery-drive.mjs';
export default async function(request) {
  if(request.method!=='GET') return new Response(null,{status:405,headers:{Allow:'GET'}});
  try { const url=new URL(request.url); const {drive}=await connection(); return Response.json(await listGallery(drive,url.searchParams.get('album'),url.searchParams.get('cursor')),{headers:{'Cache-Control':'no-store'}}); }
  catch(error) { return errorResponse(error); }
}
