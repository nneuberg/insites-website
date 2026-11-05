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
 const work=createReviewWorkBudget();let result=null;
 console.log('Review campaign started',JSON.stringify({phase:work.phase,elapsedMs:work.elapsed(),workBudgetMs:REVIEW_WORK_MS}));
 try{
  const engine=runtime(context,{work}),store=reviewStore(context);
  const googleWorker=googleSync({store,engine,env:reviewEnvironment(),work,fetcher:work.wrapFetch()}),googleAvailable=googleWorker.ready();
  result=SOURCE_PLAN.enabled&&SOURCE_PLAN.reviewEnrollmentEnabled&&!HIVE_INCIDENT.paused
   ?await runCachedReviewWorker({...sourceServices(context),engine,store,enabled:true,work,googleAvailable})
   :await runReviewWorker({engine,store,eventMode:REVIEW_EVENTS.receive,reduceDiscovery:REVIEW_EVENTS.discoveryReduced,organizationId:REVIEW_AUTOMATION_ORGANIZATION,hivePaused:HIVE_INCIDENT.paused||!SOURCE_PLAN.reviewEnrollmentEnabled});
  let google;
  if(result.workDeferred||!work.canStart(2000)||result.optionalPhase==='deferred'||googleAvailable&&result.optionalPhase==='discovery')google={googleDeferred:true};
  else{work.mark('google');google=await googleWorker.run();}
  console.log('Review campaign result',JSON.stringify({phase:work.phase,elapsedMs:work.elapsed(),sourceWorkDeferred:result.sourceWorkDeferred===true,optionalPhase:result.optionalPhase||null,workDeferred:result.workDeferred===true,googleDeferred:google.googleDeferred===true,rowDeferred:result.rowDeferred||0,paused:result.paused===true,newIntakeHeld:result.newIntakeHeld===true,hivePaused:result.hivePaused===true,hiveDeferred:result.hiveDeferred||0,discoveryDeferred:result.discoveryDeferred===true,read:result.read||0,processed:result.processed||0,sourceConsidered:result.sourceConsidered||0,sourceEnrolled:result.sourceEnrolled||0,sourceDeferred:result.sourceDeferred||0,googlePaused:google.googlePaused===true,baselineCreated:google.baselineCreated===true,notified:google.notified||0}));
  return response({...result,...google});
 }catch(error){
  const category=reviewFailureCategory(error),deferred=isReviewDeadlineError(error,work);
  // Fixed categories only: never log arbitrary errors, identity data or credentials.
  console.error('Review campaign retained',JSON.stringify({phase:work.phase,elapsedMs:work.elapsed(),category,deferred,...(result?{processed:result.processed||0,sourceEnrolled:result.sourceEnrolled||0}:{})}));
  if(deferred)return response({...result,workDeferred:true,...(work.phase==='google'?{googleDeferred:true}:{}),phase:work.phase});
  return response({...result,error:'Review processing requires retry',phase:work.phase,category},503);
 }
};
export const config={schedule:'*/15 * * * *'};
