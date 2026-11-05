import {claimReviewOptionalPhase} from './review-scan-progress.mjs';
import {isReviewDeadlineError} from './review-work-budget.mjs';
import {REVIEW_INTAKE_START_AFTER,allowsReviewIntake} from './review-intake.mjs';
import {eligibleRecipients} from './review-policy.mjs';
import {assertSourceAuthority} from './hive-source-cache.mjs';
// Local cache discovery replaces polling; normal review follow-ups retain their
// existing send/consent/idempotency path in engine.run({discover:false}).
export async function runCachedReviewWorker({cache,view,engine,store,now=()=>Date.now(),enabled=false,limit=20,work=null,googleAvailable=false,scheduledPhase=null}){
 if(!enabled)return {deferred:true};
 if(scheduledPhase&&(!work||!['followups','discovery'].includes(scheduledPhase)))throw Error('Invalid review source phase');
 if(scheduledPhase==='followups')return {...await engine.run({discover:false}),sourceConsidered:0,sourceEnrolled:0,sourceDeferred:1,sourceWorkDeferred:true};
 let considered=0,enrolled=0,deferred=0,followups=null,sourceWorkDeferred=false,optionalPhase=null;
 // Callers without an explicit primary phase retain followups-first ordering.
 // Newly enrolled rows remain durable for the next normal run; no backfill/reset.
 if(scheduledPhase==='discovery'){followups={processed:0,followupsDeferred:true};optionalPhase='discovery';}
 if(work&&!scheduledPhase){
  followups=await engine.run({discover:false});
  if(followups.workDeferred||!work.canStart(9000))return {...followups,sourceConsidered:0,sourceEnrolled:0,sourceDeferred:1,sourceWorkDeferred:true};
  optionalPhase=await claimReviewOptionalPhase(store,{googleAvailable});
  if(optionalPhase!=='discovery')return {...followups,sourceConsidered:0,sourceEnrolled:0,sourceDeferred:1,sourceWorkDeferred:true,optionalPhase};
 }
 try{
  work?.mark('discovery');work?.check();
  const {state}=await cache.read();
  assertSourceAuthority(state,'inspections',{now:now(),maxAgeMs:86400000});
  const rows=Object.values(state.inspections).sort((a,b)=>a.id.localeCompare(b.id));
  const position=await store.get('hive-source-review-cursor',{type:'json'}),start=rows.length?(position?.offset||0)%rows.length:0;
  for(let step=0;step<rows.length;step++){
   if(considered>=limit)break;
   // Start another discovery only with room to finish its bounded enrollment.
   if(work&&!work.canStart(3000)){deferred++;sourceWorkDeferred=true;break;}
   const at=(start+step)%rows.length,row=rows[at];
   if(row.deleted||!allowsReviewIntake(row.data,REVIEW_INTAKE_START_AFTER))continue;
   // No7day cutoff: late payments/signatures on old inspections remain eligible.
   if(!eligibleRecipients(row.data,now()).length)continue;
   const key='hive-source-review/'+encodeURIComponent(row.id),previous=await store.get(key,{type:'json'});
   if(previous?.revision===row.revision&&(!previous.failed||previous.nextAttemptAt>now()))continue;
   if((await store.setJSON('hive-source-review-cursor',{offset:(at+1)%rows.length}))?.modified!==true)throw Error('Review cursor uncertain');
   considered++;
   try{
    const inspection=await view.getInspection(row.id);
    const result=await engine.enroll(inspection);
    if(result.paused){deferred++;continue;}
    const saved=await store.setJSON(key,{revision:row.revision,checkedAt:now()});
    if(saved?.modified!==true)throw Error('Review source checkpoint uncertain');
    enrolled+=result.added||0;
   }catch(error){deferred++;if(isReviewDeadlineError(error,work)){sourceWorkDeferred=true;break;}const saved=await store.setJSON(key,{revision:row.revision,failed:true,nextAttemptAt:now()+900000});if(saved?.modified!==true)throw Error('Review retry checkpoint uncertain');}
  }
 }catch(error){deferred++;if(isReviewDeadlineError(error,work))sourceWorkDeferred=true;}
 // Legacy combined callers still process qualified requests after discovery failure.
 if(!followups)followups=await engine.run({discover:false});
 return {...followups,sourceConsidered:considered,sourceEnrolled:enrolled,sourceDeferred:deferred,...(sourceWorkDeferred?{sourceWorkDeferred:true}:{}),...(optionalPhase?{optionalPhase}:{})};
}
