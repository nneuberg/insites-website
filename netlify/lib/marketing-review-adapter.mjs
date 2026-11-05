import {DAY,REMINDER_DAYS,REVIEW_CADENCE_VERSION,googleReviewTiming} from './review-policy.mjs';
import {operationId} from './marketing-admission-client.mjs';
const PROGRAMS=['review-customer-v1','review-agent-v1'];
export function createReviewAdmission({config,client,now=()=>Date.now(),work=null}){
 return{async stop(row){if(config.reviewOwnerEnabled!==true||row.isTest)return;const personId=await client.register(row.email,config.audiences,row.contactId?[row.contactId]:[]);await client.stop(personId,'review',PROGRAMS);
  if(row.cadenceVersion===REVIEW_CADENCE_VERSION&&row.googleReviewId&&Number.isSafeInteger(row.googleReviewedAt))await client.command(personId,'recordGoogleReview',{personId,proof:{verified:true,source:'confirmed_google_review',cadenceVersion:REVIEW_CADENCE_VERSION,program:row.role==='Agent'?'review-agent-v1':'review-customer-v1',reviewKey:operationId('google-review',row.googleReviewId),token:row.token,...googleReviewTiming(row)}},operationId('google-reviewed',row.token,row.googleReviewId));},async stage(row,stage){
  if(config.reviewOwnerEnabled!==true)return{held:true,reason:'shared_owner_off'};
  if(typeof row.contactId!=='string'||!/^[A-Za-z0-9-]{1,100}$/.test(row.contactId))return{held:true,reason:'source_identity_missing'};
  if((row.sentStages?.length||row.stagePrepared)&&!row.admissionOwned)return{held:true,reason:'native_history_requires_explicit_migration'};
  if(row.cadenceVersion===REVIEW_CADENCE_VERSION&&(config.reviewReferralPolicy?.enabled!==true||config.reviewReferralPolicy.version!==REVIEW_CADENCE_VERSION))return{held:true,reason:'new_cadence_policy_off'};
  const program=row.role==='Agent'?PROGRAMS[1]:PROGRAMS[0],name='s'+stage,e=config.executors[program+':'+name];
  if(config.allMarketingWritersCovered!==true||e?.verified!==true)return{held:true,reason:'shared_cutover_unverified'};
  work?.check();
  // Only an acknowledged pending stage can avoid repeat mutations. A failed
  // snapshot never falls back to register/enqueue; its outcome stays unknown.
  const ownedPending=!!work&&row.admissionOwned===true&&row.preparingStage===stage;
  const personId=ownedPending?client.identity(row.email):await client.register(row.email,config.audiences,[row.contactId]),intentId=operationId('review',row.token,name);
  if(!ownedPending){
   work?.check();
   const queued=await client.command(personId,'enqueue',{personId,intentId,program,stage:name,dueAt:Math.max(row.createdAt+(row.cadenceVersion===REVIEW_CADENCE_VERSION?REMINDER_DAYS[stage]:stage*7)*DAY,row.legacyNotBefore||0),expiresAt:row.expiresAt,context:{token:row.token,...(row.cadenceVersion===REVIEW_CADENCE_VERSION?{cadenceVersion:REVIEW_CADENCE_VERSION}:{})}} ,operationId('review-enqueue',row.token,name));
   if(queued?.superseded===true&&queued.reason==='referral_handoff')return{superseded:true};
   if(queued?.held===true)return{held:true,reason:queued.reason||'shared_enqueue_held'};
   // This acknowledges only an exact durable enqueue, never a send. The owner
   // independently verifies current stops and identity before any dispatch.
   if(work&&!work.canStart(5000)&&queued?.intentId===intentId)return{queued:true,intentId,deferred:true};
  }
  work?.check();
  const {state}=await client.snapshot(personId),intent=state.intents[intentId];
  const person=Object.values(state.people).find(p=>!p.parent);
  if(ownedPending&&person){
   const manifest=JSON.stringify({executors:config.executors,programs:config.programs||{},completionExecutor:config.completionExecutor||null,cutover:config.cutover||null,reviewReferralPolicy:config.reviewReferralPolicy||null,referralOwnerEnabled:config.referralOwnerEnabled===true});
   if(state.manifestFingerprint!==manifest)throw Error('Executor manifest change requires explicit migration');
   const root=id=>{const seen=new Set();while(state.people[id]?.parent){if(seen.has(id))return null;seen.add(id);id=state.people[id].parent;}return state.people[id]?.id;};
   const aliases=[...config.audiences.map(a=>client.memberKey(a,row.email)),'hive-contact:'+row.contactId];
   if(Object.values(state.people).filter(p=>!p.parent).length!==1||person.email!==row.email||root(personId)!==person.id||aliases.some(a=>root(state.aliases[a])!==person.id))return{held:true,reason:'shared_identity_binding_changed'};
   if(intent&&(intent.id!==intentId||intent.program!==program||intent.stage!==name||root(intent.personId)!==person.id||intent.context?.token!==row.token||intent.context?.cadenceVersion!==(row.cadenceVersion===REVIEW_CADENCE_VERSION?REVIEW_CADENCE_VERSION:undefined)))return{held:true,reason:'shared_intent_binding_changed'};
  }
  if(!person||person.stops.length||person.quarantine.length||person.programStops?.[program]?.length)return{held:true,reason:'shared_identity_or_program_hold'};
  // One-shot native campaigns cannot be silently recycled for a later inspection.
  if(!intent||intent.context?.token!==row.token)return{held:true,reason:'finite_review_executor_already_used'};
  if(intent?.state==='sent'){const p=Object.values(state.permits).find(p=>p.intentId===intent.id&&p.state==='sent');if(!p?.firstSentObservedAt)return{held:true,reason:'sent_receipt_missing'};return{sent:true,sentAt:p.firstSentObservedAt};}
  if(intent.state==='superseded'&&intent.supersededReason==='referral_handoff')return{superseded:true};
  if(!intent||['held','cancelled','expired','no_send','skipped','superseded'].includes(intent.state))return{held:true,reason:'shared_intent_terminal'};
  const attempt=Object.values(state.permits).find(p=>p.intentId===intent.id&&p.state==='attempted');if(attempt&&(attempt.receiptPolls||0)>=2)return{held:true,reason:'shared_attempt_uncertain'};
  return{queued:true,intentId:intent.id};
 }};
}
