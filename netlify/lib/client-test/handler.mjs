export function createHandler(harness){
 const origin='https://www.insites.services',headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex,nofollow'};
 const json=(v,status=200)=>Response.json(v,{status,headers});
 return async request=>{
  const u=new URL(request.url);if(u.origin!==origin)return json({error:'Wrong origin'},403);
  if(!['GET','POST'].includes(request.method))return json({error:'Method not allowed'},405);
  if(request.method==='POST'&&request.headers.get('origin')!==origin)return json({error:'Invalid origin'},403);
  const link=u.pathname.match(/^\/review-client-test\/([a-f0-9]{48})$/);
  if(link&&request.method==='GET'){const q=new URLSearchParams({token:link[1]});if(/^[1-5]$/.test(u.searchParams.get('rating')||''))q.set('rating',u.searchParams.get('rating'));return new Response(null,{status:302,headers:{...headers,Location:'/review-client-test/?'+q}});}
  if(u.pathname!=='/api/review-client-test/feedback')return json({error:'Not found'},404);
  const token=u.searchParams.get('token');if(!/^[a-f0-9]{48}$/.test(token||''))return json({error:'Invalid token'},400);
  try{
   if(request.method==='GET')return json(await harness.details(token));
   const raw=await request.text();if(raw.length>8000)return json({error:'Too large'},413);
   let b;try{b=JSON.parse(raw)}catch{return json({error:'Invalid JSON'},400)}
   if(!b||!Number.isInteger(b.rating)||b.rating<1||b.rating>5||typeof b.feedback!=='string'||b.feedback.length>4000||!Number.isInteger(b.revision)||b.revision<0)return json({error:'Invalid feedback'},400);
   return json(await harness.feedback(token,b));
  }catch(e){return json({error:e.status===409?e.message:'Client test unavailable'},e.status===409?409:503)}
 };
}
