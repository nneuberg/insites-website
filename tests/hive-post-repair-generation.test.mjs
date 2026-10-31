import test from 'node:test';import assert from 'node:assert/strict';
import {runHiveSourceCoordinator,SOURCE_COORDINATOR_KEY} from '../netlify/lib/hive-source-coordinator.mjs';
import {createSourceCache,applySourceRecords,emptySourceCache} from '../netlify/lib/hive-source-cache.mjs';
import {normalizeListRecord} from '../netlify/lib/hive-source-sync.mjs';
test('isolated post-repair generation preserves old evidence and budgets, holds bad email, stops after two full snapshots',async()=>{
 const old={schema:1,quarantined:true,diagnosticRecovery:'contact-baseline-20261030',active:{kind:'contacts',purpose:'baseline',traversal:{pages:13,rows:Array(2600).fill(null),total:2737,nextCursor:'synthetic-only'}},validationFailure:{at:1793403311370,reason:'Invalid normalized email identities'}};
 const data=new Map([[SOURCE_COORDINATOR_KEY,old],['hive-source/transport-v1',{attempts:29}],['hive-source-cache/v1',{preserved:true}],['hive-source-work/v1',{preserved:true}]]);let seq=0;const versions=new Map();
 const store={async get(k){return structuredClone(data.get(k));},async getWithMetadata(k){return data.has(k)?{data:structuredClone(data.get(k)),etag:versions.get(k)||'initial'}:null;},async setJSON(k,v,o={}){if(o.onlyIfNew&&data.has(k)||o.onlyIfMatch&&o.onlyIfMatch!==(versions.get(k)||'initial'))return {modified:false};data.set(k,structuredClone(v));versions.set(k,String(++seq));return {modified:true};}};
 const cache=createSourceCache({store,key:'hive-source-cache/post-repair-20261031'});let calls=0;
 const args={store,cache,enabled:true,repairGeneration:true,withLease:async(_n,fn)=>fn({assertHeld:async()=>{}}),transport:{request:async path=>{calls++;return {json:async()=>({data:path.startsWith('contacts')?[{id:'synthetic-contact',email:'malformed',roles:[],tags:[],updated_at:'2026-10-31T00:00:00Z'}]:[],total:path.startsWith('contacts')?1:0,next_cursor:null})};}}};
 assert.equal((await runHiveSourceCoordinator(args)).complete,true);assert.equal((await runHiveSourceCoordinator(args)).complete,true);assert.equal((await runHiveSourceCoordinator(args)).baselinesComplete,true);assert.equal(calls,2);
 assert.deepEqual(data.get('hive-source-coordinator/archive-pre-repair-20261031'),old);assert.deepEqual(data.get('hive-source/transport-v1'),{attempts:29});assert.deepEqual(data.get('hive-source-work/v1'),{preserved:true});assert.deepEqual(data.get('hive-source-cache/v1'),{preserved:true});
 const s=(await cache.read()).state;assert.equal(s.contacts['synthetic-contact'].data.email,null);assert.equal(s.contacts['synthetic-contact'].data.emailIdentityHeld,true);assert.deepEqual(s.contacts['synthetic-contact'].emails,[]);
 const one=normalizeListRecord('contacts',{id:'synthetic-contact',email:'ok@example.test',roles:[],tags:[],updated_at:'2026-10-31T00:00:00Z'});const two={...one,data:{...one.data,roles:['Buyer Agent']}};assert.ok(applySourceRecords(applySourceRecords(emptySourceCache(),[one]),[two]).conflicts['contacts:synthetic-contact']);
});
