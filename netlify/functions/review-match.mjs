import {runtime,response,reviewStore} from '../lib/review-runtime.mjs';
import {validToken} from '../lib/review-policy.mjs';
export default async request=>{
 const url=new URL(request.url),token=url.searchParams.get('token');if(!validToken(token))return response({error:'Invalid confirmation link'},400);
 try{
  const store=reviewStore(),match=await store.get('matches/'+token,{type:'json'});
  if(!match||Date.now()>match.expiresAt)return response({error:'Confirmation link expired or not found'},410);
  const engine=runtime(),row=await engine.get(match.requestToken);if(!row)return response({error:'Contact request not found'},404);
  if(request.method==='GET')return response({name:row.name,address:row.address,role:row.role,rating:row.rating,ratedAt:row.ratedAt,review:match.review,decided:match.decision||null});
  if(request.method!=='POST'||request.headers.get('origin')!==url.origin)return response({error:'Invalid request'},403);
  if(process.env.REVIEW_ENABLED!=='true')return response({error:'Review processing is paused'},503);
  const raw=await request.text();if(raw.length>1000)return response({error:'Invalid request'},413);
  const {decision}=JSON.parse(raw);if(!['confirm','reject'].includes(decision))return response({error:'Invalid decision'},400);
  return engine.locked('match:'+token,async()=>{
   const current=await store.get('matches/'+token,{type:'json'});
   if(current.decision){if(current.decision!==decision)return response({error:'Decision already recorded'},409);return response({saved:true});}
   if(decision==='confirm')await engine.confirmGoogle(match.requestToken,match.review);
   await store.setJSON('matches/'+token,{...current,decision,decidedAt:Date.now()});return response({saved:true});
  });
 }catch{return response({error:'Could not complete this match. Please retry.'},503);}
};
export const config={path:'/api/review-match',rateLimit:{windowLimit:20,windowSize:60,aggregateBy:['ip','domain']}};
