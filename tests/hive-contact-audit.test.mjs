import test from 'node:test';
import assert from 'node:assert/strict';
import {auditStep,createHiveReader} from '../netlify/lib/hive-contact-audit.mjs';
const env={HIVE_CONTACT_AUDIT_ENABLED:'true',HIVE_CONTACT_AUDIT_RUN_ID:'test_run_01',
 HIVE_CONTACT_AUDIT_NOT_BEFORE:'2026-10-13T00:00:00Z',HIVE_CONTACT_AUDIT_EXPIRES_AT:'2026-10-13T01:00:00Z'};
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
test('run ID required',async()=>assert.equal((await auditStep({...args(new Store()),env:{...env,HIVE_CONTACT_AUDIT_RUN_ID:''}})).status,'configuration_required'));
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
 assert.deepEqual(store.value.current,before.current);assert.equal(store.value.attempts,before.attempts+1);
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
 const store=new Store();let reads=0;
 const outcomes=await Promise.all([auditStep(args(store,async()=>{reads++;return page(['winner']);})),auditStep(args(store,async()=>{reads++;return page(['late']);}))]);
 assert.ok(outcomes.some(x=>x.status==='concurrent_reader_retry'));assert.equal(reads,1);
 assert.equal(store.value.snapshots[0].contacts.rows[0].id,'winner');
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
test('expired/missing/overlong windows touch no storage or API',async()=>{
 for(const overrides of [{HIVE_CONTACT_AUDIT_EXPIRES_AT:''},{HIVE_CONTACT_AUDIT_EXPIRES_AT:'2026-10-13T00:00:00Z'},
  {HIVE_CONTACT_AUDIT_EXPIRES_AT:'2026-10-14T00:00:00Z'},{HIVE_CONTACT_AUDIT_NOT_BEFORE:'2026-10-13T00:30:00Z'}]){
  const no=()=>{throw Error('must not touch')};
  assert.equal((await auditStep({...args({getWithMetadata:no},no),env:{...env,...overrides}})).status,'outside_audit_window');
 }
});
test('80 failed calls exhaust budget and no further GET occurs',async()=>{
 const store=new Store();let reads=0;
 const fail=async()=>{reads++;throw Error('unavailable')};
 for(let i=0;i<82;i++)await auditStep({...args(store,fail),now:()=>new Date(Date.parse('2026-10-13T00:00:00Z')+i*31000).toISOString()});
 assert.equal(reads,80);assert.equal(store.value.status,'attempt_budget_exhausted');
});
test('failed first page persists attempt and applies backoff',async()=>{
 const store=new Store();let reads=0;const fail=async()=>{reads++;throw Error('failure')};
 assert.equal((await auditStep(args(store,fail))).status,'read_failed_retry');
 assert.equal(store.value.attempts,1);
 assert.equal((await auditStep(args(store,fail))).status,'backoff_retry_later');assert.equal(reads,1);
});
test('in-flight crash consumes attempt; busy holds until lease expiration',async()=>{
 const store=new Store();await auditStep(args(store,async()=>page(['a'],'next',2)));
 store.value.inflightUntil='2026-10-13T00:00:30Z';
 assert.equal((await auditStep(args(store,async()=>{throw Error('no call')}))).status,'reader_busy_retry');
 assert.equal((await auditStep({...args(store,async()=>page(['b'],null,2)),now:()=> '2026-10-13T00:00:31Z'})).status,'reading');
});
test('excluded contact and agency details never enter stored state or hash',async()=>{
 const store=new Store();let calls=0;
 const read=async(resource)=>({total:1,next_cursor:null,data:[{id:'a',first_name:'A',name:'Office',email:'a@example.test',
  agency:{id:'agency1',notes:'NESTED_SECRET'},uses_agency_address:true,roles:['Agent'],
  tags:[{name:'broker'},{name:'UNRELATED_SECRET'}],notes:'SECRET_NOTE_'+(++calls),birthday:'SECRET_BIRTHDAY',
  photo_url:'SECRET_PHOTO',custom_field:'SECRET_CUSTOM'}]});
 for(let i=0;i<4;i++)await auditStep(args(store,read));
 assert.equal(store.value.status,'complete');
 assert.ok(!JSON.stringify(store.value).includes('SECRET'));
 assert.deepEqual(store.value.snapshots[0].contacts.rows[0].agent_markers,['broker']);
 assert.equal(store.value.snapshots[0].contacts.rows[0].agency_id,'agency1');
 assert.equal(store.value.snapshots[0].agencies.rows[0].email,undefined);
});
