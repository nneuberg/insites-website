import catalog from './marketing-program-catalog.cjs';
import {ORIGIN,AUDIENCES} from './review-policy.mjs';
const WINDOW=168*3600000+900000;
const conflicting=new Set(['1st time buying agent','absent buying agent','absent selling agent','client','new selling agent','repeat buying agent','repeat selling agent','super buying agent','vip buying agent']);
export function nativeNoBusiness(member){const tags=member.tags?.map(t=>t.name.toLowerCase());return member.status==='subscribed'&&Array.isArray(tags)&&tags.includes('no business')&&!tags.some(t=>conflicting.has(t))&&[0,'0'].includes(member.merge_fields?.MMERGE16);}
export function createMarketingEligibility({sourceNoBusiness,reviewRow,provider,client,now=()=>Date.now()}){
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
   if(row.endedAt||row.ratedAt||row.googleReviewedAt)return{stop:{reason:'review',programs:['review-customer-v1','review-agent-v1']}};
   if(executor.audienceId!==AUDIENCES[row.role]||executor.nativeReplyScopeVerified!==true)return{eligible:false};
   return{eligible:true,observedAt:now(),nativeGuard:m=>Array.isArray(m.tags)&&!m.tags.some(t=>typeof t?.name!=='string'||t.name.trim().toLowerCase()==='google reviewed')&&m.merge_fields&&['RVFEED','RVGDONE','RVPEND'].every(k=>Object.hasOwn(m.merge_fields,k))&&m.merge_fields.RVFEED===''&&m.merge_fields.RVGDONE===''&&['','STAGE0','STAGE1','STAGE2'].includes(m.merge_fields.RVPEND),prepare:p=>p.reviewFields(executor.audienceId,person.email,{REVLINK:ORIGIN+'/review/r/'+row.token,REVADDR:row.address})};
  }
  return{eligible:false};
 };
}
