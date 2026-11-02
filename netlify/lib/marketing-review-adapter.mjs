import {operationId} from './marketing-admission-client.mjs';
const PROGRAMS=['review-customer-v1','review-agent-v1'];
export function createReviewAdmission({config,client,now=()=>Date.now()}){
 return{async stop(row){if(config.reviewOwnerEnabled!==true||row.isTest)return;const personId=await client.register(row.email,config.audiences,row.contactId?[row.contactId]:[]);await client.stop(personId,'review',PROGRAMS);},async stage(row,stage){
  if(config.reviewOwnerEnabled!==true)return{held:true,reason:'shared_owner_off'};
  if(typeof row.contactId!=='string'||!/^[A-Za-z0-9-]{1,100}$/.test(row.contactId))return{held:true,reason:'source_identity_missing'};
  if((row.sentStages?.length||row.stagePrepared)&&!row.admissionOwned)return{held:true,reason:'native_history_requires_explicit_migration'};
  const program=row.role==='Agent'?PROGRAMS[1]:PROGRAMS[0],name='s'+stage,e=config.executors[program+':'+name];
  if(config.allMarketingWritersCovered!==true||e?.verified!==true)return{held:true,reason:'shared_cutover_unverified'};
  const personId=await client.register(row.email,config.audiences,row.contactId?[row.contactId]:[]),intentId=operationId('review',row.token,name);
  const queued=await client.command(personId,'enqueue',{personId,intentId,program,stage:name,dueAt:Math.max(row.createdAt+stage*7*86400000,row.legacyNotBefore||0),expiresAt:row.expiresAt,context:{token:row.token}} ,operationId('review-enqueue',row.token,name));
  if(queued?.held===true)return{held:true,reason:queued.reason||'shared_enqueue_held'};
  const {state}=await client.snapshot(personId),intent=state.intents[intentId];
  const person=Object.values(state.people).find(p=>!p.parent);
  if(!person||person.stops.length||person.quarantine.length||person.programStops?.[program]?.length)return{held:true,reason:'shared_identity_or_program_hold'};
  // One-shot native campaigns cannot be silently recycled for a later inspection.
  if(!intent||intent.context?.token!==row.token)return{held:true,reason:'finite_review_executor_already_used'};
  if(intent?.state==='sent'){const p=Object.values(state.permits).find(p=>p.intentId===intent.id&&p.state==='sent');if(!p?.firstSentObservedAt)return{held:true,reason:'sent_receipt_missing'};return{sent:true,sentAt:p.firstSentObservedAt};}
  if(!intent||['held','cancelled','expired','no_send','skipped'].includes(intent.state))return{held:true,reason:'shared_intent_terminal'};
  const attempt=Object.values(state.permits).find(p=>p.intentId===intent.id&&p.state==='attempted');if(attempt&&(attempt.receiptPolls||0)>=2)return{held:true,reason:'shared_attempt_uncertain'};
  return{queued:true,intentId:intent.id};
 }};
}
