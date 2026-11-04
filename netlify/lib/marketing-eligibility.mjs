import {referralRatingEligibility} from './referral-rating-eligibility.mjs';
import {REFERRAL_AGENT_TAGS} from './marketing-hive-eligibility.mjs';
import catalog from './marketing-program-catalog.cjs';
import {operationId} from './marketing-admission-client.mjs';
import {ORIGIN,AUDIENCES,REVIEW_CADENCE_VERSION,googleReviewTiming} from './review-policy.mjs';
const WINDOW=168*3600000+900000;
const conflicting=new Set(['1st time buying agent','absent buying agent','absent selling agent','client','new selling agent','repeat buying agent','repeat selling agent','super buying agent','vip buying agent']);
export function nativeNoBusiness(member){const tags=member.tags?.map(t=>t.name.toLowerCase());return member.status==='subscribed'&&Array.isArray(tags)&&tags.includes('no business')&&!tags.some(t=>conflicting.has(t))&&[0,'0'].includes(member.merge_fields?.MMERGE16);}
export function createMarketingEligibility({sourceNoBusiness,reviewRow,provider,client,sourceReferral=async()=>({eligible:false}),currentGoogleReview=async()=>null,now=()=>Date.now()}){
 return async({person,state,intent,executor})=>{
  if(catalog.NB_PROGRAMS.includes(intent.program)){
   const proof=await sourceNoBusiness(person.email);if(proof.stop)return{stop:{reason:'business',programs:catalog.NB_PROGRAMS}};if(proof.eligible!==true)return{eligible:false};
   const def=catalog.programs[intent.program],stage=def.stages.find(s=>s.stage===intent.stage);if(!stage)return{eligible:false};
   if(stage.previousResend){const prior=Object.values(state.intents).find(i=>i.program===intent.program&&i.stage===stage.previousResend),permit=Object.values(state.permits).find(p=>p.intentId===prior?.id&&p.state==='sent'),at=permit?.firstSentObservedAt||prior?.skippedAt;if(!at)return{eligible:false};const after=at+def.afterPreviousResendDays*catalog.DAY;if(now()<after)return{deferUntil:after};}
   if(stage.kind==='resend'){
    const original=Object.values(state.intents).find(i=>i.program===intent.program&&i.stage===stage.originalStage),sent=Object.values(state.permits).find(p=>p.intentId===original?.id&&p.state==='sent');if(!sent)return{eligible:false};
    const after=sent.firstSentObservedAt+WINDOW;if(now()<after)return{deferUntil:after};
    const events=await provider.activity(executor.audienceId,person.email);
    if(events.some(x=>x.type==='open'&&x.campaignId===sent.executor.campaignId))return{skip:{reason:'original_opened',proof:{verified:true,campaignId:sent.executor.campaignId,memberKey:sent.memberKey,observedAt:now()}}};
    if(executor.nativeOriginalUnopenedGuardVerified!==true||executor.originalCampaignId!==sent.executor.campaignId)return{eligible:false};
   }
   if(executor.nativeReplyScopeVerified!==true)return{eligible:false};
   return{eligible:true,observedAt:proof.observedAt,nativeGuard:nativeNoBusiness};
  }
  if(intent.program==='review-customer-v1'||intent.program==='review-agent-v1'){
   const row=await reviewRow(intent.context?.token);if(!row||row.email!==person.email||row.isTest||row.token!==intent.context.token||row.role!==(intent.program==='review-agent-v1'?'Agent':'Customer')||row.expiresAt<=now()||row.deliveryHold||row.projectionHold)return{eligible:false};
   if(row.cadenceVersion===REVIEW_CADENCE_VERSION&&row.googleReviewId&&row.googleReviewedAt&&!person.reviewSequence?.googleReview)return{googleReview:{verified:true,source:'confirmed_google_review',cadenceVersion:REVIEW_CADENCE_VERSION,program:row.role==='Agent'?'review-agent-v1':'review-customer-v1',reviewKey:operationId('google-review',row.googleReviewId),token:row.token,...googleReviewTiming(row)}};
   if(row.endedAt||row.ratedAt||row.googleReviewedAt)return{stop:{reason:'review',programs:['review-customer-v1','review-agent-v1']}};
   if(executor.audienceId!==AUDIENCES[row.role]||executor.nativeReplyScopeVerified!==true)return{eligible:false};
   return{eligible:true,observedAt:now(),nativeGuard:m=>Array.isArray(m.tags)&&!m.tags.some(t=>typeof t?.name!=='string'||t.name.trim().toLowerCase()==='google reviewed')&&m.merge_fields&&['RVFEED','RVGDONE','RVPEND'].every(k=>Object.hasOwn(m.merge_fields,k))&&m.merge_fields.RVFEED===''&&m.merge_fields.RVGDONE===''&&['','STAGE0','STAGE1','STAGE2'].includes(m.merge_fields.RVPEND),prepare:p=>p.reviewFields(executor.audienceId,person.email,{REVLINK:ORIGIN+'/review/r/'+row.token,REVADDR:row.address})};
  }
  if(intent.program==='referral-customer-v1'){
   const row=await reviewRow(intent.context?.token),q=person.reviewSequence;
   if(!row||row.role!=='Customer'||row.email!==person.email||row.token!==q?.token||row.isTest||row.suppressed||row.projectionHold||row.deliveryHold||row.referralHold||row.cadenceVersion!==REVIEW_CADENCE_VERSION)return{eligible:false};
   if(row.googleReviewId&&row.googleReviewedAt&&!q.googleReview)return{googleReview:{verified:true,source:'confirmed_google_review',cadenceVersion:REVIEW_CADENCE_VERSION,program:row.role==='Agent'?'review-agent-v1':'review-customer-v1',reviewKey:operationId('google-review',row.googleReviewId),token:row.token,...googleReviewTiming(row)}};
   let ratingRow=row;
   if(['googleReviewedAt','googleReviewId','googleReview'].some(k=>row[k]!==undefined&&row[k]!==null)){
    if(!row.googleReviewId||!Number.isSafeInteger(row.googleReviewedAt)||row.googleReview?.reviewId!==row.googleReviewId)return{eligible:false,reason:'google_rating_unverified'};
    const latest=await currentGoogleReview(row.googleReviewId);if(!latest||latest.verified!==true||latest.source!=='google_reviews_get'||latest.review?.reviewId!==row.googleReviewId)return{eligible:false,reason:'google_rating_unverified'};
    ratingRow={...row,googleReview:latest.review,googleReviewObservedAt:latest.observedAt,googleReviewSource:latest.source};
   }
   const rating=referralRatingEligibility(ratingRow,now());if(!rating.eligible)return{eligible:false,reason:rating.reason};
   const addresses=[...new Set(Object.values(state.people||{}).map(p=>p.email).filter(Boolean))];
   if(!addresses.includes(person.email)||addresses.length>4)return{eligible:false};
   let observedAt=now();
   for(const address of addresses){const source=await sourceReferral(address);if(source.eligible!==true||address===person.email&&!source.contactIds?.includes(row.contactId)||!Number.isSafeInteger(source.observedAt)||source.observedAt>now()||now()-source.observedAt>60000)return{eligible:false};observedAt=Math.min(observedAt,source.observedAt);}
   const reviewed=!!q.googleReview;
   if(!!row.googleReviewedAt!==reviewed||intent.stage!==(reviewed?'initial-reviewed':'initial-unreviewed')||executor.audienceId!==AUDIENCES.Customer||executor.nativeReplyScopeVerified!==true)return{eligible:false};
   return{eligible:true,reviewed,observedAt,ratingProof:rating.proof,nativeGuard:m=>{const tags=m.tags?.map(t=>typeof t?.name==='string'?t.name.trim().toLowerCase():null),f=m.merge_fields;if(!Array.isArray(tags)||tags.includes(null)||tags.some(t=>REFERRAL_AGENT_TAGS.includes(t))||!f||!Object.hasOwn(f,'RVFEED')||!Object.hasOwn(f,'RVGDONE')||!['','YES'].includes(f.RVFEED)||executor.nativePositiveRatingGuardVerified!==true||typeof executor.positiveRatingInterest!=='string'||m.interests?.[executor.positiveRatingInterest]!==true)return false;return reviewed?(f.RVGDONE==='YES'||tags.includes('google reviewed')):(f.RVGDONE===''&&!tags.includes('google reviewed'));}};
  }
  return{eligible:false};
 };
}
