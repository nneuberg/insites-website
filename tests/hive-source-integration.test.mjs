import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {createEngine} from '../netlify/lib/review-engine.mjs';
import {hiveReader} from '../netlify/lib/referral-hive.mjs';
test('review Hive reads and writes both use injected shared transport',async()=>{
 const calls=[],engine=createEngine({store:{},env:{HIVE_API_KEY:'synthetic'},fetcher:()=>{throw Error('raw bypass');},hiveTransport:{async request(path,options){calls.push({path,options});return Response.json({ok:true});}}});
 await engine.hive('contacts/id');await engine.hive('contacts/id',{tags:['google reviewed']});
 assert.equal(calls.length,2);assert.equal(calls[0].options.method,'GET');assert.equal(calls[1].options.method,'PATCH');
});
test('review pause wins before sharedtransport or rawfetch',async()=>{let calls=0;const engine=createEngine({store:{},env:{HIVE_API_KEY:'synthetic'},hivePaused:true,hiveTransport:{request(){calls++;}},fetcher(){calls++;}});await assert.rejects(engine.hive('contacts/id'));assert.equal(calls,0);});
test('referral reader delegates to same injectedtransport withoutfallback',async()=>{let calls=0;const read=hiveReader({HIVE_API_KEY:'synthetic'},()=>{throw Error('raw bypass');},{async request(){calls++;return Response.json({data:[]});}});await read('inspections?limit=200');assert.equal(calls,1);});
test('production consumers have no independent Hive reader',async()=>{
 for(const file of ['referral-hive-sync','referral-hive-audit','referral-claim','hive-tag-sync']){const s=await readFile(new URL('../netlify/functions/'+file+'.mjs',import.meta.url),'utf8');assert.doesNotMatch(s,/hiveReader\(/);}
 const runtime=await readFile(new URL('../netlify/lib/review-runtime.mjs',import.meta.url),'utf8');assert.match(runtime,/hiveTransport:sourceTransport\(functionContext\)/);
});
test('containment and replacement activation remain failclosed',async()=>{
 const {HIVE_INCIDENT}=await import('../netlify/lib/hive-incident.mjs');const {SOURCE_PLAN}=await import('../netlify/lib/hive-source-sync.mjs');const {CLAIM_LAUNCH,CLAIM_WORKER}=await import('../netlify/lib/referral-claim-launch.mjs');
 assert.equal(HIVE_INCIDENT.paused,true);assert.equal(SOURCE_PLAN.enabled,false);assert.equal(CLAIM_LAUNCH.enabled,false);assert.equal(CLAIM_LAUNCH.purchasing,false);assert.equal(CLAIM_WORKER.dispatch,false);
});

test('seed-only rollout keeps new consumer activation explicitly disabled',async()=>{
 const {SOURCE_PLAN}=await import('../netlify/lib/hive-source-sync.mjs');
 for(const name of ['reviewEnrollmentEnabled','referralReconciliationEnabled','tagReconciliationEnabled','ledgerFencingVerified'])assert.equal(SOURCE_PLAN[name],false,name);
 const campaign=await readFile(new URL('../netlify/functions/review-campaign.mjs',import.meta.url),'utf8');
 assert.match(campaign,/SOURCE_PLAN\.reviewEnrollmentEnabled/);
 const runtime=await readFile(new URL('../netlify/lib/review-runtime.mjs',import.meta.url),'utf8');assert.match(runtime,/hivePaused:HIVE_INCIDENT\.paused\|\|!SOURCE_PLAN\.reviewEnrollmentEnabled/);
 const referrals=await readFile(new URL('../netlify/functions/referral-hive-sync.mjs',import.meta.url),'utf8');assert.match(referrals,/!SOURCE_PLAN\.referralReconciliationEnabled\|\|!SOURCE_PLAN\.ledgerFencingVerified/);
 const tags=await readFile(new URL('../netlify/functions/hive-tag-sync.mjs',import.meta.url),'utf8');assert.match(tags,/!SOURCE_PLAN\.tagReconciliationEnabled/);
});

test('preview referral sync returns before shared ledger access',async()=>{
 const {default:handler}=await import('../netlify/functions/referral-hive-sync.mjs');
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('forbidden preview request');};
 try{const response=await handler(new Request('https://preview.example'),{deploy:{context:'deploy-preview'}});assert.equal(response.status,204);assert.equal(calls,0);}finally{globalThis.fetch=original;}
});
