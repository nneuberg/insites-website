import {SOURCE_PLAN} from '../lib/hive-source-sync.mjs';
import {sourceServices} from '../lib/hive-source-runtime.mjs';
import {dispatchSourceChanges} from '../lib/hive-source-dispatch.mjs';
import {reconcileChangedReferrals} from '../lib/hive-source-consumers.mjs';
import {HIVE_INCIDENT} from '../lib/hive-incident.mjs';
import {APPROVED_REFERRAL_FULL_SERVICE_IDS} from '../lib/referral-service-catalog.mjs';
import {ledger} from '../lib/referral-transport.mjs';
export default async(_request,context)=>{
 if(HIVE_INCIDENT.paused){console.log('Hive API work deferred: monthly quota incident');return new Response(null,{status:204});}
 if(context?.deploy?.context!=='production')return new Response(null,{status:204});
 if(process.env.REFERRAL_HIVE_SYNC_ENABLED!=='true'){console.log('Referral Hive sync is disabled');return new Response(null,{status:204});}
 const services=sourceServices(context);
 if(!SOURCE_PLAN.enabled||!SOURCE_PLAN.referralReconciliationEnabled||!SOURCE_PLAN.ledgerFencingVerified)return new Response(null,{status:204});
 try{await dispatchSourceChanges({kind:'referrals',store:services.store,process:inspectionIds=>reconcileChangedReferrals({inspectionIds,view:services.view,callLedger:(a,d,options)=>ledger(a,d,process.env,8000,options),checkpointStore:services.store,locked:services.withLease,serviceIds:APPROVED_REFERRAL_FULL_SERVICE_IDS})});}catch{console.error('Referral source work retained');}
 return new Response(null,{status:204});
};
export const config={schedule:'*/5 * * * *'};
