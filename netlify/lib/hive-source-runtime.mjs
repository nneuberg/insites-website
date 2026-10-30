import {getStore} from '@netlify/blobs';
import {HIVE_INCIDENT} from './hive-incident.mjs';
import {SOURCE_PLAN} from './hive-source-sync.mjs';
import {createHiveTransport} from './hive-transport.mjs';
import {createSourceCache} from './hive-source-cache.mjs';
import {createSourceView,HiveSourceDeferred} from './hive-source-view.mjs';
import {createHiveSourceLease} from './hive-source-lease.mjs';
// One company-scoped strong-consistency budget shared by every production caller.
// Preview/local stores cannot consume or modify production checkpoints.
export function sourceStore(context){
 const deployContext=context?.deploy?.context||process.env.CONTEXT||'local';
 const name=deployContext==='production'?'insites-hive-source':'insites-hive-source-'+(context?.deploy?.id||process.env.DEPLOY_ID||'local');
 return getStore({name,consistency:'strong'});
}
export function sourceTransport(context,{seedOnly=false}={}){
 return createHiveTransport({store:sourceStore(context),apiKey:process.env.HIVE_API_KEY,paused:seedOnly?false:HIVE_INCIDENT.paused||!SOURCE_PLAN.enabled,readOnly:seedOnly,requireQuota:seedOnly,verifiedProviderLimit:seedOnly?25000:10000,dailyBudget:100,rollingBudget:3000,timeoutMs:seedOnly?12000:8000});
}
export function sourceServices(context,{seedOnly=false}={}){
 const store=sourceStore(context),cache=createSourceCache({store});
 let barriersPromise;
 const barriers=()=>barriersPromise||=(async()=>{
  const work=await store.get('hive-source-work/v1',{type:'json'});
  if(work&&(!Array.isArray(work.invalidatedContactIds)||work.schema!==1))throw new HiveSourceDeferred('Source work state unavailable');
  const contacts=new Set(work?.invalidatedContactIds||[]),inspections=new Set(work?.invalidatedInspectionIds||[]);
  let global=work?.globalRoleDirty===true,read=0;
  // A newly received cancellation must block stale cache enrollment even before
  // the coordinator processes it. Snapshot once per invocation, never fetch Hive.
  for await(const page of store.list({prefix:'hive-source-events/pending/',paginate:true}))for(const blob of page.blobs){
   if(++read>1000)throw new HiveSourceDeferred('Source event backlog requires reconciliation');
   const event=await store.get(blob.key,{type:'json'});if(event?.state!=='pending')continue;
   if(event.event.startsWith('inspection.')){inspections.add(event.data.inspection.id);global=true;}
   else if(event.event.startsWith('contact.'))contacts.add(event.data.contact.id);
  }
  return {contacts,inspections,global};
 })();
 const view=createSourceView({cache,invalidatedIds:async()=>{const state=await barriers();if(state.global)throw new HiveSourceDeferred('Contact role authority awaits reconciliation');return state.contacts;},invalidatedInspectionIds:async()=>(await barriers()).inspections});
 return {store,cache,view,transport:sourceTransport(context,{seedOnly}),withLease:seedOnly?reconciledSeedLease(store):createHiveSourceLease({store}).withLease};
}

// One-time recovery of the operator-inspected, expired GET-only seed timeout.
// Keep all transport counters, cursors, cache and event receipts unchanged.
function reconciledSeedLease(store){
 const withLease=createHiveSourceLease({store,leaseMs:45000,workMs:25000}).withLease;
 return async(name,fn)=>{
  if(name!=='hive-source-coordinator')throw Error('Invalid seed lease');
  const key='hive-source/leases/1366a259b055c189e7ef12b148fe5d6f486384d7eeb810214e2d4fd9c9f2e5b1';
  const prior=await store.getWithMetadata(key,{type:'json'}),l=prior?.data;
  if(l?.quarantined&&l.fence===1&&l.acquiredAt===1793393413666&&l.until===1793393443666){
   const t=await store.get('hive-source/transport-v1',{type:'json'});
   const c=await store.get('hive-source-coordinator/v1',{type:'json'});
   const a=c?.active;
   if(Date.now()<l.until+60000||t?.inFlight!==null||t.blocked!==null||t.attempts!==1||t.successes!==0||t.failures!==1||t.lastReservationAt!==1793393423626||Object.values(t.reservedByDay||{}).reduce((s,n)=>s+n,0)!==1||a?.kind!=='contacts'||a.purpose!=='baseline'||a.traversal?.pages!==0||a.traversal?.nextCursor!==null||a.traversal?.rows?.length!==0)throw Error('Seed recovery requires reconciliation');
   if(!prior.etag||(await store.setJSON(key,{...l,until:0,quarantined:false,reconciled:'get-only-seed-timeout-20261030'},{onlyIfMatch:prior.etag}))?.modified!==true)throw Error('Seed recovery conflict');
  }
  return withLease(name,fn);
 };
}
