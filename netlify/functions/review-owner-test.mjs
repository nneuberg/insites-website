import {randomBytes} from 'node:crypto';
import {runtime,reviewStore,response} from '../lib/review-runtime.mjs';
import {DAY,ORIGIN,dueStage,escapeHTML} from '../lib/review-policy.mjs';
const EMAIL='neal@insites.services',KEY='owner-test-2026-10-13';
export async function runOwnerTest({engine,store,env=process.env,fetcher=fetch,now=()=>Date.now()}){
 if(env.CONTEXT!=='production'||env.REVIEW_ENABLED==='true'||now()>Date.parse('2026-10-15T00:00:00Z'))return {skipped:true};
 if(!env.RESEND_API_KEY)throw Error('Test sender unavailable');
 return engine.locked(KEY,async()=>{
  let state=await store.get(KEY,{type:'json'});
  if(!state){state={token:randomBytes(24).toString('hex'),createdAt:now()};await store.setJSON(KEY,state);}
  let row=await engine.get(state.token);
  if(!row){row={token:state.token,email:EMAIL,name:'Neal Neuberger',role:'Customer',address:'InSites test inspection',isTest:true,createdAt:state.createdAt,expiresAt:state.createdAt+14*DAY,sentStages:[0]};await engine.save(row);}
  if(!state.sent&&now()-state.createdAt>23*60*60*1000)return {expired:true};
  if(row.email!==EMAIL||!row.isTest)throw Error('Invalid owner test');
  if(state.sent){
   if(row.ratedAt){await engine.process(row.token);const member=await engine.mc(row,undefined,'GET');return {sent:true,feedbackSaved:true,remindersStopped:dueStage(row,now())===null&&!member.tags?.some(t=>t.name==='REVIEW:PENDING'),feedbackTag:!!member.tags?.some(t=>t.name==='feedback received')};}
   return {sent:true,awaitingFeedback:true};
  }
  let member;
  try{member=await engine.mc(row,undefined,'GET');}catch(error){if(error.status!==404)throw error;member=await engine.mc(row,{email_address:EMAIL,status_if_new:'subscribed',merge_fields:{FNAME:'Neal',LNAME:'Neuberger'}},'PUT');}
  if(member.status!=='subscribed')throw Error('Owner test contact is not subscribed');
  // Customer review journeys remain drafts during this test.
  await engine.mc(row,{merge_fields:{REVLINK:ORIGIN+'/review/r/'+row.token,REVADDR:row.address}});
  await engine.mc(row,{tags:[{name:'REVIEW:PENDING',status:'active'}]},'POST','/tags');
  const dc=env.MAILCHIMP_API_KEY?.split('-').at(-1);
  if(!/^us\d+$/.test(dc||''))throw Error('Mailchimp unavailable');
  const original=await fetcher('https://'+dc+'.api.mailchimp.com/3.0/campaigns/26f1192525/content',{headers:{Authorization:'Basic '+Buffer.from('insites:'+env.MAILCHIMP_API_KEY).toString('base64')},signal:AbortSignal.timeout(12000)});
  if(!original.ok)throw Error('Saved review email unavailable');
  const content=await original.json();
  if(!content.html?.includes('*|REVLINK|*'))throw Error('Review email needs valid link fields');
  const substitutions={'*|FNAME|*':'Neal','*|REVADDR|*':escapeHTML(row.address),'*|REVLINK|*':ORIGIN+'/review/r/'+row.token,'*|LIST:ADDRESS|*':'InSites Inspection Services<br>1140 Trumbull Ave SE<br>Warren, OH 44484 USA','*|UPDATE_PROFILE|*':'mailto:neal@insites.services','*|UNSUB|*':'mailto:neal@insites.services?subject=Stop%20test%20emails'};
  let html=content.html;
  for(const [key,value] of Object.entries(substitutions))html=html.replaceAll(key,value);
  if(html.includes('*|'))throw Error('Unresolved email field');
  const sent=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':KEY},body:JSON.stringify({from:'InSites Reviews <neal@insites.services>',to:[EMAIL],subject:'[Working test] How was your inspection?',html}),signal:AbortSignal.timeout(12000)});
  if(!sent.ok)throw Error('Owner test email unavailable');
  state.sent=true;state.sentAt=now();await store.setJSON(KEY,state);return {sent:true,awaitingFeedback:true};
 });
}
export default async()=>{
 try{const result=await runOwnerTest({engine:runtime(),store:reviewStore()});console.log('Owner review test',JSON.stringify(result));return response(result);}
 catch(error){console.error('Owner review test requires retry:',error.message);return response({error:'Owner test requires retry'},503);}
};
export const config={schedule:'*/5 * * * *'};
