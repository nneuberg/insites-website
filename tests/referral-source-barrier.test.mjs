import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {referralSourceBarrier} from '../netlify/lib/referral-source-barrier.mjs';
import {cachedQualifiedCaseReader} from '../netlify/lib/referral-cache-source.mjs';
import {fixture} from './referral-source-barrier-fixture.mjs';
import {qualifiedLedger} from '../netlify/lib/referral-qualification-integration.mjs';
const WORK='hive-source-work/v1',PREFIX='hive-source-events/pending/';
const hash=x=>createHash('sha256').update(x).digest('hex');
const clone=x=>structuredClone(x);


test('stable empty queue and work yields repeatable fence without writes',async()=>{const f=fixture();assert.equal(await f.barrier(),await f.barrier());assert.equal(f.writes,0);});
test('absent work state cannot certify an empty authoritative source',async()=>{const f=fixture();f.work=null;await assert.rejects(f.barrier(),/reconciliation/);});
test('a pending cancellation holds even with unchanged cache generation',async()=>{const f=fixture();f.pending();await assert.rejects(f.barrier(),/reconciliation/);});
test('done receipt remnants remain held until the shared coordinator archives them',async()=>{const f=fixture();f.done();await assert.rejects(f.barrier(),/reconciliation/);assert.deepEqual(f.reads,[WORK]);});
for(const patch of [{globalRoleDirty:true},{roleMappingUnknown:true},{refreshContactIds:['other1']},{invalidatedContactIds:['other1']},{invalidatedInspectionIds:['current1']},{invalidatedInspectionIds:['old-history1']}])test('existing source invalidation remains held '+JSON.stringify(patch),async()=>{const f=fixture();Object.assign(f.work,patch);await assert.rejects(f.barrier());});
test('unrelated pending inspection IDs alone do not invent a global manual hold',async()=>{const f=fixture();f.work.pendingInspectionIds=['unrelated1'];assert.equal(typeof await f.barrier(),'string');});
test('malformed work and missing conditional identity fail closed',async()=>{for(const change of [f=>f.workEtag='',f=>f.work.schema=2,f=>delete f.work.globalRoleDirty,f=>f.work.roleMappingUnknown='false',f=>f.work.pendingInspectionIds=null,f=>f.work.invalidatedContactIds=[''],f=>f.work.invalidatedInspectionIds='current1']){const f=fixture();change(f);await assert.rejects(f.barrier());}});
test('work changed during event enumeration holds',async()=>{const f=fixture();f.afterList=()=>{f.workEtag='work2';};await assert.rejects(f.barrier());});
test('disappeared or malformed queue rows hold rather than clear history',async()=>{for(const value of [null,{etag:'',data:{state:'done'}},{etag:'a',data:{}},{etag:'a',data:{state:'unknown'}}]){const f=fixture();f.events.set(PREFIX+'e',value);await assert.rejects(f.barrier());}});
test('invalid and duplicate event keys hold',async()=>{for(const keys of [['other/e'],[PREFIX],[PREFIX+'e',PREFIX+'e']]){const f=fixture();f.done('e');f.services.store.list=async function*(){yield {blobs:keys.map(key=>({key}))};};await assert.rejects(f.barrier());}});
test('malformed page, page budget and any listed item hold',async()=>{const a=fixture();a.services.store.list=async function*(){yield {rows:[]};};await assert.rejects(a.barrier());const b=fixture();b.services.store.list=async function*(){yield {blobs:[]};yield {blobs:[]};};await assert.rejects(b.barrier({maxPages:1}));const c=fixture();c.done('a');c.done('b');await assert.rejects(c.barrier());});
test('store errors and invalid caller limits propagate holds',async()=>{const f=fixture();f.services.store.getWithMetadata=async()=>{throw Error('synthetic outage')};await assert.rejects(f.barrier());for(const options of [{maxPages:0},{maxPages:21},{inspectionId:'../bad'}])await assert.rejects(fixture().barrier(options));});
test('production qualification succeeds under synthetic verified facts and stable source',async()=>{const f=fixture();const e=await cachedQualifiedCaseReader(f.readerOptions)('HIVE-current1');assert.equal(e.facts.newCustomerVerified,true);assert.equal(e.facts.fullyPaid,true);assert.equal(e.storedEvent.instanceId,'synthetic-completion1');assert.equal(f.writes,0);});
test('new cancellation during actual production evidence reads is held before returning',async()=>{const f=fixture(),prior=f.readerOptions.readPriorReward;f.readerOptions.readPriorReward=async()=>{f.pending();return prior();};await assert.rejects(cachedQualifiedCaseReader(f.readerOptions)('HIVE-current1'),/reconciliation/);assert.equal(f.cacheEtag,'cache1');assert.equal(f.writes,0);});
test('work-only change during qualification holds despite unchanged cache etag',async()=>{const f=fixture(),prior=f.readerOptions.readPriorReward;f.readerOptions.readPriorReward=async()=>{f.workEtag='work2';return prior();};await assert.rejects(cachedQualifiedCaseReader(f.readerOptions)('HIVE-current1'),/barrier changed/);});
test('new done receipt during qualification holds and retries only after archival',async()=>{const f=fixture(),prior=f.readerOptions.readPriorReward;let first=true;f.readerOptions.readPriorReward=async()=>{if(first){f.done();first=false;}return prior();};const read=cachedQualifiedCaseReader(f.readerOptions);await assert.rejects(read('HIVE-current1'),/reconciliation/);await assert.rejects(read('HIVE-current1'),/reconciliation/);f.events.clear();assert.equal((await read('HIVE-current1')).facts.newCustomerVerified,true);});
test('cache changes remain held',async()=>{const f=fixture(),prior=f.readerOptions.readPriorReward;f.readerOptions.readPriorReward=async()=>{f.cacheEtag='cache2';return prior();};await assert.rejects(cachedQualifiedCaseReader(f.readerOptions)('HIVE-current1'),/generation or barrier changed/);});
test('reused reader checks fresh barriers on every invocation',async()=>{const f=fixture(),read=cachedQualifiedCaseReader(f.readerOptions);await read('HIVE-current1');f.pending();await assert.rejects(read('HIVE-current1'));});
test('invalid case identifiers and absent store cannot bypass the barrier',async()=>{const f=fixture();await assert.rejects(cachedQualifiedCaseReader(f.readerOptions)('bad'));delete f.services.store;await assert.rejects(cachedQualifiedCaseReader(f.readerOptions)('HIVE-current1'));});
test('late cancellation holds the ledger before qualification or reservation',async()=>{const f=fixture(),prior=f.readerOptions.readPriorReward;f.readerOptions.readPriorReward=async()=>{f.pending();return prior();};const calls=[];const verified=qualifiedLedger({readCase:cachedQualifiedCaseReader(f.readerOptions),ledger:async(action)=>{calls.push(action);return {held:true};},launchCutoff:new Date(f.now-7*86400000).toISOString(),now:()=>new Date(f.now).toISOString()});await assert.rejects(verified.call('reserveClaimReward',{useId:'HIVE-current1'}),/evidence unavailable/);assert.deepEqual(calls,['holdCodeUse']);});

test('policy expiration during final asynchronous barrier checks remains held',async()=>{const f=fixture();f.onWorkRead=n=>{if(n===4)f.now+=60000;};await assert.rejects(cachedQualifiedCaseReader(f.readerOptions)('HIVE-current1'),/coverage expired during final barrier/);});

test('invalidated historical inspection holds before negative customer history',async()=>{const f=fixture();f.work.invalidatedInspectionIds=['old-history1'];await assert.rejects(cachedQualifiedCaseReader(f.readerOptions)('HIVE-current1'),/reconciliation/);assert.equal(f.writes,0);});

test('legacy or partial work schema cannot supply missing invalidation authority',async()=>{for(const field of ['roleMappingUnknown','invalidatedInspectionIds']){const f=fixture();delete f.work[field];await assert.rejects(f.barrier(),/reconciliation/);}});
