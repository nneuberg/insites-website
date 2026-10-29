import test from 'node:test';import assert from 'node:assert/strict';
import {sourceListPath,sourceIdBatches,sourceRevision,normalizeListRecord,sourceScanStep,estimateSourceBudget} from '../netlify/lib/hive-source-sync.mjs';
import {createSourceCache} from '../netlify/lib/hive-source-cache.mjs';
const record=id=>({id,email:id+'@example.test',roles:[],tags:[],updated_at:'2026-10-29T00:00:00.123456Z'});
function stores(){let data=new Map(),seq=0;return {async get(k){return data.get(k)?.data??null;},async getWithMetadata(k){return data.get(k);},async setJSON(k,v,o={}){const old=data.get(k);if(o.onlyIfNew&&old||o.onlyIfMatch&&o.onlyIfMatch!==old?.etag)return {modified:false};data.set(k,{data:structuredClone(v),etag:String(++seq)});return {modified:true};}};}
test('all queries use200, opaque cursor and consistent filters',()=>{
 const p=sourceListPath('inspections',{cursor:'opaque/+?',since:0});const q=new URLSearchParams(p.split('?')[1]);assert.equal(q.get('limit'),'200');assert.equal(q.get('cursor'),'opaque/+?');assert.equal(q.get('include_deleted'),'true');assert.equal(q.get('include_canceled'),'true');
});
test('pending older IDs never carry7day or paid filter',()=>{const p=sourceListPath('inspections',{ids:['old']});assert.ok(!p.includes('scheduled_after'));assert.ok(!p.includes('paid='));assert.throws(()=>sourceListPath('inspections',{ids:['old'],eligibleAfter:0}));});
test('ID batches deduplicate and cap200 without dropping remainingIDs',()=>{const b=sourceIdBatches([...Array.from({length:401},(_,i)=>'id'+i),'id1']);assert.deepEqual(b.map(x=>x.length),[200,200,1]);});
test('source revisions retainmicrosecond order',()=>{assert.equal(sourceRevision('2026-10-29T00:00:00.123457Z')-sourceRevision('2026-10-29T00:00:00.123456Z'),1);assert.equal(sourceRevision('2026-10-29T00:00:00Z'),sourceRevision('2026-10-28T20:00:00-04:00'));assert.throws(()=>sourceRevision('2026-10-29'));});
test('embedded partialcontact cannot createauthoritativecache',()=>assert.throws(()=>normalizeListRecord('contacts',{id:'a',updated_at:'2026-10-29T00:00:00Z',email:'a@example.test'})));
test('disabledworker performszeroreads',async()=>{assert.deepEqual(await sourceScanStep({kind:'contacts',read:()=>{throw Error('network');}}),{deferred:true,requests:0});});
test('pagecheckpointresumes, publishesonlyterminal, dailyfreshscanisfree',async()=>{
 const store=stores(),cache=createSourceCache({store}),paths=[];let n=0;const now=()=>Date.parse('2026-10-29T01:00:00Z');
 const read=async path=>{paths.push(path);return n++?{data:[record('b')],total:2,next_cursor:null}:{data:[record('a')],total:2,next_cursor:'NEXT'};};
 const args={cache,checkpointStore:store,read,kind:'contacts',now,enabled:true,assertHeld:async()=>{}};
 assert.equal((await sourceScanStep(args)).complete,false);assert.deepEqual((await cache.read()).state.contacts,{});
 assert.equal((await sourceScanStep(args)).complete,true);assert.match(paths[1],/cursor=NEXT/);assert.equal(Object.keys((await cache.read()).state.contacts).length,2);
 assert.equal((await sourceScanStep(args)).requests,0);
});
test('failedpage doesnotadvancecoverage',async()=>{const store=stores(),cache=createSourceCache({store});await assert.rejects(sourceScanStep({cache,checkpointStore:store,kind:'contacts',enabled:true,assertHeld:async()=>{},read:async()=>({data:[record('a')],total:2,next_cursor:null})}));assert.deepEqual((await cache.read()).state.coverage,{});});
test('budgetincludesall sharedpolls,pendingIDs,writesandinitialseed',()=>{assert.deepEqual(estimateSourceBudget({bootstrapContacts:2600}),{daily:81,days31:2511,bootstrap:13,ceilingDaily:100,ceilingRolling31Days:3000});});

test('invalid calendar dates do not establish source authority',()=>{for(const value of ['2026-02-30T00:00:00Z','2026-10-29T24:00:00Z'])assert.throws(()=>sourceRevision(value));});
test('unsafe map-key IDs never enter normalized provider data',()=>{assert.throws(()=>normalizeListRecord('contacts',record('__proto__')));assert.throws(()=>sourceIdBatches(['constructor']));});
