import test from 'node:test';
import assert from 'node:assert/strict';
import {auditStep,createHiveReader} from '../netlify/lib/hive-contact-audit.mjs';
const env={HIVE_CONTACT_AUDIT_ENABLED:'true',HIVE_CONTACT_AUDIT_RUN_ID:'test_run_01'};
class Store{
 value=null;version=0;writes=0;
 async getWithMetadata(){return this.value?{data:structuredClone(this.value),etag:String(this.version)}:null;}
 async setJSON(key,value,opts){
  if(opts.onlyIfNew&&this.value||opts.onlyIfMatch&&opts.onlyIfMatch!==String(this.version))return {modified:false};
  this.value=structuredClone(value);this.version++;this.writes++;return {modified:true};
 }
}
const page=(ids=['a'],next=null,total=ids.length)=>({data:ids.map(id=>({id,roles:[]})),next_cursor:next,total});
const args=(store,read=async()=>page())=>({store,read,env,context:'production',now:()=> '2026-10-13T00:00:00Z'});

test('disabled and preview gates touch neither storage nor Hive',async()=>{
 const no=()=>{throw Error('must not call')};
 for(const settings of [{context:'preview',env},{context:'production',env:{}}])
  assert.equal((await auditStep({store:{getWithMetadata:no},read:no,...settings})).status,'disabled');
});
test('run ID required',async()=>assert.equal((await auditStep({...args(new Store()),env:{HIVE_CONTACT_AUDIT_ENABLED:'true'}})).status,'configuration_required'));
test('two complete stable passes and stop without further reads',async()=>{
 const store=new Store();let reads=0;
 for(let i=0;i<4;i++)await auditStep(args(store,async()=>{reads++;return page();}));
 assert.equal(store.value.status,'complete');assert.deepEqual(store.value.counts,{contacts:1,agencies:1});
 assert.ok(store.value.manifest.resources.contacts.sha256);
 assert.equal((await auditStep(args(store,async()=>{throw Error('no more');}))).status,'complete');assert.equal(reads,4);
});
test('pagination uses full contacts then agencies with no role filter',async()=>{
 const store=new Store(),calls=[];
 const read=async(resource,cursor)=>{calls.push([resource,cursor]);return resource==='contacts'?cursor?page(['b'],null,2):page(['a'],'next',2):page(['agency']);};
 for(let i=0;i<6;i++)await auditStep(args(store,read));
 assert.equal(store.value.status,'complete');assert.deepEqual(calls,[['contacts',null],['contacts','next'],['agencies',null],['contacts',null],['contacts','next'],['agencies',null]]);
});
test('empty directory requires terminal cursor and total zero',async()=>{
 const store=new Store();for(let i=0;i<4;i++)await auditStep(args(store,async()=>page([])));
 assert.equal(store.value.status,'complete');assert.equal(store.value.counts.contacts,0);
});
test('failed read keeps cursor unchanged for safe retry',async()=>{
 const store=new Store();await auditStep(args(store,async()=>page(['a'],'next',2)));
 const before=structuredClone(store.value);assert.equal((await auditStep(args(store,async()=>{throw Error('401 secret');}))).status,'read_failed_retry');
 assert.deepEqual(store.value,before);
});
test('malformed or incomplete pages hold',async()=>{
 for(const invalid of [{data:[],total:0},{data:[],total:1,next_cursor:null},page(['a','a']),page(['']),{...page(),total:'1'},page(['a'],'',1)]){
  const store=new Store();const result=await auditStep(args(store,async()=>invalid));assert.equal(result.status,'invalid_snapshot_hold');
 }
});
test('duplicate IDs across pages, total churn, repeated cursor all hold',async()=>{
 for(const second of [page(['a'],null,2),page(['b'],null,3),page(['b'],'next',2)]){
  const store=new Store();await auditStep(args(store,async()=>page(['a'],'next',2)));
  assert.equal((await auditStep(args(store,async()=>second))).status,'invalid_snapshot_hold');
 }
});
test('changed contact content between passes holds even with equal totals',async()=>{
 const store=new Store();let n=0;
 for(let i=0;i<4;i++)await auditStep(args(store,async()=>({...page(),data:[{id:'a',phone:++n<=2?'1':'2'}]})));
 assert.equal(store.value.status,'changed_between_passes_hold');
});
test('CAS rejects stale concurrent reader without overwriting state',async()=>{
 const store=new Store();let release;const wait=new Promise(r=>{release=r});
 const late=auditStep(args(store,async()=>{await wait;return page(['late']);}));
 await auditStep(args(store,async()=>page(['winner'])));release();
 assert.equal((await late).status,'concurrent_reader_retry');assert.equal(store.value.snapshots[0].contacts.rows[0].id,'winner');
});
test('restart uses persisted cursor',async()=>{
 const store=new Store();await auditStep(args(store,async()=>page(['a'],'resume',2)));
 let got;await auditStep(args(store,async(_,cursor)=>{got=cursor;return page(['b'],null,2)}));assert.equal(got,'resume');
});
test('returned statuses contain no contact values',async()=>{
 const store=new Store();const result=await auditStep(args(store,async()=>({...page(),data:[{id:'a',email:'private@example.test'}]})));
 assert.ok(!JSON.stringify(result).includes('private'));assert.ok(JSON.stringify(store.value).includes('private'));
});
test('reader hardcodes GET origin resources and rejects redirects',async()=>{
 const calls=[];const read=createHiveReader({env:{HIVE_API_KEY:'synthetic'},fetcher:async(url,options)=>{calls.push([String(url),options]);return {ok:true,json:async()=>page()}}});
 await read('contacts',null);await read('agencies','opaque cursor');
 assert.equal(calls[0][0],'https://api.hiveinspect.com/v1/contacts?limit=200');assert.equal(calls[0][1].method,'GET');assert.equal(calls[0][1].redirect,'error');
 assert.ok(!calls[0][0].includes('role'));assert.ok(!calls[0][0].includes('synthetic'));
 await assert.rejects(()=>read('../inspections',null));
});
test('reader fails closed on auth/missing secret',async()=>{
 await assert.rejects(()=>createHiveReader({env:{}})('contacts',null));
 await assert.rejects(()=>createHiveReader({env:{HIVE_API_KEY:'synthetic'},fetcher:async()=>({ok:false})})('contacts',null));
});
