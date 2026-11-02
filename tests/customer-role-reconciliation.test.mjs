import test from 'node:test';import assert from 'node:assert/strict';
import {emptySourceCache,applySourceRecords,applyObservedContactRecords,createSourceCache} from '../netlify/lib/hive-source-cache.mjs';
import {runHiveSourceCoordinator} from '../netlify/lib/hive-source-coordinator.mjs';
const at=Date.parse('2026-11-01T16:00:00Z');
const old={kind:'contacts',id:'test-contact',revision:Date.parse('2026-11-01T14:36:44Z')*1000,deleted:false,emails:['test@example.com'],data:{id:'test-contact',email:'test@example.com',first_name:'Synthetic',last_name:'Contact',roles:[],tags:[]}};
const inspection={kind:'inspections',id:'test-booking',revision:Date.parse('2026-11-01T15:55:00Z')*1000,deleted:false,data:{id:'test-booking',created_at:'2026-11-01T14:41:32Z',deleted:false,canceled_at:null,status:'confirmed',confirmed:true,contacts:[{id:old.id,role:'Customer',email:old.data.email,first_name:'Synthetic',last_name:'Contact'}]}};
const current={...structuredClone(old),data:{...structuredClone(old.data),roles:['Customer'],tags:[{name:'client'}]}};
const context={enabled:true,pendingEventsClear:true,roleMappingUnknown:false,invalidatedInspectionIds:[]};
function baseline(){const s=applySourceRecords(emptySourceCache(),[old,inspection]);s.coverage={contacts:{complete:true,scope:'all',watermark:at-1000,historyComplete:false},inspections:{complete:true,scope:'all',watermark:at-1000,historyComplete:false}};return applySourceRecords(s,[current]);}
test('only independently corroborated first Customer role is accepted; unsafe/unknown changes hold',()=>{
 const held=baseline();assert.ok(applyObservedContactRecords(held,[current],at).conflicts['contacts:'+old.id]);
 const result=applyObservedContactRecords(held,[current],at,context);assert.deepEqual(result.conflicts,{});assert.deepEqual(result.contacts[old.id].data,current.data);assert.deepEqual(result.coverage,held.coverage);assert.equal(result.customerRoleObservations[old.id].inspectionId,inspection.id);assert.equal(result.customerRoleObservations[old.id].oldHash.length,64);assert.deepEqual(applyObservedContactRecords(result,[current],at,context),result);
 for(const change of [s=>s.inspections[inspection.id].data.contacts[0].id='other-id',s=>s.inspections[inspection.id].data.status='canceled',s=>s.inspections[inspection.id].data.created_at='2026-11-01T14:00:00Z',s=>s.coverage.inspections.watermark=at-86400001]){const s=baseline();change(s);assert.ok(applyObservedContactRecords(s,[current],at,context).conflicts['contacts:'+old.id]);}
 for(const patch of [{enabled:false},{pendingEventsClear:false},{roleMappingUnknown:true},{invalidatedInspectionIds:[inspection.id]}])assert.ok(applyObservedContactRecords(held,[current],at,{...context,...patch}).conflicts['contacts:'+old.id]);
 for(const patch of [{email:'different@example.com'},{first_name:'Changed'},{roles:['Buyer Agent']},{roles:[]}]){const r=structuredClone(current);Object.assign(r.data,patch);assert.ok(applyObservedContactRecords(held,[r],at,context).conflicts['contacts:'+old.id]);}
 assert.ok(applyObservedContactRecords(held,[],at,context).conflicts['contacts:'+old.id]);
});
test('one existing-cadence exact contact read reconciles proof without replay or coverage change',async()=>{
 const values=new Map(),etags=new Map();let seq=0,calls=0,path;
 const store={getWithMetadata:async k=>values.has(k)?{data:structuredClone(values.get(k)),etag:etags.get(k)}:null,get:async k=>structuredClone(values.get(k)),setJSON:async(k,v,opts={})=>{if(opts.onlyIfNew&&values.has(k)||opts.onlyIfMatch&&opts.onlyIfMatch!==etags.get(k))return {modified:false};values.set(k,structuredClone(v));etags.set(k,String(++seq));return {modified:true};},delete:async k=>values.delete(k),list:async function*(){yield {blobs:[]};}};
 const cache=createSourceCache({store,key:'cache'}),held=baseline();await store.setJSON('cache',held);
 await store.setJSON('hive-source-coordinator/v1',{schema:1,active:null,hourlyAt:at,tagsAt:at,pendingAt:at,contactsAt:at,fullRolesAt:at});
 await store.setJSON('hive-source-work/v1',{schema:1,pendingInspectionIds:[],refreshContactIds:[],invalidatedContactIds:[],invalidatedInspectionIds:[],globalRoleDirty:false,roleMappingUnknown:false});
 const args={store,cache,enabled:true,customerRoleObservationEnabled:true,now:()=>at,withLease:async(_,f)=>f({assertHeld:async()=>{}}),transport:{request:async p=>{calls++;path=p;return {json:async()=>({data:[{...current.data,updated_at:'2026-11-01T14:36:44Z'}],next_cursor:null,total:1})};}}};
 const result=await runHiveSourceCoordinator(args);assert.equal(result.task,'customer-role-recheck');assert.equal(calls,1);assert.match(path,/contacts\?limit=200&ids=test-contact/);assert.deepEqual((await cache.read()).state.conflicts,{});assert.deepEqual((await cache.read()).state.coverage,held.coverage);
 await runHiveSourceCoordinator(args);assert.equal(calls,1);
});
