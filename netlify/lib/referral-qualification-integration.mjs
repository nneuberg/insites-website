import {createHash} from 'node:crypto';
import {assessReferralIdentity} from './referral-identity-evidence.mjs';
import {qualificationSnapshot} from './referral-qualification-clock.mjs';
const ORG='7149a5c8-d349-40c6-ad3e-b0584646a6b4',TEMPLATE='66b1c688-3157-4a23-b646-487426af8e6c';
// Input ONLY from server-owned review-events store populated after HMAC/envelope checks.
// Never accept this record or manual evidence from the public claim request.
export function completionEvidence({inspectionId,storedEvent=null,operatorEvidence=null,now=Date.now()}){
 if(storedEvent?.inspectionId===inspectionId&&storedEvent.organizationId===ORG&&storedEvent.templateId===TEMPLATE&&typeof storedEvent.instanceId==='string'&&storedEvent.instanceId&&Number.isFinite(storedEvent.receivedAt)&&storedEvent.receivedAt<=now){return {verified:true,inspectionId,source:'hive-inspection-complete',evidenceReference:'review-events-instance:'+storedEvent.instanceId};}
 if(operatorEvidence?.inspectionId===inspectionId&&operatorEvidence.verified===true&&operatorEvidence.authorized===true&&operatorEvidence.reference&&Number.isFinite(Date.parse(operatorEvidence.verifiedAt))&&Date.parse(operatorEvidence.verifiedAt)<=now)return {verified:true,inspectionId,source:'operator-verified-completion',evidenceReference:operatorEvidence.reference};
 return null;
}
export function customerReservationKeys(identity){
 if(identity.status!=='usable-exact-identifier')throw Error('Customer identity unresolved');
 const values=[...identity.dedupEmails.map(e=>'email:'+e),...identity.sourceContactIds.map(id=>'hive-contact:'+id)];
 return [...new Set(values)].sort().map(v=>'referral-customer:'+createHash('sha256').update(v).digest('hex')).sort();
}
export async function verifyClaimQualification({ledger,useId,facts,identityInput,storedEvent,operatorEvidence,observedAt,launchCutoff}){
 const identity=assessReferralIdentity(identityInput),completion=completionEvidence({inspectionId:facts.inspectionId,storedEvent,operatorEvidence,now:Date.parse(observedAt)});
 // For a concrete identity conflict, use established source references only to
 // revoke readiness; never guess/merge a new customer's identity.
 if(identity.status!=='usable-exact-identifier'||!identity.sourceContactIds.includes(facts.sourceContactId)||identity.primaryEmail!==String(facts.clientEmail||'').trim().toLowerCase()){
  await ledger('holdCodeUse',{inspectionId:facts.inspectionId,reason:identity.reason||'Source identity mismatch'});return {held:true,reason:identity.reason||'Source identity mismatch'};
 }
 const keys=customerReservationKeys(identity);
 const snapshot=qualificationSnapshot({facts:{...facts,canonicalCustomerId:keys.join('|'),identityVerified:true,completion},observedAt,launchCutoff}).state;
 // The ledger sets authoritative first-qualified/verification times under ScriptLock.
 const result=await ledger('recordClaimQualification',{useId,inspectionId:facts.inspectionId,sourceContactId:facts.sourceContactId,code:facts.code,observedAt,assessment:{qualified:snapshot.qualified,binding:snapshot.binding,customerKeys:keys,completion,facts,launchCutoff}});
 return {...result,held:!snapshot.qualified,reasons:snapshot.reasons};
}

// Server composition only: readCase must fetch current authenticated evidence.
// It may return a manual completion attestation only from an authorized operator record.
// Public claim callers supply a token, never qualification facts or identity keys.
export function qualifiedLedger({ledger,readCase,launchCutoff,now=()=>new Date().toISOString()}){
 async function refresh(useId){
  let evidence;
  try{evidence=await readCase(useId);if(!evidence||evidence.useId!==useId)throw Error('Unavailable');}
  catch{if(/^HIVE-[a-zA-Z0-9_-]{1,100}$/.test(useId))await ledger('holdCodeUse',{inspectionId:useId.slice(5),reason:'Current qualification evidence unavailable; review required'});throw Error('Current qualification evidence unavailable');}
  return verifyClaimQualification({...evidence,ledger,useId,observedAt:now(),launchCutoff});
 }
 return {refresh,async call(action,args){
  if(action==='claimCandidates'){
   const page=await ledger('qualificationCandidates',args),items=[];
   for(const item of page.items){try{await refresh(item.useId);const candidate=await ledger('claimCandidate',item);if(candidate.ready)items.push(item);}catch{/* Missing evidence stays ineligible; no purchase or invitation. */}}
   return {items,next:page.next||''};
  }
  if(action==='claimCandidate'||action==='reserveClaimReward'){
   const checked=await refresh(args.useId);
   if(checked.held)throw Error('Current qualification not verified');
  }
  return ledger(action,args);
 }};
}
