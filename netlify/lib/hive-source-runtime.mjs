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
export function sourceTransport(context){
 return createHiveTransport({store:sourceStore(context),apiKey:process.env.HIVE_API_KEY,paused:HIVE_INCIDENT.paused||!SOURCE_PLAN.enabled,dailyBudget:100,rollingBudget:3000,timeoutMs:8000});
}
export function sourceServices(context){
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
 return {store,cache,view,transport:sourceTransport(context),withLease:createHiveSourceLease({store}).withLease};
}
