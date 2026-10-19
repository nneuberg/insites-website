import {getStore} from '@netlify/blobs';
import {testRuntime} from '../lib/review-test-fixture.mjs';
import {runtime,response} from '../lib/review-runtime.mjs';
import {validToken} from '../lib/review-policy.mjs';
export default async(request,context)=>{
 const url=new URL(request.url),token=url.searchParams.get('token');
 if(!validToken(token))return response({error:'This review link is invalid.'},400);
 const engine=await testRuntime(token,()=>getStore({name:'insites-isolated-review-test-20261019',consistency:'strong'}))||runtime(context);
 try{
  if(request.method==='GET'){
   const row=await engine.get(token);if(!row)return response({error:'This review link was not found.'},404);
   if(Date.now()>=row.expiresAt)return response({error:'This review link has expired.'},410);
   return response({name:row.name.split(' ')[0],address:row.address,rated:!!row.ratedAt});
  }
  if(request.method!=='POST')return response({error:'Method not allowed'},405);
  if(request.headers.get('origin')!==url.origin)return response({error:'Invalid request origin'},403);
  const raw=await request.text();if(raw.length>8000)return response({error:'Feedback is too long'},413);
  const input=JSON.parse(raw);return response(await engine.feedback(token,{rating:input.rating,feedback:input.feedback??''}));
 }catch{return response({error:'Unable to process this feedback. Please retry shortly.'},503);}
};
export const config={path:'/api/review-feedback',rateLimit:{windowLimit:20,windowSize:60,aggregateBy:['ip','domain']}};
