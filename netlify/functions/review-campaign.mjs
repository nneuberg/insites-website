import {runReviewScheduledTurn} from '../lib/review-scan-progress.mjs';
import {SOURCE_PLAN} from '../lib/hive-source-sync.mjs';
import {sourceServices} from '../lib/hive-source-runtime.mjs';
import {runCachedReviewWorker} from '../lib/hive-source-review.mjs';
import {HIVE_INCIDENT} from '../lib/hive-incident.mjs';
import {REVIEW_EVENTS} from '../lib/review-event-launch.mjs';
import {runReviewWorker} from '../lib/review-worker.mjs';
import {REVIEW_AUTOMATION_ORGANIZATION} from '../lib/review-automation.mjs';
import {reviewEnvironment} from '../lib/review-launch.mjs';
import {runtime,response,reviewStore} from '../lib/review-runtime.mjs';
import {googleSync} from '../lib/review-google.mjs';
import {createReviewWorkBudget,REVIEW_WORK_MS,isReviewDeadlineError,reviewFailureCategory} from '../lib/review-work-budget.mjs';
export default async(_request,context)=>{
 const work=createReviewWorkBudget();let result=null,scheduledPhase=null,phaseStarted=false,googleAvailable=null;
 console.log('Review campaign started',JSON.stringify({phase:work.phase,elapsedMs:work.elapsed(),workBudgetMs:REVIEW_WORK_MS}));
 try{
  const engine=runtime(context,{work}),store=reviewStore(context);
  const googleWorker=googleSync({store,engine,env:reviewEnvironment(),work,fetcher:work.wrapFetch()});googleAvailable=googleWorker.ready();
  let google={};
  if(SOURCE_PLAN.enabled&&SOURCE_PLAN.reviewEnrollmentEnabled&&!HIVE_INCIDENT.paused){
   result=await runReviewScheduledTurn({store,engine,work,googleAvailable,onClaim:phase=>{scheduledPhase=phase;},run:async phase=>{
    phaseStarted=true;
    if(phase==='google'){
     work.mark('google');google=await googleWorker.run();
     return {processed:0,followupsDeferred:true,sourceConsidered:0,sourceEnrolled:0,sourceDeferred:1,sourceWorkDeferred:true,optionalPhase:'google',...google};
    }
    const followupOrDiscovery=await runCachedReviewWorker({...sourceServices(context),engine,store,enabled:true,work,googleAvailable,scheduledPhase:phase});
    return {...followupOrDiscovery,googleDeferred:true};
   }});
  }else{
   result=await runReviewWorker({engine,store,eventMode:REVIEW_EVENTS.receive,reduceDiscovery:REVIEW_EVENTS.discoveryReduced,organizationId:REVIEW_AUTOMATION_ORGANIZATION,hivePaused:HIVE_INCIDENT.paused||!SOURCE_PLAN.reviewEnrollmentEnabled});
   if(result.workDeferred||!work.canStart(2000))google={googleDeferred:true};
   else{work.mark('google');google=await googleWorker.run();}
   result={...result,...google};
  }
  console.log('Review campaign result',JSON.stringify({phase:work.phase,scheduledPhase,phaseStarted,googleAvailable,turnDeferred:result.turnDeferred===true,schedulerBusy:result.schedulerBusy===true,followupsDeferred:result.followupsDeferred===true,elapsedMs:work.elapsed(),sourceWorkDeferred:result.sourceWorkDeferred===true,optionalPhase:result.optionalPhase||null,workDeferred:result.workDeferred===true,googleDeferred:result.googleDeferred===true,rowDeferred:result.rowDeferred||0,paused:result.paused===true,newIntakeHeld:result.newIntakeHeld===true,hivePaused:result.hivePaused===true,hiveDeferred:result.hiveDeferred||0,discoveryDeferred:result.discoveryDeferred===true,read:result.read||0,processed:result.processed||0,sourceConsidered:result.sourceConsidered||0,sourceEnrolled:result.sourceEnrolled||0,sourceDeferred:result.sourceDeferred||0,googlePaused:result.googlePaused===true,baselineCreated:result.baselineCreated===true,notified:result.notified||0}));
  return response(result);
 }catch(error){
  const category=reviewFailureCategory(error),deferred=isReviewDeadlineError(error,work);
  // Fixed categories only: never log arbitrary errors, identity data or credentials.
  console.error('Review campaign retained',JSON.stringify({phase:work.phase,scheduledPhase,phaseStarted,googleAvailable,elapsedMs:work.elapsed(),category,deferred,...(result?{processed:result.processed||0,sourceEnrolled:result.sourceEnrolled||0}:{})}));
  if(deferred)return response({...result,workDeferred:true,...(work.phase==='google'?{googleDeferred:true}:{}),phase:work.phase,scheduledPhase,phaseStarted});
  return response({...result,error:'Review processing requires retry',phase:work.phase,scheduledPhase,phaseStarted,category},503);
 }
};
export const config={schedule:'*/15 * * * *'};
