import {customerHistory} from './referral-customer-history.mjs';
import {createHash} from 'node:crypto';
import {inspectionFacts} from './referral-hive.mjs';
import {APPROVED_REFERRAL_FULL_SERVICE_IDS} from './referral-service-catalog.mjs';
// Private server evidence records only. No public writer, no identity merging.
// Missing/expired history or consumer-role verification prevents qualification.
export function qualifiedCaseReader({store,reviewStore,readHive,now=()=>Date.now()}){
 return async useId=>{
  if(!/^HIVE-[a-zA-Z0-9_-]{1,100}$/.test(useId))throw Error('Invalid case identifier');
  const e=await store.get('qualification-inputs/'+createHash('sha256').update(useId).digest('hex'),{type:'json'});
  if(!e||e.useId!==useId||e.inspectionId!==useId.slice(5))throw Error('Verified case evidence missing');
  const i=await readHive('inspections/'+encodeURIComponent(e.inspectionId));
  if(i?.id!==e.inspectionId)throw Error('Inspection response mismatch');
  const f=inspectionFacts(i,{serviceIds:APPROVED_REFERRAL_FULL_SERVICE_IDS,now:now()});
  const fresh=e.evidenceVerified===true&&typeof e.evidenceReference==='string'&&!!e.evidenceReference.trim()&&Number.isFinite(Date.parse(e.validUntil))&&Date.parse(e.validUntil)>now();
  let storedEvent=null;
  if(typeof e.completionEventKey==='string'&&/^review-events\/[a-f0-9]{64}$/.test(e.completionEventKey)){
   const event=await reviewStore.get(e.completionEventKey,{type:'json'});
   const expected=event&&'review-events/'+createHash('sha256').update(event.organizationId+':'+event.templateId+':'+event.instanceId).digest('hex');
   if(expected===e.completionEventKey)storedEvent=event;
  }
  const history=await customerHistory({read:readHive,email:f.clientEmail,sourceContactIds:f.clientId?[f.clientId]:[],verifiedAliases:e.verifiedAliases||[],sharedEmailEvidence:e.sharedEmailEvidence,sourceConflictEvidence:e.sourceConflictEvidence,currentInspectionId:i.id,before:f.bookedAt,coverage:fresh?e.historyCoverage:{},legacyLookup:async()=>fresh?e.legacyHistory:null});
  const sameClient=e.sourceContactId===f.clientId&&String(e.email||'').trim().toLowerCase()===String(f.clientEmail||'').trim().toLowerCase();
  return {useId,identityInput:{email:f.clientEmail,sourceContactIds:history.sourceContactIds||(f.clientId?[f.clientId]:[]),verifiedAliases:e.verifiedAliases||[],sharedEmailEvidence:e.sharedEmailEvidence,sourceConflictEvidence:sameClient?e.sourceConflictEvidence:{verified:true,reference:'Current inspection identity changed'}},storedEvent,operatorEvidence:fresh?e.operatorCompletion:null,facts:{inspectionId:i.id,sourceContactId:f.clientId,clientEmail:f.clientEmail,referrerId:e.referrerId,code:e.code,bookingCreatedAt:f.bookedAt,bookingProvenanceVerified:fresh&&e.bookingProvenanceVerified===true,newCustomerVerified:fresh&&history.newClient===true,consumerReferrerVerified:fresh&&e.consumerReferrerVerified===true,codeAssociationVerified:fresh&&f.codes.length===1&&f.codes[0]===e.code&&e.codeAssociationVerified===true,distinctPeopleVerified:fresh&&e.distinctPeopleVerified===true&&String(e.referrerEmail||'').trim().toLowerCase()!==String(f.clientEmail||'').trim().toLowerCase(),fullyPaid:f.paid,active:f.canceled===false,noPriorRewardVerified:fresh&&e.noPriorRewardVerified===true,serviceIds:f.serviceIds,refundOrDispute:e.refundOrDispute===true}};
 };
}
