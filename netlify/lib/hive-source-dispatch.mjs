const maps={tags:'changedContacts',referrals:'changedInspections'};
// Private, changed-only queue. Rotate before attempting a job so one held record
// cannot starve the rest; acknowledge only matching versions after confirmed work.
export async function dispatchSourceChanges({kind,store,process,now=()=>Date.now()}){
 const map=maps[kind];if(!map)throw Error('Invalid consumer kind');
 const work=(await store.getWithMetadata('hive-source-work/v1',{type:'json'}))?.data;
 const entries=Object.entries(work?.[map]||{}).sort(([a],[b])=>a.localeCompare(b));
 if(!entries.length)return {processed:0,held:0};
 const key='hive-source-dispatch/'+kind,prior=await store.getWithMetadata(key,{type:'json'}),state=prior?.data||{offset:0,retries:{}};
 let job;
 for(let n=0;n<entries.length;n++){
  const index=((state.offset||0)+n)%entries.length,[id,revision]=entries[index],retry=state.retries[id];
  if(retry?.revision===revision&&retry.nextAttemptAt>now())continue;
  job={id,revision};state.offset=(index+1)%entries.length;break;
 }
 if(!job)return {processed:0,held:0};
 if((await store.setJSON(key,state,prior?{onlyIfMatch:prior.etag}:{onlyIfNew:true}))?.modified!==true)return {deferred:true};
 const result=await process([job]);
 if(result.completed?.some(x=>x.id===job.id&&x.revision===job.revision)){
  const latest=await store.getWithMetadata('hive-source-work/v1',{type:'json'});
  if(latest?.data?.[map]?.[job.id]===job.revision){
   const next=structuredClone(latest.data);delete next[map][job.id];
   if((await store.setJSON('hive-source-work/v1',next,{onlyIfMatch:latest.etag}))?.modified!==true)return {deferred:true};
  }
  return {processed:1,held:0};
 }
 if(result.held?.length){
  const retryState=await store.getWithMetadata(key,{type:'json'});
  const next=structuredClone(retryState.data);next.retries[job.id]={revision:job.revision,nextAttemptAt:now()+900000};
  if((await store.setJSON(key,next,{onlyIfMatch:retryState.etag}))?.modified!==true)return {deferred:true};
 }
 return {processed:0,held:result.held?.length||0};
}
