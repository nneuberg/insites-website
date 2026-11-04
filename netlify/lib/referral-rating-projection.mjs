// OFF candidate. No production caller, credentials, scheduler, or provider adapter.
// A marker is only a projection; it is NEVER a dispatch capability.
import {createHash} from 'node:crypto';
import {referralRatingEligibility} from './referral-rating-eligibility.mjs';
import {AUDIENCES,REVIEW_CADENCE_VERSION} from './review-policy.mjs';
export const REFERRAL_RATING_PROJECTION = Object.freeze({enabled:false,interestId:null,nativeGuardVerified:false,exclusiveWriterVerified:false});
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fresh=(t,n)=>Number.isSafeInteger(t)&&t>0&&t<=n&&n-t<=60000;
const validBinding=b=>b&&b.audienceId===AUDIENCES.Customer&&typeof b.email==='string'&&b.email===b.email.trim().toLowerCase()&&/^\S+@\S+\.\S+$/.test(b.email)&&typeof b.token==='string'&&b.token.length>0&&typeof b.contactId==='string'&&b.contactId.length>0&&typeof b.personId==='string'&&b.personId.length>0;
const keyFor=b=>'referral-rating/'+hash([b.audienceId,b.email]);
const sameBinding=(a,b)=>a&&['audienceId','email','token','contactId','personId'].every(k=>a[k]===b[k]);
const fingerprint=(row,proof,generation)=>hash([row.token,row.email,row.contactId,generation,proof.ratings]);
/**
 * Required ports (all synthetic in this candidate):
 * locked(key, fn): durable, cross-process identity serialization, shared by every
 * rating writer, identity merge, grant, revoke and final dispatch validator.
 * store.get/set: strongly consistent durable state, failures throw.
 * readCurrent(binding): authoritative {row, observedAt, generation}, not an event
 * payload or cache; generation changes on ANY identity/rating/hold edit.
 * currentGoogleReview(id,{forceFresh:true}): exact GET, no cached snapshot.
 * grantAllowed(binding,row): {eligible,observedAt}; current source/alias,
 * subscription, private-exclusion and native recipient checks. Unknown denies.
 * provider.setMarker(binding,id,bool) / readMarker(binding,id): exact pre-existing
 * member only, identity verified; no upsert/subscribe/tag/stage/trigger side effects.
 * Readback returns {binding, interestId, value}. A timed-out write is uncertain.
 */
