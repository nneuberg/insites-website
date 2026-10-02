import {validateSubmission} from '../lib/referral-core.mjs';
import {ledger,json} from '../lib/referral-transport.mjs';

export function normalizePublicForm(input){
 const accepted=input.permissionAndTerms==='accepted';
 return validateSubmission({...input,idempotencyKey:input.referralId,
  eligibility:input.eligibility==='confirmed',permission:accepted,terms:accepted});
}
export function createHandler(callLedger=ledger,env=process.env){return async request=>{
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 const origins=['https://www.insites.services','https://insites.services',env.REFERRAL_PREVIEW_ORIGIN].filter(Boolean);
 if(!origins.includes(request.headers.get('origin')))return json({error:'Forbidden'},403);
 const raw=await request.text();if(raw.length>4096)return json({error:'Too large'},413);
 let data;try{
  const type=request.headers.get('content-type')||'';
  const input=type.includes('application/json')?JSON.parse(raw):Object.fromEntries(new URLSearchParams(raw));
  if(input.company)return json({ok:true},202);
  data=normalizePublicForm(input);
 }catch{return json({error:'Check the form fields and acknowledgements'},400);}
 if(env.REFERRAL_FORM_ENABLED!=='true')return json({error:'Referral intake is not connected yet'},503);
 try{await callLedger('submit',{...data,eligibility:true,permission:true,terms:true});return json({ok:true},202);}
 catch{return json({error:'Unable to record referral'},503);}
};}
export default createHandler();
export const config={rateLimit:{windowLimit:10,windowSize:60,aggregateBy:['ip','domain']}};
