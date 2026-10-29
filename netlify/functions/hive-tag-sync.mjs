import {SOURCE_PLAN} from '../lib/hive-source-sync.mjs';
import {sourceServices} from '../lib/hive-source-runtime.mjs';
import {dispatchSourceChanges} from '../lib/hive-source-dispatch.mjs';
import {reconcileChangedTags} from '../lib/hive-source-consumers.mjs';
import {HIVE_INCIDENT} from '../lib/hive-incident.mjs';
import {runtime,reviewStore,response} from '../lib/review-runtime.mjs';
export default async(_request,context)=>{
 if(HIVE_INCIDENT.paused){console.log('Hive API work deferred: monthly quota incident');return new Response(null,{status:204});}
 if(context?.deploy?.context!=='production')return response({skipped:true});
 if(!SOURCE_PLAN.enabled||!SOURCE_PLAN.tagReconciliationEnabled||!SOURCE_PLAN.automaticTagUpdatesVerified)return response({deferred:true});
 try{const services=sourceServices(context),catalog=await services.store.get('hive-source-tags/v1',{type:'json'});const result=await dispatchSourceChanges({kind:'tags',store:services.store,process:contactIds=>reconcileChangedTags({contactIds,view:services.view,catalog:catalog?{complete:true,names:catalog.data.map(t=>t.name),verifiedAt:catalog.checkedAt}:null,engine:runtime(context),checkpointStore:reviewStore(context),apply:true})});return response(result);}catch{return response({deferred:true});}

};
export const config={schedule:'*/5 * * * *'};
