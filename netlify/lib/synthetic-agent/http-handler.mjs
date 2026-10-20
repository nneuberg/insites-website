import {SCOPE} from './harness.mjs';
// Framework-neutral adapter. No endpoint can seed, enroll, send a notice, or invoke run().
// Those operator steps remain explicit server-side calls after a separate execution approval.
export function createHandler(harness){
 const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'};
 const json=(v,status=200)=>Response.json(v,{status,headers});
 return async request=>{
  const url=new URL(request.url);if(url.origin!==SCOPE.origin)return json({error:'Wrong origin'},403);
  if(!['GET','POST'].includes(request.method))return json({error:'Method not allowed'},405);
  if(request.method==='POST'&&request.headers.get('origin')!==SCOPE.origin)return json({error:'Invalid origin'},403);
  const pathMatch=url.pathname.match(/^\/(review-synthetic|review-synthetic-match)\/([a-f0-9]{48})$/);
  if(pathMatch&&request.method==='GET'){const q=new URLSearchParams({token:pathMatch[2]});if(pathMatch[1]==='review-synthetic'&&/^[1-5]$/.test(url.searchParams.get('rating')||''))q.set('rating',url.searchParams.get('rating'));return new Response(null,{status:302,headers:{...headers,Location:'/'+pathMatch[1]+'/?'+q}});}
  const token=url.searchParams.get('token');if(!/^[a-f0-9]{48}$/.test(token||''))return json({error:'Invalid token'},400);
  try{
   if(url.pathname===SCOPE.path+'/feedback'){
    if(request.method==='GET')return json(await harness.details(token));
    const text=await request.text();if(text.length>8000)return json({error:'Too large'},413);
    let body;try{body=JSON.parse(text)}catch{return json({error:'Invalid JSON'},400)}
    if(!body||!Number.isInteger(body.rating)||body.rating<1||body.rating>5||typeof body.feedback!=='string'||body.feedback.length>4000||!Number.isInteger(body.revision)||body.revision<0)return json({error:'Invalid feedback'},400);
    return json(await harness.feedback(token,body));
   }
   if(url.pathname===SCOPE.path+'/match')return json(request.method==='GET'?await harness.match(token):await harness.confirm(token));
   return json({error:'Not found'},404);
  }catch(e){return json({error:e.status===409?e.message:'Synthetic test unavailable'},e.status===409?409:503)}
 };
}
