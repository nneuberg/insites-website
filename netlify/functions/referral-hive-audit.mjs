import {HIVE_INCIDENT} from '../lib/hive-incident.mjs';
import {SOURCE_PLAN} from '../lib/hive-source-sync.mjs';
import {sourceServices} from '../lib/hive-source-runtime.mjs';
import {assertSourceAuthority} from '../lib/hive-source-cache.mjs';
import {matchReferral} from '../lib/referral-hive.mjs';
import {APPROVED_REFERRAL_FULL_SERVICE_IDS} from '../lib/referral-service-catalog.mjs';
import {ledger} from '../lib/referral-transport.mjs';
// Read-only audit of shared source; never an independent API scan.
export default async(_request,context)=>{
 if(HIVE_INCIDENT.paused){console.log('Hive API work deferred: monthly quota incident');return new Response(null,{status:204});}
 if(context?.deploy?.context!=='production'||!SOURCE_PLAN.enabled)return new Response(null,{status:204});
 try{
  const {store,cache,view}=sourceServices(context),{state}=await cache.read();
  assertSourceAuthority(state,'inspections',{now:Date.now(),maxAgeMs:86400000});
  const snapshot=await ledger('codeSnapshot',{},process.env,8000),results=[];
  for(const row of Object.values(state.inspections)){if(row.deleted)continue;const result=matchReferral(await view.getInspection(row.id),snapshot,{serviceIds:APPROVED_REFERRAL_FULL_SERVICE_IDS});if(result.matched||result.hold)results.push({inspectionId:row.id,matched:result.matched,hold:result.hold||null});}
  if((await store.setJSON('hive-source-referral-audit',{checkedAt:new Date().toISOString(),results,mode:'CACHE READ ONLY; no rewards or messages'}))?.modified!==true)throw Error('Audit checkpoint uncertain');
 }catch{console.error('Referral audit held for source verification');}
 return new Response(null,{status:204});
};
export const config={schedule:'0 8 * * *'};
