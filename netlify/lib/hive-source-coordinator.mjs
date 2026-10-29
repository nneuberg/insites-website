import {beginSourceTraversal,appendSourcePage,finishSourceTraversal} from './hive-source-cache.mjs';
import {sourceListPath,sourceIdBatches,normalizeListRecord,SOURCE_PLAN} from './hive-source-sync.mjs';
import {runHiveSourceEventWorker,SOURCE_COORDINATOR_LEASE,SOURCE_WORK_KEY} from './hive-source-event-worker.mjs';
export const SOURCE_COORDINATOR_KEY='hive-source-coordinator/v1';
const DAY=86400000,HOUR=3600000;
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const deferred=error=>({deferred:true,reason:error.reason,requests:['incident-paused','credentials-missing','daily-budget','rolling-budget','request-busy','backoff','clock-regressed'].includes(error.reason)?0:null});
const union=(a=[],b=[])=>[...new Set([...a,...b])].sort();
const workEmpty=()=>({schema:1,pendingInspectionIds:[],refreshContactIds:[],invalidatedContactIds:[],invalidatedInspectionIds:[],globalRoleDirty:false,changedContacts:{},changedInspections:{}});
async function save(store,key,data){const old=await store.getWithMetadata(key,{type:'json'});const result=await store.setJSON(key,data,old?{onlyIfMatch:old.etag}:{onlyIfNew:true});if(result?.modified!==true)throw Error('Coordinator checkpoint not durable');}
async function updateWork(store,fn){const old=await store.getWithMetadata(SOURCE_WORK_KEY,{type:'json'});const value=old?.data||workEmpty();if(value.schema!==1||!['pendingInspectionIds','refreshContactIds','invalidatedContactIds'].every(k=>Array.isArray(value[k]))||typeof value.globalRoleDirty!=='boolean')throw Error('Invalid source work state');const data=fn(structuredClone(value));const saved=await store.setJSON(SOURCE_WORK_KEY,data,old?{onlyIfMatch:old.etag}:{onlyIfNew:true});if(saved?.modified!==true)throw Error('Source work conflict');return data;}
// This retires only repetitive ID polling, not the cached inspection, change
// queue, event receipts, or eligibility history. Later events/deltas can requeue.
// Missing/ambiguous/unpaid/unsigned records never age out of the pending set.
function terminalInspection(row,at){
 const i=row.data;
 if(row.deleted===true)return true;
 if(i.status==='canceled'&&typeof i.canceled_at==='string'&&Number.isFinite(Date.parse(i.canceled_at))&&Date.parse(i.canceled_at)<=at)return true;
 const end=Date.parse(i.ends_at||'');
 return i.deleted===false&&i.canceled_at===null&&i.status==='confirmed'&&i.confirmed===true&&
  Number.isFinite(end)&&end<=at&&i.price?.paid===true&&i.price?.payment_status==='paid'&&
  i.price?.amount_due===0&&Number.isFinite(i.price?.amount_paid)&&i.price.amount_paid>0&&
  i.agreements?.all_signed===true&&i.reports?.status==='published'&&
  Array.isArray(i.reports.items)&&i.reports.items.length>0&&
  i.reports.items.every(r=>typeof r?.id==='string'&&r.id&&r.status==='published')&&
  new Set(i.reports.items.map(r=>r.id)).size===i.reports.items.length;
}
function contactIds(record){if(!Array.isArray(record?.contacts)||record.contacts.some(c=>typeof c?.id!=='string'))return null;return record.contacts.map(c=>c.id);}
// One lease and at most ONE provider request per tick. No send/eligibility action.
// All callers must share company-scoped strong-consistency storage and transport.
export async function runHiveSourceCoordinator({store,cache,transport,withLease,enabled=false,now=()=>Date.now(),historyComplete=false,contactDeletionRecoveryVerified=false}={}){
 if(enabled!==true)return {deferred:true,requests:0};
 if(typeof withLease!=='function'||typeof transport?.request!=='function')throw Error('Shared lease and quota transport required');
 return withLease(SOURCE_COORDINATOR_LEASE,async(lease)=>{
  if(typeof lease?.assertHeld!=='function')throw Error('Fenced source lease required');
  const originalStore=store,originalCache=cache,originalTransport=transport;
  transport={request:async(...args)=>{await lease.assertHeld();return originalTransport.request(...args)}};
  store=new Proxy(originalStore,{get(target,key){if(key==='delete')return async(...args)=>{await lease.assertHeld();return target.delete(...args)};if(key==='setJSON')return async(...args)=>{await lease.assertHeld();return target.setJSON(...args)};const value=target[key];return typeof value==='function'?value.bind(target):value}});
  cache={...cache,apply:async(...args)=>{await lease.assertHeld();return originalCache.apply(...args)},publishTraversal:async(...args)=>{await lease.assertHeld();return originalCache.publishTraversal(...args)}};
  let state=(await store.getWithMetadata(SOURCE_COORDINATOR_KEY,{type:'json'}))?.data||{schema:1,active:null,hourlyAt:0,tagsAt:0,pendingAt:0,fullRolesAt:0,contactsAt:0,contactsOffset:0,pendingOffset:0};
  if(state.schema!==1)throw Error('Invalid coordinator state');
  if(state.resumeAfter>now())return {deferred:true,reason:'source-page-backoff',requests:0};
  // Do not mutate cache midway through a paginated generation. New webhook
  // messages remain durably pending and are handled on the next idle tick.
  if(!state.active)await runHiveSourceEventWorker({store,cache,enabled:true,now,withLease:async(name,fn)=>{if(name!==SOURCE_COORDINATOR_LEASE)throw Error('Wrong lease');return fn(lease);}});
  let work=(await store.getWithMetadata(SOURCE_WORK_KEY,{type:'json'}))?.data||workEmpty();
  const snap=await cache.read();
  async function start(kind,purpose,params={},scope='selective'){
   const mode=purpose==='delta'?'delta':'full';
   state.active={kind,purpose,params,snapshot:snap,traversal:beginSourceTraversal(snap.state,{kind,mode,startedAt:now(),scope,historyComplete:kind==='inspections'&&scope==='all'&&historyComplete,overlapMs:SOURCE_PLAN.overlapMs})};
   await save(store,SOURCE_COORDINATOR_KEY,state);
  }
  if(!state.active){
   // Existing incomplete baseline is resumed, never restarted on every tick.
   for(const kind of ['contacts','inspections'])if(!snap.state.coverage[kind]?.complete&&(!snap.state.coverage[kind]||now()-snap.state.coverage[kind].watermark>=DAY)){await start(kind,'baseline',{},'all');break;}
   const pendingBatches=sourceIdBatches(work.pendingInspectionIds);
   if(!state.active&&work.globalRoleDirty&&pendingBatches.length&&now()-state.pendingAt>=HOUR)await start('inspections','pending',{ids:pendingBatches[(state.pendingOffset||0)%pendingBatches.length]});
   if(!state.active&&work.refreshContactIds.length&&now()-(state.contactsAt||0)>=HOUR)await start('contacts','contacts',{ids:sourceIdBatches(work.refreshContactIds)[(state.contactsOffset||0)%sourceIdBatches(work.refreshContactIds).length]});
   if(!state.active&&work.globalRoleDirty&&now()-state.fullRolesAt>=DAY)await start('contacts','roles',{},'all');
   if(!state.active)for(const kind of ['contacts','inspections'])if(now()-snap.state.coverage[kind].watermark>=DAY){await start(kind,kind==='contacts'&&!contactDeletionRecoveryVerified?'contacts-safety':'delta',{},'all');break;}
   if(!state.active&&now()-state.tagsAt>=DAY){
    try{const response=await transport.request('tags');const page=await response.json();if(!Array.isArray(page.data)||page.next_cursor!==null||page.total!==page.data.length||page.data.length>200)throw Error('Incomplete tag catalog');await save(store,'hive-source-tags/v1',{schema:1,checkedAt:now(),data:page.data});state.tagsAt=now();await save(store,SOURCE_COORDINATOR_KEY,state);return {requests:1,task:'tags'};}catch(error){if(error.code==='HIVE_TRANSPORT_DEFERRED')return deferred(error);throw error;}
   }
   if(!state.active&&now()-state.hourlyAt>=HOUR)await start('inspections','hourly',{eligibleAfter:now()-7*DAY});
   if(!state.active&&work.pendingInspectionIds.length&&now()-state.pendingAt>=DAY)await start('inspections','pending',{ids:pendingBatches[(state.pendingOffset||0)%pendingBatches.length]});
   if(!state.active)return {deferred:true,requests:0};
  }
  const task=state.active;let requests=0;
  if(!task.traversal.done){
   const t=task.traversal,params={...task.params,cursor:t.nextCursor,...(task.purpose==='delta'?{since:t.since}:{})};
   try{const response=await transport.request(sourceListPath(task.kind,params));requests=1;const page=await response.json();task.traversal=appendSourcePage(t,{cursor:t.nextCursor,rows:page.data.map(r=>normalizeListRecord(task.kind,r)),nextCursor:page.next_cursor,total:page.total});await save(store,SOURCE_COORDINATOR_KEY,state);}
   catch(error){if(error.code==='HIVE_TRANSPORT_DEFERRED')return deferred(error);if(requests===1){state.active=null;state.resumeAfter=now()+HOUR;await save(store,SOURCE_COORDINATOR_KEY,state);return {deferred:true,reason:'source-page-invalid',requests:1};}throw error;}
  }
  const t=task.traversal;if(!t.done)return {requests,task:task.purpose,complete:false};
  const all=t.scope==='all',current=await cache.read();
  await lease.assertHeld();
  // A completed cache publish followed by a failed work checkpoint is replayable.
  if(all){if(!same(current.state,finishSourceTraversal(t)))await cache.publishTraversal(task.snapshot,t);}
  else {const applied=await cache.apply(t.rows);if(applied?.schema!==1)throw Error('Cache publication unacknowledged');}
  const published=(await cache.read()).state;
  work=await updateWork(store,w=>{
   const changes=task.kind==='contacts'?'changedContacts':'changedInspections';w[changes]||={};
   for(const row of t.rows){const before=task.snapshot.state[task.kind][row.id];if(!before||before.revision!==row.revision||before.deleted!==row.deleted)w[changes][row.id]=Math.max(w[changes][row.id]||0,row.revision);}
   if(task.kind==='contacts'){
    const received=new Set(t.rows.map(r=>r.id));w.refreshContactIds=w.refreshContactIds.filter(id=>!received.has(id));w.invalidatedContactIds=w.invalidatedContactIds.filter(id=>!received.has(id));
    if(['roles','contacts-safety'].includes(task.purpose)&&published.coverage.contacts?.complete&&!Object.keys(published.conflicts).some(k=>k.startsWith('contacts:'))){w.globalRoleDirty=false;w.roleMappingUnknown=false;}
    else if(!w.roleMappingUnknown&&!(w.invalidatedInspectionIds||[]).length&&!w.refreshContactIds.length&&!w.invalidatedContactIds.length)w.globalRoleDirty=false;
   }else{
    const received=new Set(t.rows.map(r=>r.id));w.invalidatedInspectionIds=(w.invalidatedInspectionIds||[]).filter(id=>!received.has(id));
    for(const row of t.rows){const old=task.snapshot.state.inspections[row.id];
     if(old&&old.revision===row.revision&&old.deleted===row.deleted&&JSON.stringify(old.data.contacts)===JSON.stringify(row.data.contacts))continue;
     const oldIds=old?contactIds(old.data):null,newIds=contactIds(row.data);
     const knownNew=!old&&task.snapshot.state.coverage.inspections?.complete&&Date.parse(row.data.created_at)>=task.snapshot.state.coverage.inspections.watermark;
     if(!newIds||!oldIds&&!knownNew){w.globalRoleDirty=true;w.roleMappingUnknown=true;}
     const ids=union(oldIds||[],newIds||[]);w.refreshContactIds=union(w.refreshContactIds,ids);w.invalidatedContactIds=union(w.invalidatedContactIds,ids);
    }
    // Only the exact, conflict-free revision just published may retire polling.
    // An older fetch ignored by the cache cannot clear a newer pending state.
    const terminal=new Set(t.rows.filter(row=>{
     const current=published.inspections[row.id];
     return current?.revision===row.revision&&current.deleted===row.deleted&&same(current.data,row.data)&&
      !Object.hasOwn(published.conflicts,'inspections:'+row.id)&&terminalInspection(row,now());
    }).map(row=>row.id));
    w.pendingInspectionIds=w.pendingInspectionIds.filter(id=>!terminal.has(id));
    // A reopened lifecycle discovered through delta (not just webhook) restores
    // polling. Do not bulk-enqueue unknown legacy baseline history here.
    const reopened=t.rows.filter(row=>{
     const old=task.snapshot.state.inspections[row.id],current=published.inspections[row.id];
     return old&&terminalInspection(old,now())&&!terminalInspection(row,now())&&
      current?.revision===row.revision&&same(current.data,row.data)&&
      !Object.hasOwn(published.conflicts,'inspections:'+row.id);
    }).map(row=>row.id);
    w.pendingInspectionIds=union(w.pendingInspectionIds,reopened);
    // IDs omitted by a batch remain pending; absence never becomes deletion.
   }
   return w;
  });
  if(task.purpose==='hourly')state.hourlyAt=t.startedAt;
  if(task.purpose==='pending'){
   const batches=sourceIdBatches(work.pendingInspectionIds),attempted=task.params.ids||[];
   const removed=attempted.some(id=>!work.pendingInspectionIds.includes(id));
   // Pruning changes page boundaries. Never advance the old numeric offset into
   // the shrunken list and skip the unvisited next batch. A repeat is harmless.
   const later=work.pendingInspectionIds.some(id=>id>attempted.at(-1));
   const next=removed?0:(state.pendingOffset||0)+1;
   if(!batches.length||!later||next>=batches.length){state.pendingAt=t.startedAt;state.pendingOffset=0;}else state.pendingOffset=next;
  }
  if(task.purpose==='contacts'){state.contactsAt=t.startedAt;const count=sourceIdBatches(work.refreshContactIds).length;state.contactsOffset=count?((state.contactsOffset||0)+1)%count:0;}
  if(['roles','contacts-safety'].includes(task.purpose))state.fullRolesAt=t.startedAt;
  state.active=null;await save(store,SOURCE_COORDINATOR_KEY,state);
  return {requests,task:task.purpose,complete:true};
 });
}
