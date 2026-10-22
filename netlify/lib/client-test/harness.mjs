import {createEngine} from './lib/review-engine.mjs';
import {clientProviderGuard,CLIENT_SCOPE as S} from './provider-guard.mjs';
export {CLIENT_SCOPE as SCOPE} from './provider-guard.mjs';
export function createClientHarness({storeFactory,transport,env,permit,now=Date.now}){
 const store=storeFactory(S.store);
 const live=async()=>{if(env.REVIEW_ENABLED==='true'||permit.enabled!==true||!permit.journeyVerified||permit.journeyId!==9528||now()<permit.startsAt||now()>=permit.expiresAt||await store.get('safety/stopped',{type:'json'}))throw Error('Client test unavailable');};
 const guard=clientProviderGuard({store,transport,dc:env.MAILCHIMP_API_KEY?.split('-').at(-1),permit,now});
 const fetcher=async(raw,opt={})=>{
  await live();let body=opt.body?JSON.parse(opt.body):null;
  if(body?.merge_fields?.REVLINK){
   const m=body.merge_fields.REVLINK.match(/^https:\/\/www\.insites\.services\/review\/r\/([a-f0-9]{48})$/);
   if(!m)throw Error('Invalid test link');await row(m[1]);
   body.merge_fields.REVLINK='https://www.insites.services/review-client-test/'+m[1];
   opt={...opt,body:JSON.stringify(body)};
  }
  return guard(raw,opt);
 };
 const engine=createEngine({store,fetcher,now,env:{HIVE_API_KEY:env.HIVE_API_KEY,MAILCHIMP_API_KEY:env.MAILCHIMP_API_KEY,REVIEW_ENABLED:'true',REVIEW_START_AFTER:new Date(permit.startsAt-60000).toISOString()}});
 async function row(token){await live();if(!/^[a-f0-9]{48}$/.test(token||''))throw Error('Invalid token');const r=await engine.get(token);if(!r||r.role!=='Customer'||r.email!==S.email||r.contactId!==S.hiveId||r.inspectionId!=='SYNTHETIC-CLIENT-20261022'||r.address!==S.address||r.isTest)throw Error('Invalid test record');return r;}
 async function onlyRow(){const rows=[];for await(const p of store.list({prefix:'requests/',paginate:true}))for(const b of p.blobs)rows.push(await store.get(b.key,{type:'json'}));if(rows.length!==1)throw Error('Expected one test record');return row(rows[0].token);}
 return {
  async begin(){
   await live();
   const hc=await engine.hive('contacts/'+S.hiveId);
   if((hc.email||'').toLowerCase()!==S.email||JSON.stringify((hc.tags||[]).map(t=>t.name).sort())!==JSON.stringify(['client'])||hc.roles?.some(r=>['Buyer Agent','Seller Agent','Listing Agent','Agent'].includes(r)))throw Error('Hive baseline changed');
   const member=await engine.mc({role:'Customer',email:S.email},undefined,'GET');
   if(member.email_address?.toLowerCase()!==S.email||member.status!=='subscribed'||JSON.stringify((member.tags||[]).map(t=>t.name).sort())!==JSON.stringify(['client'])||member.merge_fields.REVLINK||member.merge_fields.REVADDR||member.merge_fields.REVREF2||member.merge_fields.REVREF6)throw Error('Mailchimp baseline changed');
   const held=await store.setJSON('safety/begin',{attemptedAt:now()},{onlyIfNew:true});if(!held.modified)throw Error('Begin already attempted; reconcile first');
   await engine.enroll({id:'SYNTHETIC-CLIENT-20261022',confirmed:true,ends_at:new Date(permit.startsAt).toISOString(),price:{paid:true,amount_due:0},agreements:{all_signed:true},reports:{status:'published'},address:{full:S.address},contacts:[{id:S.hiveId,email:S.email,first_name:'TEST ONLY',last_name:'Review Client',role:'Customer'}]});
   const r=await onlyRow();await engine.process(r.token);await store.setJSON('evidence/begin',{token:r.token,at:now()});return {begun:true};
  },
  async details(token){const r=await row(token);return {name:'TEST ONLY',address:r.address,rated:!!r.ratedAt,rating:r.rating??null,feedback:r.feedback||'',revision:r.feedbackRevision||(r.ratedAt?1:0)};},
  async feedback(token,input){await row(token);return engine.feedback(token,input);},
  async complete(){
   await live();const r=await onlyRow();if(!r.ratedAt||r.feedbackRevision!==2||r.rating!==4)throw Error('Expected completed feedback and edit first');
   await engine.process(r.token);const after=await row(r.token);if(!after.endedAt||!after.finishSynced)throw Error('Reminder suppression incomplete');
   const review={reviewId:'SYNTHETIC-CLIENT-20261022',reviewer:{displayName:'TEST ONLY Review Client'},starRating:'FIVE',comment:'Synthetic test only; not a public Google review.'};
   await engine.confirmGoogle(r.token,review);await engine.confirmGoogle(r.token,review);
   const final=await row(r.token);if(!final.hiveTagSynced||!final.finishSynced||final.sentStages.length!==1)throw Error('Completion incomplete');
   const result={confirmed:true,feedbackRevision:final.feedbackRevision,remindersSuppressed:true,sentStages:final.sentStages,referralDatesCaptured:await store.get('evidence/referral-dates',{type:'json'})};await store.setJSON('evidence/completed',result);return result;
  },
  async stop(){await store.setJSON('safety/stopped',{at:now()});return {stopped:true};}
 };
}
