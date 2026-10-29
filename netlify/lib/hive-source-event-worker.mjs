import {planHiveSourceEvent} from './hive-source-event-plan.mjs';

export const SOURCE_COORDINATOR_LEASE='hive-source-coordinator';
export const SOURCE_WORK_KEY='hive-source-work/v1';
const idOK=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(x);
const names=['pendingInspectionIds','refreshContactIds','invalidatedContactIds'];
function readWork(value){
 if(value==null)return {schema:1,pendingInspectionIds:[],refreshContactIds:[],invalidatedContactIds:[],invalidatedInspectionIds:[],globalRoleDirty:false};
 if(value.schema!==1||typeof value.globalRoleDirty!=='boolean'||names.some(k=>!Array.isArray(value[k])||value[k].some(x=>!idOK(x))))throw Error('Invalid source work state');
 if(value.invalidatedInspectionIds!==undefined&&(!Array.isArray(value.invalidatedInspectionIds)||value.invalidatedInspectionIds.some(x=>!idOK(x))))throw Error('Invalid source inspection invalidation');
 return {...structuredClone(value),invalidatedInspectionIds:value.invalidatedInspectionIds||[]};
}
const union=(a,b)=>[...new Set([...a,...b])].sort();

// withLease(name, fn) MUST acquire the same exclusive durable coordinator lease
// used by source scans. No caller may implement it as a no-op in production.
// Acknowledge only after unioned work and authoritative contact updates persist.
export async function runHiveSourceEventWorker({store,cache,withLease,enabled=false,limit=10,now=()=>Date.now()}={}){
 if(enabled!==true)return {deferred:true,processed:0,failed:0,requests:0};
 if(typeof withLease!=='function'||typeof cache?.apply!=='function'||typeof store?.getWithMetadata!=='function'||typeof store?.setJSON!=='function'||typeof store?.list!=='function'||typeof store?.delete!=='function')throw Error('Durable cache, store and shared coordinator lease required');
 if(!Number.isInteger(limit)||limit<1||limit>10)throw Error('Source event limit must be1–10');
 return withLease(SOURCE_COORDINATOR_LEASE,async(lease)=>{
  if(typeof lease?.assertHeld!=='function')throw Error('Fenced shared lease required');
  await lease.assertHeld();
  let attempted=0,processed=0,failed=0;
  async function archive(key,row){
   const receiptKey='hive-source-event-receipts/'+key.slice('hive-source-events/pending/'.length);
   const receipt={schema:1,eventId:row.eventId,organizationId:row.organizationId,digest:row.digest,state:'done',completedAt:row.completedAt};
   if(typeof receipt.digest!=='string'||!receipt.digest)throw Error('Completion digest missing');
   await lease.assertHeld();
   const saved=await store.setJSON(receiptKey,receipt,{onlyIfNew:true});
   if(saved?.modified!==true){const old=await store.getWithMetadata(receiptKey,{type:'json'});if(old?.data?.digest!==receipt.digest||old.data.eventId!==receipt.eventId||old.data.organizationId!==receipt.organizationId)throw Error('Completion receipt uncertain');}
   await lease.assertHeld();
   await store.delete(key);
   if(await store.getWithMetadata(key,{type:'json'}))throw Error('Pending queue deletion uncertain');
  }
  for await(const page of store.list({prefix:'hive-source-events/pending/',paginate:true})){
   if(!Array.isArray(page?.blobs))throw Error('Incomplete queue listing');
   for(const blob of page.blobs){
    if(attempted>=limit)return {processed,failed,requests:0};
    if(typeof blob?.key!=='string'||!blob.key.startsWith('hive-source-events/pending/'))throw Error('Invalid source event key');
    const entry=await store.getWithMetadata(blob.key,{type:'json'});
    if(!['pending','done'].includes(entry?.data?.state))continue;
    attempted++;
    try{
     if(typeof entry.etag!=='string'||!entry.etag)throw Error('Event conditional-write identity missing');
     if(entry.data.state==='done'){await archive(blob.key,entry.data);processed++;continue;}
     const plan=planHiveSourceEvent(entry.data);
     const old=await store.getWithMetadata(SOURCE_WORK_KEY,{type:'json'}),work=readWork(old?.data);
     if(old&&(typeof old.etag!=='string'||!old.etag))throw Error('Work conditional-write identity missing');
     work.pendingInspectionIds=union(work.pendingInspectionIds,plan.pendingInspectionIds);
     work.invalidatedInspectionIds=union(work.invalidatedInspectionIds,plan.pendingInspectionIds);
     work.refreshContactIds=union(work.refreshContactIds,plan.refreshContactIds);
     work.invalidatedContactIds=union(work.invalidatedContactIds,plan.refreshContactIds);
     work.changedContacts||={};
     for(const row of plan.contactUpdates)work.changedContacts[row.id]=Math.max(work.changedContacts[row.id]||0,row.revision);
     work.globalRoleDirty=work.globalRoleDirty||plan.invalidateContactRoleAuthority;
     await lease.assertHeld();
     const saved=await store.setJSON(SOURCE_WORK_KEY,work,old?{onlyIfMatch:old.etag}:{onlyIfNew:true});
     if(saved?.modified!==true)throw Error('Source work state not durably reserved');
     if(plan.contactUpdates.length){
      await lease.assertHeld();
      const applied=await cache.apply(plan.contactUpdates);
      if(applied?.schema!==1)throw Error('Cache publication not acknowledged');
     }
     await lease.assertHeld();
     const ack=await store.setJSON(blob.key,{...entry.data,state:'done',completedAt:now()},{onlyIfMatch:entry.etag});
     if(ack?.modified!==true)throw Error('Event acknowledgment uncertain');
     await archive(blob.key,{...entry.data,state:'done',completedAt:now()});
     processed++;
    }catch{failed++;} // Source event remains pending unless its durable ack succeeded.
   }
  }
  return {processed,failed,requests:0};
 });
}
