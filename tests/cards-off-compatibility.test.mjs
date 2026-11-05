import test from 'node:test';
import assert from 'node:assert/strict';
import {runCardHistory,refreshSheetHistory,CARD_PROVIDER_HISTORY_PLAN} from '../netlify/lib/cards-sheet-runtime.mjs';
import {HISTORY_HEADERS,projectCard} from '../netlify/lib/cards-history.mjs';
import {fingerprint,hash} from '../netlify/lib/cards-core.mjs';
const now=Date.now();
function fixture(){
 const job={id:'pilot',revision:2,status:'APPROVED',snapshot:{agentId:'buyer',inspectionId:'inspection',agencyId:'agency',recipient:{firstName:'Pat',lastName:'Agent',address:'1 Office Lane',city:'Town',region:'NY',postcode:'10001',country:'US'}},idempotencyKey:'pilot',draftText:'Original wording',approvedText:'Exact edited owner wording',approval:{by:'Owner',at:now,artwork:{revision:'1'},fingerprint:'approval'},historyReconciled:true,projectionPending:false,createdAt:now,updatedAt:now};
 const row=Object.fromEntries(HISTORY_HEADERS.map(k=>[k,String(projectCard(job)[k]??'')]));row.record_id='pilot:v2';
 const snapshot={version:'append-history-v1',complete:true,headers:[...HISTORY_HEADERS],rows:[HISTORY_HEADERS.map(k=>row[k])],revision:'r1',evidence:'sheet'};
 let state={schema:1,revision:0,jobs:{pilot:structuredClone(job)},events:{},history:{},historyReady:{[hash('buyer')]:{complete:true}},audit:[],historyAudits:{buyer:{complete:true,evidence:'existing-independent-audit',verifiedAt:now-1000,expiresAt:now+86400000}},sheetReceipts:{'pilot:v2':{operationId:'prior-append',hash:fingerprint(row)}}};
 let etag=0;const appends=[];
 return {job,appends,store:{async getWithMetadata(){return {data:structuredClone(state),etag:String(etag)};},async setJSON(k,s,o){if(o.onlyIfMatch!==String(etag))return {modified:false};state=structuredClone(s);etag++;return {modified:true};}},sheet:{readComplete:async()=>structuredClone(snapshot),append:async a=>appends.push(a),lookup:async()=>({settled:true,status:'applied',record:appends.at(-1).record})},state:()=>state};
}
test('default OFF deployment leaves previously valid approved pilot and append state unchanged',async()=>{assert.equal(CARD_PROVIDER_HISTORY_PLAN.enabled,false);const f=fixture(),result=await runCardHistory({...f,production:true,now});assert.equal(result.projection,'idle');assert.equal(f.appends.length,0);assert.deepEqual(f.state().jobs.pilot,f.job);assert.equal(f.state().historyReady[hash('buyer')].complete,true);assert.equal(f.state().sheetAppend,undefined);});
test('strict pipeline refresh cannot use legacy audit shape as complete provider/legacy proof',async()=>{const f=fixture(),result=await refreshSheetHistory({...f,strictAudit:true,now});assert.equal(result.reports[0].status,'history_unreconciled');assert.equal(f.state().historyReady[hash('buyer')].complete,false);assert.equal(f.state().jobs.pilot.status,'HOLD');assert.equal(f.state().jobs.pilot.approvedText,null);assert.equal(f.appends.length,0);assert.equal(f.state().jobs.pilot.orderAttempt,undefined);});
