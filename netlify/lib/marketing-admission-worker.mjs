import {createHash} from 'node:crypto';
import {operationId} from './marketing-admission-client.mjs';
const WINDOW=168*3600000+15*60000;
const md5=x=>createHash('md5').update(x).digest('hex');
export async function runAdmission({config,client,provider,eligibility,producer=null,cursor=2,now=()=>Date.now(),deadline=now()+180000}){
 if(config.enabled!==true||config.allMarketingWritersCovered!==true||config.cutover?.verified!==true||!Number.isSafeInteger(config.cutover.at)||config.cutover.at<=0||config.cutover.at>now())return{off:true,processed:0,cursor};
 const scan=await client.scanDue(cursor);let processed=0,sentAttempts=0,settled=0,held=0,next=cursor;
 for(let index=0;index<scan.people.length;index++){
  if(processed>=Math.min(10,Number.isSafeInteger(config.maxPeople)&&config.maxPeople>0?config.maxPeople:1)||now()>deadline-60000)break;
  const personKey=scan.people[index];next=scan.positions[index]+1;processed++;
  try{
   let {state}=await client.snapshot(personKey),p=Object.values(state.people).find(p=>!p.parent);if(!p)throw Error('Missing identity root');
   const addresses=[...new Set(Object.values(state.people).map(x=>x.email).filter(Boolean))];if(!addresses.length||addresses.length>4)throw Error('Ambiguous destination count');
   const attempts=Object.values(state.permits).filter(x=>x.state==='attempted');
   if(attempts.length){
    if(attempts.length!==1){held++;continue;}const a=attempts[0];
    const poll=await client.command(personKey,'beginReceiptPoll',{permitId:a.id},operationId('poll',a.id,a.receiptPolls||0));if(!poll.poll){held++;continue;}
    const address=addresses.find(x=>client.memberKey(a.executor.audienceId,x)===a.memberKey);if(!address)throw Error('Attempt destination unresolved');
    const events=(await provider.activity(a.executor.audienceId,address)).filter(x=>x.type==='sent'&&x.campaignId===a.executor.campaignId);
    let terminal=null;if(a.executor.terminalMarkers){const member=await provider.member(a.executor.audienceId,address),markers=a.executor.terminalMarkers;if(!member?.interests||Object.values(markers).some(k=>typeof member.interests[k]!=='boolean')){held++;continue;}const outcomes=Object.entries(markers).filter(([,id])=>member.interests[id]===true);if(outcomes.length>1||outcomes.length&&events.length){await client.command(personKey,'quarantine',{personId:p.id,reason:'native_graph_contradiction'});held++;continue;}if(outcomes.length===1)terminal={outcome:outcomes[0][0],markerId:outcomes[0][1]};}
    if(terminal){const receipt={verified:true,kind:'no_send',source:'verified_terminal_branch',origin:'unique_interest_marker',...terminal,eventId:operationId('terminal',a.id,terminal.markerId),eventAt:now(),audienceId:a.executor.audienceId,campaignId:a.executor.campaignId,memberKey:a.memberKey,graphVersion:a.executor.graphVersion,authenticated:true,noSendReachable:true};await client.command(personKey,'reconcile',{permitId:a.id,receipt});settled++;continue;}
    if(events.length!==1||events[0].at<a.attemptedAt){held++;continue;}
    const event=events[0],receipt={verified:true,kind:'sent',source:'member_activity_feed',eventId:operationId(a.memberKey,a.executor.campaignId,event.at),eventAt:event.at,audienceId:a.executor.audienceId,campaignId:a.executor.campaignId,memberKey:a.memberKey};
    await client.command(personKey,'reconcile',{permitId:a.id,receipt});settled++;continue;
   }
   if(producer)try{await producer.progress(personKey,state);}catch{/* Classification uncertainty holds its program, not unrelated review work. */} // No-email classification uncertainty must not hide unrelated reviews.
   ({state}=await client.snapshot(personKey));p=Object.values(state.people).find(p=>!p.parent);
   if(p.stops.length||p.quarantine.length){held++;continue;}
   await client.command(personKey,'expireDue',{personId:p.id},operationId('expire',personKey,Math.floor(now()/900000)));
   const reserved=Object.values(state.permits).find(x=>x.state==='reserved');
   // A reservation surviving a crash is never dispatched from a later invocation.
   if(reserved){await client.command(personKey,'abandonReservation',{permitId:reserved.id},operationId('abandon',reserved.id));held++;continue;}
   const intents=Object.values(state.intents).filter(i=>i.state==='queued'&&!p.programStops?.[i.program]?.length&&i.dueAt<=now()&&i.expiresAt>now()).sort((a,b)=>a.dueAt-b.dueAt||a.id.localeCompare(b.id));
   let selected=null;
   for(const intent of intents){const e=config.executors[intent.program+':'+intent.stage];if(!e||e.verified!==true)continue;const check=await eligibility({person:p,state,intent,executor:e});if(check.stop){await client.stop(personKey,check.stop.reason,check.stop.programs);continue;}if(check.deferUntil){await client.command(personKey,'deferQueued',{intentId:intent.id,notBefore:check.deferUntil});continue;}if(check.skip){await client.command(personKey,'skipUnsentStage',{intentId:intent.id,...check.skip});continue;}if(check.eligible===true){selected={intent,e,check};break;}}
   if(!selected){held++;continue;}const {intent,e,check}=selected;
   const members=[];for(const address of addresses)for(const audience of config.audiences){if(now()>deadline-45000)throw Error('Preflight deadline');const member=await provider.member(audience,address);if(member)members.push({address,audience,member});}
   if(members.some(x=>['unsubscribed','cleaned'].includes(x.member.status))){await client.stop(personKey,members.some(x=>x.member.status==='cleaned')?'cleaned':'unsubscribe');held++;continue;}
   const subscribed=members.filter(x=>x.member.status==='subscribed');if(subscribed.length!==1||subscribed[0].audience!==e.audienceId||subscribed[0].address!==p.email){if(intent.program.startsWith('review-'))await client.command(personKey,'holdIntent',{intentId:intent.id,reason:'review_recipient_ambiguity'});held++;continue;}
   if(check.nativeGuard&&!check.nativeGuard(subscribed[0].member)){if(intent.program.startsWith('review-'))await client.command(personKey,'holdIntent',{intentId:intent.id,reason:'review_native_guard_hold'});held++;continue;}
   const terminalBaseline={};if(e.terminalMarkers){for(const marker of Object.values(e.terminalMarkers)){if(subscribed[0].member.interests?.[marker]!==false)throw Error('Terminal marker baseline not clear');terminalBaseline[marker]=false;}}
   let used=false,last=0,unmappedReply=false;
   for(const entry of members){if(now()>deadline-45000)throw Error('Preflight deadline');const activity=await provider.activity(entry.audience,entry.address);for(const event of activity){if(event.type==='inbox_thread'&&event.direction==='INBOUND')unmappedReply=true;if(event.type!=='sent')continue;if(entry.audience===e.audienceId&&event.campaignId===e.campaignId)used=true;
     if(event.at>=now()-WINDOW||event.at+1000>config.cutover.at){const owned=Object.values(state.permits).some(a=>a.state==='sent'&&a.memberKey===client.memberKey(entry.audience,entry.address)&&a.executor.campaignId===event.campaignId&&a.sentAt===event.at);if(!owned){last=now();await client.command(personKey,'observeExternalSend',{personId:p.id,receipt:{verified:true,source:'member_activity_feed',eventId:operationId('external',entry.audience,md5(entry.address),event.campaignId,event.at),eventAt:event.at,memberKey:client.memberKey(entry.audience,entry.address)}});}}}}
   if(used||last||unmappedReply&&e.nativeReplyScopeVerified!==true){held++;continue;} // Unknown reply scope is a temporary hold, never guessed lifetime stop.
   if(check.prepare)try{await check.prepare(provider,subscribed[0]);}catch{await client.command(personKey,'holdIntent',{intentId:intent.id,reason:'projection_unverified'});held++;continue;}
   if(!Number.isSafeInteger(check.observedAt)||now()-check.observedAt>60000||check.observedAt>now()||now()>deadline-30000){held++;continue;}
   const observedAt=check.observedAt,permitId=operationId('permit',intent.id),preflight={verified:true,allAudiencesCovered:true,executorUnused:true,executorBinding:JSON.stringify(e),terminalBaseline,subscribed:true,noStopObserved:true,observedAt,historyFrom:observedAt-WINDOW,audienceId:e.audienceId,memberKey:client.memberKey(e.audienceId,p.email),lastSendObservedAt:0};
   const begin=await client.command(personKey,'reserveAndBegin',{intentId:intent.id,permitId,preflight},operationId('dispatch-batch',intent.id,observedAt));if(!begin.send){held++;continue;}
   let outcome='ambiguous';try{await provider.trigger(begin.executor,p.email);outcome='accepted';}catch(error){outcome=error.status?'rejected':'ambiguous';}sentAttempts++;
   await client.command(personKey,'attemptOutcome',{permitId,outcome});
  }catch{held++;}
 }
 if(processed===scan.people.length)next=scan.cursor;
 return{processed,sentAttempts,settled,held,cursor:next};
}
