import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHiveTransport} from '../netlify/lib/hive-transport.mjs';
import {SOURCE_PLAN} from '../netlify/lib/hive-source-sync.mjs';
import {HIVE_INCIDENT} from '../netlify/lib/hive-incident.mjs';
test('seed recovery preserves holds and enforces GET-only, provider reserve, malformed quota and shared caps',async()=>{
 assert.equal(HIVE_INCIDENT.paused,true);assert.equal(SOURCE_PLAN.enabled,false);assert.equal(SOURCE_PLAN.seedOnly,true);
 for(const k of ['reviewEnrollmentEnabled','referralReconciliationEnabled','tagReconciliationEnabled','ledgerFencingVerified'])assert.equal(SOURCE_PLAN[k],false);
 const sync=readFileSync(new URL('../netlify/functions/hive-source-sync.mjs',import.meta.url),'utf8');assert.match(sync,/deploy\?\.context!=='production'/);
 async function run(headers,opts={}){
  let row=null,n=0,calls=0;
  const store={async getWithMetadata(){return row},async setJSON(k,data){row={data:structuredClone(data),etag:String(++n)};return{modified:true}}};
  const transport=createHiveTransport({store,apiKey:'synthetic',paused:false,readOnly:true,requireQuota:true,verifiedProviderLimit:25000,fetcher:async()=>{calls++;return Response.json({data:[]},{headers})},...opts});
  await assert.rejects(transport.request('contacts/x',{method:'PATCH',body:{}}),/seed-read-only/);assert.equal(calls,0);
  return {transport,calls:()=>calls,state:()=>row?.data};
 }
 const headers={'Hive-Quota-Limit':'25000','Hive-Quota-Used':'15001','Hive-Quota-Remaining':'9999'};
 const good=await run(headers,{dailyBudget:1});assert.equal((await good.transport.request('contacts?limit=200')).status,200);await assert.rejects(good.transport.request('contacts'),/daily-budget/);assert.equal(good.calls(),1);assert.equal(good.state().attempts,1);
 const rolling=await run(headers,{rollingBudget:1});await rolling.transport.request('contacts');await assert.rejects(rolling.transport.request('contacts'),/rolling-budget/);
 for(const [h,reason] of [[{},'quota-headers-unverified'],[{'Hive-Quota-Limit':'25000','Hive-Quota-Used':'24000','Hive-Quota-Remaining':'1000'},'provider-quota-reserve']]){const f=await run(h);await assert.rejects(f.transport.request('contacts'),new RegExp(reason));await assert.rejects(f.transport.request('contacts'),new RegExp(reason));assert.equal(f.calls(),1);assert.equal(f.state().attempts,1);}
});
