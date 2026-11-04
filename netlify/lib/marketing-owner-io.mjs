// Fixed I/O only. This module never calls the ledger or waits for Sheets.
import {createHash} from 'node:crypto';
import catalog from './marketing-program-catalog.cjs';
import {operationId} from './marketing-admission-client.mjs';
import {nativeNoBusiness} from './marketing-eligibility.mjs';
const WINDOW=168*3600000+900000;
const root=s=>{const p=Object.values(s.people||{}).filter(p=>!p.parent);if(p.length!==1)throw Error('Exact identity root required');return p[0];};
const aliases=s=>[...new Set(Object.values(s.people).map(p=>p.email).filter(Boolean))];
const memberKey=(a,e)=>'member:'+a+':'+createHash('md5').update(e).digest('hex');
const sourceProof=p=>({schema:'hive-nobusiness-v1',verified:true,currentNoBusiness:true,conflicts:false,bookingStop:false,contactIds:p.contactIds,observedAt:p.observedAt});
export function createOwnerIO({config,provider,eligibility,sourceNoBusiness,cache,manualExclusion=async()=>({verified:false}),ratingProjection=null,now=()=>Date.now()}){
 async function enrollment(email,program){
  const excluded=await manualExclusion(email);if(excluded.verified!==true||excluded.excluded)return{kind:'hold'};
  const p=await sourceNoBusiness(email);if(p.eligible!==true)return{kind:'hold'};
  const a=await provider.member(config.audiences[0],email),b=await provider.member(config.audiences[1],email);if(!a||!nativeNoBusiness(a)||b?.status==='subscribed')return{kind:'hold'};
  return{kind:'enroll',email,program,proof:sourceProof(p)};
 }
 async function discover(cursor=0){
  if(config.producerEnabled!==true)return{candidates:[],cursor};const {state}=await cache.read(),rows=Object.values(state.contacts||{}).sort((a,b)=>a.id.localeCompare(b.id));let i=Math.max(0,Number.isSafeInteger(cursor)?cursor:0),read=0,considered=0;const candidates=[];
  for(;i<rows.length&&read<250&&considered<2;i++,read++){const r=rows[i];if(r.deleted||r.emails?.length!==1||!r.data?.tags?.some(t=>t.name?.trim().toLowerCase()==='no business'))continue;considered++;const result=await enrollment(r.emails[0],'nb-intro-v1');if(result.kind==='enroll')candidates.push(result);}
  return{candidates,cursor:i>=rows.length?0:i};
 }
 async function preflight(state){
  if(ratingProjection?.enabled())try{await ratingProjection.cleanup();}catch{return {kind:'hold'};}
  const p=root(state);if(p.stops.length||p.quarantine.length)return{kind:'hold'};
  const reserved=Object.values(state.permits).find(a=>a.state==='reserved');if(reserved)return{kind:'abandon',permitId:reserved.id};
  if(Object.values(state.intents).some(i=>i.state==='queued'&&i.expiresAt<=now()))return{kind:'expire'};
  const manualAllowed=async()=>{const addresses=aliases(state);if(!addresses.length||addresses.length>4)return false;for(const address of addresses){const x=await manualExclusion(address);if(x.verified!==true||x.excluded)return false;}return true;};
  const intro=p.programs?.['nb-intro-v1'];
  if(config.producerEnabled&&intro&&!intro.progressDoneAt&&!p.programStops?.['nb-intro-v1']?.length&&now()>=intro.anchorAt+70*catalog.DAY){
   if(intro.classification?.completedAt){const program=intro.classification.branch==='observed-engaged'?'nb-evergreen-v1':'nb-permission-v1';if(p.programs[program])return{kind:'progressDone',program:'nb-intro-v1'};if(await manualAllowed()){const next=await enrollment(p.email,program);if(next.kind!=='hold')return next;}}
   const introResolved=catalog.programs['nb-intro-v1'].stages.every(stage=>{const i=Object.values(state.intents).find(i=>i.program==='nb-intro-v1'&&i.stage===stage.stage);return i&&(stage.kind==='original'?i.state==='sent':['sent','skipped'].includes(i.state));});
   if(!intro.classification&&introResolved&&config.completionExecutor?.verified===true&&config.completionExecutor.exclusiveInterestWriter===true&&await manualAllowed()){
    const e=config.completionExecutor,proof=await sourceNoBusiness(p.email);
    if(proof.stop)return{kind:'stop',reason:'business',programs:catalog.NB_PROGRAMS};
    if(proof.eligible===true){const m=await provider.member(e.audienceId,p.email),c=catalog.classification;if(nativeNoBusiness(m))return{kind:'classify',binding:JSON.stringify(e),baseline:{verified:true,complete:m.interests?.[c.completeInterest],engaged:m.interests?.[c.engagedInterest],never:m.interests?.[c.neverInterest],memberKey:memberKey(e.audienceId,p.email),observedAt:now()}};}
   }
  }
  const permission=p.programs?.['nb-permission-v1'];if(permission&&!permission.progressDoneAt){const intents=Object.values(state.intents).filter(i=>i.program==='nb-permission-v1'),sent=Object.values(state.permits).filter(a=>intents.some(i=>i.id===a.intentId)&&a.state==='sent'),original=sent.find(a=>state.intents[a.intentId].stage==='o1'),latest=Math.max(0,...sent.map(a=>a.firstSentObservedAt));if(original&&now()>=Math.max(permission.anchorAt+74*catalog.DAY,original.firstSentObservedAt+14*catalog.DAY,latest+7*catalog.DAY)&&intents.every(i=>['sent','skipped','held','no_send','expired'].includes(i.state)))return{kind:'progressDone',program:'nb-permission-v1'};}
  const sequence=p.reviewSequence;
  if(config.referralOwnerEnabled===true&&sequence?.version==='review-037-referral-2-v1'&&sequence.program==='review-customer-v1'&&!sequence.referralIntentId&&!sequence.referralHold){
   const stage=sequence.googleReview?'initial-reviewed':'initial-unreviewed',e=config.executors['referral-customer-v1:'+stage];
   const last=Math.max(0,...Object.values(state.permits).filter(a=>a.state==='sent'&&state.intents[a.intentId]?.program===sequence.program&&state.intents[a.intentId]?.context?.token===sequence.token).map(a=>a.firstSentObservedAt||0));
   const dueAt=sequence.googleReview?Math.max((sequence.googleReview.occurredAt??sequence.googleReview.confirmedAt)+2*catalog.DAY,sequence.googleReview.confirmedAt,last+2*catalog.DAY):sequence.startedAt?Math.max(sequence.startedAt+9*catalog.DAY,last+2*catalog.DAY):Infinity;
   if(e?.verified===true&&dueAt<=now()){const i={program:'referral-customer-v1',stage,context:{token:sequence.token}},check=await eligibility({person:p,state,intent:i,executor:e});if(check.googleReview)return{kind:'recordGoogleReview',proof:check.googleReview};if(check.eligible===true)return{kind:'queueReferralInitial',intentId:operationId('referral-initial',p.id),expiresAt:dueAt+30*catalog.DAY,proof:{verified:true,eligible:true,token:sequence.token,reviewed:!!sequence.googleReview,observedAt:check.observedAt,ratingProof:check.ratingProof}};}
  }
  const due=Object.values(state.intents).filter(i=>i.state==='queued'&&!p.programStops?.[i.program]?.length&&i.dueAt<=now()&&i.expiresAt>now()).sort((a,b)=>a.dueAt-b.dueAt||a.id.localeCompare(b.id));
  for(const i of due){
   const e=config.executors[i.program+':'+i.stage];if(!e?.verified)continue;
   if(catalog.NB_PROGRAMS.includes(i.program)&&!await manualAllowed())continue;
   if(i.program==='referral-customer-v1'&&ratingProjection){let projection;try{projection=await ratingProjection.reconcile({person:p,state,intent:i,executor:e});}catch{continue;}if(projection.projected!==true)continue;}
   const check=await eligibility({person:p,state,intent:i,executor:e});if(check.googleReview)return{kind:'recordGoogleReview',proof:check.googleReview};if(check.stop)return{kind:'stop',...check.stop};if(check.deferUntil)return{kind:'defer',intentId:i.id,notBefore:check.deferUntil};if(check.skip)return{kind:'skip',intentId:i.id,...check.skip};if(check.eligible!==true)continue;
   const addresses=aliases(state);if(!addresses.length||addresses.length>4)return{kind:'hold'};const members=[];for(const address of addresses)for(const audience of config.audiences){const member=await provider.member(audience,address);if(member)members.push({address,audience,member});}
   if(members.some(x=>['cleaned','unsubscribed'].includes(x.member.status)))return{kind:'stop',reason:members.some(x=>x.member.status==='cleaned')?'cleaned':'unsubscribe'};
   const subscribed=members.filter(x=>x.member.status==='subscribed');if(subscribed.length!==1||subscribed[0].audience!==e.audienceId||subscribed[0].address!==p.email)return{kind:i.program.startsWith('review-')?'holdIntent':'hold',intentId:i.id,reason:'review_recipient_ambiguity'};
   if(check.nativeGuard&&!check.nativeGuard(subscribed[0].member)){if(i.program.startsWith('review-'))return{kind:'holdIntent',intentId:i.id,reason:'review_native_guard_hold'};continue;}
   const terminalBaseline={};for(const marker of Object.values(e.terminalMarkers||{})){if(subscribed[0].member.interests?.[marker]!==false)return{kind:'hold'};terminalBaseline[marker]=false;}
   for(const m of members)for(const event of await provider.activity(m.audience,m.address)){
    if(event.type==='inbox_thread'&&event.direction==='INBOUND'&&!e.nativeReplyScopeVerified)return{kind:'hold'};
    if(event.type!=='sent')continue;if(m.audience===e.audienceId&&event.campaignId===e.campaignId)return{kind:'hold'};
    if(event.at>=now()-WINDOW||event.at+1000>config.cutover.at){const owned=Object.values(state.permits).some(a=>a.state==='sent'&&a.memberKey===memberKey(m.audience,m.address)&&a.executor.campaignId===event.campaignId&&a.sentAt===event.at);if(!owned)return{kind:'baseline',receipt:{verified:true,source:'member_activity_feed',eventId:operationId('external',m.audience,m.address,event.campaignId,event.at),eventAt:event.at,memberKey:memberKey(m.audience,m.address)}};}
   }
   if(check.prepare)try{await check.prepare(provider,subscribed[0]);}catch{return{kind:'holdIntent',intentId:i.id,reason:'projection_unverified'};}
   if(!Number.isSafeInteger(check.observedAt)||check.observedAt>now()||now()-check.observedAt>60000)return{kind:'hold'};
   return{kind:'dispatch',intentId:i.id,permitId:i.program==='referral-customer-v1'?operationId('permit',i.id,i.stage):operationId('permit',i.id),preflight:{verified:true,allAudiencesCovered:true,executorUnused:true,executorBinding:JSON.stringify(e),terminalBaseline,subscribed:true,noStopObserved:true,observedAt:check.observedAt,historyFrom:check.observedAt-WINDOW,audienceId:e.audienceId,memberKey:memberKey(e.audienceId,p.email),lastSendObservedAt:0,...(i.program==='referral-customer-v1'?{ratingProof:check.ratingProof}:{})}};
  }
  return{kind:'hold'};
 }
 async function receipt(state,permitId){const p=root(state),a=state.permits[permitId];if(a?.state!=='attempted')return{kind:'hold'};const address=aliases(state).find(e=>memberKey(a.executor.audienceId,e)===a.memberKey);if(!address)return{kind:'hold'};const events=(await provider.activity(a.executor.audienceId,address)).filter(e=>e.type==='sent'&&e.campaignId===a.executor.campaignId);if(a.executor.terminalMarkers){const m=await provider.member(a.executor.audienceId,address),markers=a.executor.terminalMarkers;if(!m?.interests||Object.values(markers).some(k=>typeof m.interests[k]!=='boolean'))return{kind:'hold'};const outcomes=Object.entries(markers).filter(([,id])=>m.interests[id]);if(outcomes.length>1||outcomes.length&&events.length)return{kind:'quarantine',reason:'native_graph_contradiction'};if(outcomes.length===1){const [outcome,markerId]=outcomes[0];return{kind:'receipt',receipt:{verified:true,kind:'no_send',source:'verified_terminal_branch',origin:'unique_interest_marker',outcome,markerId,eventId:operationId('terminal',a.id,markerId),eventAt:now(),audienceId:a.executor.audienceId,campaignId:a.executor.campaignId,memberKey:a.memberKey,graphVersion:a.executor.graphVersion,authenticated:true,noSendReachable:true}};}}
  if(events.length!==1||events[0].at<a.attemptedAt)return{kind:'hold'};const event=events[0];return{kind:'receipt',receipt:{verified:true,kind:'sent',source:'member_activity_feed',eventId:operationId(a.memberKey,a.executor.campaignId,event.at),eventAt:event.at,audienceId:a.executor.audienceId,campaignId:a.executor.campaignId,memberKey:a.memberKey}};
 }
 async function classificationReceipt(state){const p=root(state),c=p.programs?.['nb-intro-v1']?.classification;if(!c||c.completedAt)return{kind:'hold'};const m=await provider.member(c.executor.audienceId,p.email),g=catalog.classification,i=m?.interests;if(i?.[g.completeInterest]!==true||typeof i[g.engagedInterest]!=='boolean'||typeof i[g.neverInterest]!=='boolean'||i[g.engagedInterest]===i[g.neverInterest])return{kind:'hold'};return{kind:'classificationReceipt',proof:{verified:true,complete:true,engaged:i[g.engagedInterest],never:i[g.neverInterest],memberKey:c.memberKey,journeyId:c.executor.journeyId,graphVersion:c.executor.graphVersion,observedAt:now()}};}
 return{discover,preflight,receipt,classificationReceipt};
}
