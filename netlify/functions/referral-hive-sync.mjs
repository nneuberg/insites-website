import {APPROVED_REFERRAL_FULL_SERVICE_IDS} from '../lib/referral-service-catalog.mjs';
import {hiveReader} from '../lib/referral-hive.mjs';
import {ledger} from '../lib/referral-transport.mjs';
import {reconcileTick} from '../lib/referral-reconcile.mjs';
export default async()=>{
 if(process.env.REFERRAL_HIVE_SYNC_ENABLED!=='true'){console.log('Referral Hive sync is disabled');return new Response(null,{status:204});}
 const {getStore}=await import('@netlify/blobs');
 const state=getStore({name:'insites-referral-sync',consistency:'strong'});
 const queue=getStore({name:'insites-referral-hive-events',consistency:'strong'});
 const listed=await queue.list({prefix:'pending/'});
 const pending=[];
 for(const item of listed.blobs.slice(0,1)){const job=await queue.get(item.key,{type:'json'});if(job)pending.push({...job,key:item.key});}
 const report=await reconcileTick({read:hiveReader(),callLedger:(a,d)=>ledger(a,d,process.env,10000),loadState:()=>state.get('cursor',{type:'json'}),saveState:s=>state.setJSON('cursor',s),pending,ack:key=>queue.delete(key),serviceIds:APPROVED_REFERRAL_FULL_SERVICE_IDS});
 const result={...report,checkedAt:new Date().toISOString(),mode:'LEDGER ONLY; no emails or rewards'};
 await state.setJSON('latest',result);console.log(JSON.stringify(result));return new Response(null,{status:204});
};
export const config={schedule:'*/5 * * * *'};