export function createReferralRatingProjection({config=REFERRAL_RATING_PROJECTION,locked,store,readCurrent,currentGoogleReview=async()=>null,grantAllowed=async()=>({eligible:false}),provider,now=()=>Date.now()}={}){
 const enabled=()=>config.enabled===true&&typeof config.interestId==='string'&&/^[a-zA-Z0-9_-]+$/.test(config.interestId)&&config.nativeGuardVerified===true&&config.exclusiveWriterVerified===true;
 async function evaluate(binding){
  const current=await readCurrent(binding),row=current?.row;
  if(row?.isTest)return {eligible:false,testExcluded:true,reason:'test_excluded'};
  if(!row||row.token!==binding.token||row.email!==binding.email||row.contactId!==binding.contactId||row.role!=='Customer')return {eligible:false,identityUnknown:true,reason:'identity_unknown'};
  if(!fresh(current?.observedAt,now())||typeof current.generation!=='string'||!current.generation||row.cadenceVersion!==REVIEW_CADENCE_VERSION||row.suppressed||row.projectionHold||row.deliveryHold||row.referralHold)return {eligible:false,reason:'current_identity_or_hold'};
  let ratingRow=row;
  if(['googleReviewedAt','googleReviewId','googleReview','googleReviewObservedAt','googleReviewSource'].some(k=>row[k]!=null)){
   if(!row.googleReviewId||row.googleReview?.reviewId!==row.googleReviewId)return {eligible:false,reason:'google_identity_unknown'};
   const g=await currentGoogleReview(row.googleReviewId,{forceFresh:true});
   if(g?.verified!==true||g.source!=='google_reviews_get'||g.review?.reviewId!==row.googleReviewId)return {eligible:false,reason:'google_unverified'};
   ratingRow={...row,googleReview:g.review,googleReviewSource:g.source,googleReviewObservedAt:g.observedAt};
  }
  const rating=referralRatingEligibility(ratingRow,now());if(!rating.eligible)return rating;
  const allowed=await grantAllowed(binding,row);if(allowed?.eligible!==true||!fresh(allowed.observedAt,now()))return {eligible:false,reason:'grant_policy_hold'};
  const observedAt=Math.min(current.observedAt,rating.proof.observedAt,allowed.observedAt);
  if(!fresh(observedAt,now()))return {eligible:false,reason:'stale'};
  return {eligible:true,fingerprint:fingerprint(row,rating.proof,current.generation),observedAt,expiresAt:observedAt+60000};
 }
 async function readback(binding,value){const r=await provider.readMarker(binding,config.interestId);return sameBinding(r?.binding,binding)&&r.interestId===config.interestId&&r.value===value;}
 async function persist(key,state){await store.set(key,state);return state;}
 async function revoke(key,binding,reason){
  // Persist BEFORE I/O: even death between the write and response must block grants.
  await persist(key,{status:'revoking',binding,interestId:config.interestId,reason,at:now()});
  try{await provider.setMarker(binding,config.interestId,false);if(!await readback(binding,false))throw Error('Readback mismatch');}
  catch{await persist(key,{status:'uncertain',binding,interestId:config.interestId,reason:'revocation_unverified',at:now()});return {held:true,uncertain:true};}
  await persist(key,{status:'revoked',binding,interestId:config.interestId,reason,at:now()});return {revoked:true,reason};
 }
 async function reconcile(binding){
  if(!enabled())return {off:true}; // OFF is zero I/O, including locks/storage.
  if(!validBinding(binding))return {held:true,reason:'invalid_binding'};
  return locked(keyFor(binding),async()=>{
   const key=keyFor(binding),previous=await store.get(key);
   // Unknown in-flight writes can land later. A false GET is NOT proof of quiescence.
   if(previous&&['granting','revoking','uncertain'].includes(previous.status))return {held:true,uncertain:true};
   if(previous&&(!sameBinding(previous.binding,binding)||previous.interestId!==config.interestId))return {held:true,reason:'binding_changed_requires_cleanup'};
   let proof;try{proof=await evaluate(binding);}catch{proof={eligible:false,reason:'evidence_unavailable'};}
   if(proof.testExcluded||proof.identityUnknown&&!previous)return {held:true,reason:proof.reason};
   if(!proof.eligible)return revoke(key,binding,proof.reason);
   // No stale local positive is reused. A fresh grant always has write + readback.
   await persist(key,{status:'granting',binding,interestId:config.interestId,fingerprint:proof.fingerprint,at:now()});
   try{await provider.setMarker(binding,config.interestId,true);if(!await readback(binding,true))throw Error('Readback mismatch');}
   catch{await persist(key,{status:'uncertain',binding,interestId:config.interestId,reason:'grant_unverified',at:now()});return {held:true,uncertain:true};}
   let after;try{after=await evaluate(binding);}catch{after={eligible:false};}
   if(!after.eligible||after.fingerprint!==proof.fingerprint||!fresh(proof.observedAt,now()))return revoke(key,binding,'evidence_changed_during_grant');
   const expiresAt=Math.min(proof.expiresAt,after.expiresAt);
   await persist(key,{status:'granted',binding,interestId:config.interestId,fingerprint:proof.fingerprint,expiresAt,at:now()});
   return {projected:true,expiresAt,dispatchAuthorized:false};
  });
 }
 async function validateForDispatch(binding){
  if(!enabled())return {off:true,valid:false};
  if(!validBinding(binding))return {valid:false};
  return locked(keyFor(binding),async()=>{
   const key=keyFor(binding),state=await store.get(key);
   if(!state||state.status!=='granted'||!sameBinding(state.binding,binding)||state.interestId!==config.interestId)return {valid:false};
   let proof;try{proof=await evaluate(binding);}catch{proof={eligible:false};}
   if(proof.testExcluded)return {valid:false,reason:proof.reason};
   if(state.expiresAt<=now()||!proof.eligible||proof.fingerprint!==state.fingerprint){await revoke(key,binding,'dispatch_evidence_changed_or_expired');return {valid:false};}
   try{if(!await readback(binding,true))return {valid:false};}catch{return {valid:false};}
   if(state.expiresAt<=now()||!fresh(proof.observedAt,now())){await revoke(key,binding,'dispatch_evidence_expired');return {valid:false};}
   // This result is informational. Caller must still execute ALL owner gates and
   // close the validate/trigger gap; releasing this lock grants no capability.
   return {valid:true,expiresAt:state.expiresAt,dispatchAuthorized:false};
  });
 }
 async function invalidate(binding,reason='rating_changed'){
  if(!enabled())return {off:true};if(!validBinding(binding))return {held:true};
  return locked(keyFor(binding),async()=>{const key=keyFor(binding),previous=await store.get(key);
   if(!previous)return {absent:true};
   if(!sameBinding(previous.binding,binding)||previous.interestId!==config.interestId)return {held:true};
   if(['granting','revoking','uncertain'].includes(previous.status))return {held:true,uncertain:true};
   return revoke(key,binding,reason);
  });
 }
 return {reconcile,validateForDispatch,invalidate};
}
