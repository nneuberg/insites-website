import test from 'node:test';import assert from 'node:assert/strict';
import {emptySourceCache,applySourceRecords,applyObservedContactRecords,beginSourceTraversal,appendSourcePage,finishObservedContactTraversal} from '../netlify/lib/hive-source-cache.mjs';
import {planHiveSourceEvent} from '../netlify/lib/hive-source-event-plan.mjs';
import {SOURCE_PLAN} from '../netlify/lib/hive-source-sync.mjs';
const row={kind:'contacts',id:'person',revision:1793470200000000,deleted:false,emails:['test@example.com'],data:{id:'person',email:'test@example.com',first_name:'Test',last_name:null,roles:['Customer'],tags:[{name:'old'}]}};
test('fresh GET tag-only equal revision repair is bounded; historical events invalidate rather than overwrite',()=>{
 const base=applySourceRecords(emptySourceCache(),[row]),fresh=structuredClone(row);fresh.data.tags=[{name:'new'}];
 assert.ok(applySourceRecords(base,[fresh]).conflicts['contacts:person']);
 const next=applyObservedContactRecords(base,[fresh],1793470300000);
 assert.deepEqual(next.contacts.person.data.tags,fresh.data.tags);assert.deepEqual(next.coverage,{});assert.deepEqual(next.conflicts,{});assert.equal(next.contactObservations.person.observedAt,1793470300000);
 for(const field of ['roles','email','first_name']){const bad=structuredClone(fresh);bad.data[field]=field==='roles'?['Agent']:'changed';const held=applyObservedContactRecords(base,[bad],1793470300000);assert.ok(held.conflicts['contacts:person']);assert.deepEqual(held.contacts.person,row);}
 const conflict=applySourceRecords(base,[fresh]);assert.ok(applyObservedContactRecords(conflict,[fresh],1793470300000).conflicts['contacts:person']);
 const t=appendSourcePage(beginSourceTraversal(base,{kind:'contacts',startedAt:1793470250000}),{rows:[fresh],nextCursor:null,total:1});assert.equal(finishObservedContactTraversal(t,1793470300000).coverage.contacts.watermark,1793470250000);
 const plan=planHiveSourceEvent({schema:1,state:'pending',eventId:'event',organizationId:'org',apiVersion:'v1',event:'contact.updated',firedAt:'2026-10-31T19:00:01Z',data:{contact:{id:'person',email:'test@example.com',roles:['Customer'],tag_list:['stale'],updated_at:'2026-10-31T19:00:00Z'}}});
 assert.deepEqual(plan.contactUpdates,[]);assert.deepEqual(plan.refreshContactIds,['person']);
 const deleted=planHiveSourceEvent({schema:1,state:'pending',eventId:'deleted',organizationId:'org',apiVersion:'v1',event:'contact.deleted',firedAt:'2026-10-31T19:00:01Z',data:{contact:{id:'person',email:'test@example.com',roles:['Customer'],tag_list:['stale'],updated_at:'2026-10-31T19:00:00Z'}}});
 assert.deepEqual(deleted.contactUpdates,[]);assert.deepEqual(deleted.refreshContactIds,['person']);
 const unchanged=applyObservedContactRecords(base,[row],1793470300000);assert.equal(unchanged.contactObservations.person.observedAt,1793470300000);assert.deepEqual(unchanged.coverage,{});
 assert.equal(SOURCE_PLAN.enabled,true);assert.equal(SOURCE_PLAN.seedOnly,false);assert.equal(SOURCE_PLAN.reviewEnrollmentEnabled,true);assert.equal(SOURCE_PLAN.tagReconciliationEnabled,false);assert.equal(SOURCE_PLAN.referralReconciliationEnabled,false);
});
