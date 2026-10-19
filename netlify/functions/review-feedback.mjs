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
   return response({name:row.name.split(' ')[0],address:row.address,rated:!!row.ratedAt,rating:row.rating??null,feedback:row.feedback??'',revision:row.ratedAt?(row.feedbackRevision||1):0});
  }
  if(request.method!=='POST')return response({error:'Method not allowed'},405);
  if(request.headers.get('origin')!==url.origin)return response({error:'Invalid request origin'},403);
  const raw=await request.text();if(raw.length>8000)return response({error:'Feedback is too long'},413);
  let input;try{input=JSON.parse(raw);}catch{return response({error:'Invalid feedback. Please check your rating and comment.'},400);}
  if(!input||!Number.isInteger(input.rating)||input.rating<1||input.rating>5||typeof input.feedback!=='string'||input.feedback.length>4000||!Number.isInteger(input.revision)||input.revision<0)return response({error:'Invalid feedback. Please check your rating and comment.'},400);
  return response(await engine.feedback(token,input));
 }catch(e){
  if(e.status===409)return response({error:e.message},409);
  if(e.message==='Review link expired')return response({error:'This review link has expired.'},410);
  if(e.message==='Review processing is paused')return response({error:'Feedback is temporarily paused. Your changes have not been saved.'},503);
  return response({error:'Unable to process this feedback. Please retry shortly.'},503);
 }
};
export const config={path:'/api/review-feedback',rateLimit:{windowLimit:20,windowSize:60,aggregateBy:['ip','domain']}};
