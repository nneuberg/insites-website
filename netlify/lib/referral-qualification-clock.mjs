// Local-only preparation. A verification timestamp is NOT paid_at/completed_at.
import {createHash} from 'node:crypto';
import {APPROVED_REFERRAL_FULL_SERVICE_IDS as services} from './referral-service-catalog.mjs';
const DAY=86400000;
const timestamp=v=>typeof v==='string'?Date.parse(v):NaN;
export function qualificationSnapshot({facts,previous=null,observedAt,launchCutoff}){
 const at=timestamp(observedAt),cutoff=timestamp(launchCutoff),booking=timestamp(facts?.bookingCreatedAt);
 if(!Number.isFinite(at))throw Error('Verification time required');
 if(previous&&timestamp(previous.lastVerifiedAt)>at)return {stale:true,state:previous};
 const reasons=[];const yes=(value,reason)=>{if(value!==true)reasons.push(reason)};
 if(!facts?.inspectionId||!facts?.canonicalCustomerId||!facts?.referrerId||!facts?.code)reasons.push('identity-or-attribution-missing');
 if(!Number.isFinite(cutoff)||cutoff>at||!Number.isFinite(booking)||booking<cutoff||booking>at)reasons.push('booking-cutoff-unverified');
 yes(facts?.bookingProvenanceVerified,'booking-provenance-unverified');
 yes(facts?.identityVerified,'customer-identity-unverified');
 yes(facts?.newCustomerVerified,'prior-history-unresolved-or-existing');
 yes(facts?.consumerReferrerVerified,'consumer-referrer-unverified');
 yes(facts?.codeAssociationVerified,'code-association-unverified');
 yes(facts?.distinctPeopleVerified,'self-referral-or-identity-unresolved');
 yes(facts?.fullyPaid,'full-payment-unverified');
 yes(facts?.active,'inactive-or-state-unknown');
 yes(facts?.noPriorRewardVerified,'prior-reward-unresolved');
 if(facts?.refundOrDispute===true)reasons.push('refund-or-dispute');
 if(!Array.isArray(facts?.serviceIds)||!facts.serviceIds.some(id=>services.includes(id)))reasons.push('full-service-unverified');
 const completion=facts?.completion;
 if(completion?.verified!==true||completion.inspectionId!==facts?.inspectionId||!['hive-inspection-complete','operator-verified-completion'].includes(completion.source)||typeof completion.evidenceReference!=='string'||!completion.evidenceReference.trim())reasons.push('completion-unverified');
 // Identity/attribution/booking/service change cannot inherit another case's clock.
 const binding=createHash('sha256').update(JSON.stringify([facts?.inspectionId,facts?.canonicalCustomerId,facts?.referrerId,facts?.code,facts?.bookingCreatedAt,[...new Set(Array.isArray(facts?.serviceIds)?facts.serviceIds:[])].sort(),launchCutoff])).digest('hex');
 const oldFirst=timestamp(previous?.firstQualifiedAt);
 const first=!reasons.length&&previous?.qualified===true&&previous.binding===binding&&Number.isFinite(oldFirst)&&oldFirst<=at?oldFirst:at;
 return {stale:false,state:{version:1,inspectionId:facts?.inspectionId||null,binding,qualified:!reasons.length,firstQualifiedAt:reasons.length?null:new Date(first).toISOString(),dueAt:reasons.length?null:new Date(first+DAY).toISOString(),lastVerifiedAt:observedAt,ready:!reasons.length&&at>=first+DAY,reasons}};
}
// Injected store only; no production wiring. CAS prevents stale overwrites.
export function qualificationClock({store}){
 return async ({facts,observedAt,launchCutoff})=>{
  if(typeof facts?.inspectionId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(facts.inspectionId))throw Error('Inspection identity required');
  const key='qualification/'+facts.inspectionId,old=await store.getWithMetadata(key,{type:'json'});
  const result=qualificationSnapshot({facts,observedAt,launchCutoff,previous:old?.data});
  if(result.stale)return result;
  const saved=await store.setJSON(key,result.state,old?{onlyIfMatch:old.etag}:{onlyIfNew:true});
  if(!saved.modified)throw Error('Qualification changed; re-read current evidence');
  return result;
 };
}
