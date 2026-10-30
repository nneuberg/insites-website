import {HIVE_INCIDENT} from '../lib/hive-incident.mjs';
import {SOURCE_PLAN} from '../lib/hive-source-sync.mjs';
import {sourceServices} from '../lib/hive-source-runtime.mjs';
import {runHiveSourceCoordinator} from '../lib/hive-source-coordinator.mjs';
export default async(_request,context)=>{
 if(context?.deploy?.context!=='production'||!SOURCE_PLAN.seedOnly&&(HIVE_INCIDENT.paused||!SOURCE_PLAN.enabled))return new Response(null,{status:204});
 try{const result=await runHiveSourceCoordinator({...sourceServices(context,{seedOnly:SOURCE_PLAN.seedOnly===true}),enabled:true,contactDeletionRecoveryVerified:SOURCE_PLAN.contactDeletionRecoveryVerified});console.log('Hive shared source',JSON.stringify(result));return new Response(null,{status:204});}
 catch(error){console.error('Hive source work retained',error.code||'SOURCE_HELD');return new Response(null,{status:204});}
};
export const config={schedule:'*/5 * * * *'};
