import {eligibleRecipients} from './review-policy.mjs';
import {assertSourceAuthority} from './hive-source-cache.mjs';
// Local cache discovery replaces polling; normal review follow-ups retain their
// existing send/consent/idempotency path in engine.run({discover:false}).
export async function runCachedReviewWorker({cache,view,engine,store,now=()=>Date.now(),enabled=false,limit=20}){
 if(!enabled)return {deferred:true};
 let considered=0,enrolled=0,deferred=0;
 try{
  const {state}=await cache.read();
  assertSourceAuthority(state,'inspections',{now:now(),maxAgeMs:86400000});
  const rows=Object.values(state.inspections).sort((a,b)=>a.id.localeCompare(b.id));
  const position=await store.get('hive-source-review-cursor',{type:'json'}),start=rows.length?(position?.offset||0)%rows.length:0;
  for(let step=0;step<rows.length;step++){
   if(considered>=limit)break;
   const at=(start+step)%rows.length,row=rows[at];
   if(row.deleted)continue;
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
   }catch{deferred++;const saved=await store.setJSON(key,{revision:row.revision,failed:true,nextAttemptAt:now()+900000});if(saved?.modified!==true)throw Error('Review retry checkpoint uncertain');}
  }
 }catch{deferred++;}
 // A stale cache/discovery failure must not starve previously qualified requests.
 const followups=await engine.run({discover:false});
 return {...followups,sourceConsidered:considered,sourceEnrolled:enrolled,sourceDeferred:deferred};
}
