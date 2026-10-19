import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './harness.mjs';
import {testRuntime,TEST_TOKEN,TEST_EXPIRES_AT} from '../netlify/lib/review-test-fixture.mjs';
test('only the disposable invitation can select the isolated store',async()=>{
 assert.equal(await testRuntime('0'.repeat(48),()=>{throw Error('Unexpected store access');}),null);
});
test('test fixture saves feedback while paused without provider calls and preserves it on reload',async()=>{
 const s=setup(),now=()=>TEST_EXPIRES_AT-86400000;
 const engine=await testRuntime(TEST_TOKEN,()=>s.store,now);
 const row=await engine.get(TEST_TOKEN);assert.equal(row.isTest,true);assert.equal(row.name,'Test Test');
 await engine.feedback(TEST_TOKEN,{rating:1,feedback:'Isolated test'});
 const again=await testRuntime(TEST_TOKEN,()=>s.store,now);
 assert.equal((await again.get(TEST_TOKEN)).rating,1);
 assert.equal((await again.get(TEST_TOKEN)).finishSynced,true);
 assert.equal(s.calls.length,0);
});
test('expired fixture cannot initialize a new record or accept feedback',async()=>{
 const s=setup();const engine=await testRuntime(TEST_TOKEN,()=>s.store,()=>TEST_EXPIRES_AT);
 assert.equal(await engine.get(TEST_TOKEN),null);assert.equal(s.entries.size,0);
 await assert.rejects(()=>engine.feedback(TEST_TOKEN,{rating:5,feedback:''}),/not found/);
});
