import {drainReviewEvents} from './review-events.mjs';
const DAY=86400000;
// Explicit migration gate remains false until signed Automation deliveries and
// the configured organization/decoder have been verified end-to-end.
export async function runReviewWorker({engine,store,eventMode=false,reduceDiscovery=true,organizationId,now=()=>Date.now(),hivePaused=false}){
 // Keep already-qualified requests and Google feedback usable during containment.
 // Do not acknowledge queued events or advance discovery watermarks.
 if(hivePaused)return {...await engine.run({discover:false}),hivePaused:true};
 if(!eventMode)return engine.run();
 if(!organizationId)throw Error('Verified Hive organization required');
 const events=await drainReviewEvents({engine,store,organizationId,now});
 const recovery=await store.get('review-recovery',{type:'json'});
 const cursor=(await store.get('scan',{type:'json'}))?.cursor;
 // Finish bounded pagination across ticks; start a fresh recovery scan daily.
 const discover=!reduceDiscovery||!!cursor||!recovery||now()-recovery.completedAt>=DAY;
 const result=await engine.run({discover});
 if(discover&&!result.paused&&!result.discoveryDeferred&&!(await store.get('scan',{type:'json'}))?.cursor)
  await store.setJSON('review-recovery',{completedAt:now()});
 return {...result,eventProcessed:events.processed,eventFailed:events.failed};
}
