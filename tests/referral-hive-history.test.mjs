import test from 'node:test';
import assert from 'node:assert/strict';
import {customerHistory} from '../netlify/lib/referral-customer-history.mjs';
import {productionQualifiedCaseReader} from '../netlify/lib/referral-source-runtime.mjs';
import {APPROVED_REFERRAL_FULL_SERVICE_IDS} from '../netlify/lib/referral-service-catalog.mjs';

// Synthetic offline fixtures. No customer data, network access, side effects,
// production coverage certification, or provider calls.
const before='2026-11-01T12:00:00.000Z';
const now=Date.parse('2026-11-05T14:00:00.000Z');
const fullCoverage={sourceMode:'hive-migrated',exactEmailLookupVerified:true,currentHistoryComplete:true,scope:'exact-email-index',through:before,deletedBehaviorVerified:true,reference:'synthetic-source-reference',historicalMigrationVerified:true,migrationReference:'synthetic-migration-reference'};
const input={email:'test@example.com',sourceContactIds:['client1'],currentInspectionId:'current1',before,coverage:fullCoverage};
const page=rows=>({data:rows,next_cursor:null,total:rows.length});
const contact={id:'client1',email:'test@example.com'};
const prior={id:'prior1',contacts:[{id:'client1',role:'Customer',email:'test@example.com'}],status:'confirmed',confirmed:true,canceled_at:null,deleted:false,scheduled_for:'2025-01-01T12:00:00.000Z'};
const readRows=rows=>async path=>path.startsWith('contacts?')?page([contact]):page(rows);
const lookup=(rows,extra={})=>customerHistory({...input,read:readRows(rows),...extra});
const completeLegacy=async q=>({...q,complete:true,coverageScope:'exact-email-index',priorCustomer:false,reference:'synthetic-legacy-reference'});

test('complete Hive certificate allows exact-email absence without a legacy call',async()=>{
 let calls=0; const r=await lookup([],{legacyLookup:async()=>{calls++;throw Error('must not read legacy');}});
 assert.equal(r.newClient,true);assert.equal(calls,0);assert.equal(r.globalPersonHistoryComplete,false);assert.match(r.evidenceReference,/migration/);
});
for(const field of ['exactEmailLookupVerified','currentHistoryComplete','deletedBehaviorVerified','historicalMigrationVerified'])test(`${field} must be true`,async()=>{
 for(const value of [false,undefined,'true'])assert.equal((await lookup([],{coverage:{...fullCoverage,[field]:value}})).newClient,null);
});
for(const field of ['reference','migrationReference'])test(`${field} must be nonempty`,async()=>{
 for(const value of ['',undefined,'   ',123])assert.equal((await lookup([],{coverage:{...fullCoverage,[field]:value}})).newClient,null);
});
test('scope and current coverage horizon must be verified',async()=>{
 for(const change of [{scope:'all-people'},{through:'2025-01-01T00:00:00Z'},{through:'invalid'}])assert.equal((await lookup([],{coverage:{...fullCoverage,...change}})).newClient,null);
});
test('unknown modes cannot clear; missing mode retains direct-reader legacy compatibility',async()=>{
 for(const sourceMode of ['hive',false,{},123,null,undefined])assert.equal((await lookup([],{coverage:{...fullCoverage,sourceMode},legacyLookup:completeLegacy})).newClient,null);
 const coverage={...fullCoverage};delete coverage.sourceMode;
 assert.equal((await lookup([],{coverage})).newClient,null);
 assert.equal((await lookup([],{coverage,legacyLookup:completeLegacy})).newClient,true);
});
test('malformed coverage object cannot clear or throw',async()=>{
 for(const coverage of [null,false,[],123,'hive-migrated'])assert.equal((await lookup([],{coverage})).newClient,null);
});
test('documented prior Customer row disqualifies',async()=>assert.equal((await lookup([prior])).newClient,false));
test('Hive dates cannot use starts_at only, date-only, invalid, or conflicting values',async()=>{
 for(const change of [{scheduled_for:undefined,starts_at:prior.scheduled_for},{scheduled_for:'2025-01-01'},{scheduled_for:'not a date'},{starts_at:'2025-01-02T12:00:00Z'},{starts_at:'bad'}])assert.equal((await lookup([{...prior,...change}])).newClient,null);
});
test('equal legacy and current dates remain coherent',async()=>assert.equal((await lookup([{...prior,starts_at:prior.scheduled_for}])).newClient,false));
test('normalized impossible calendar dates and 24-hour rollover remain unknown',async()=>{
 for(const scheduled_for of ['2025-02-30T12:00:00Z','2025-11-31T12:00:00Z','2025-01-01T24:00:00Z','2025-01-01T12:00:00','2025-01-01T12:00:00+25:00'])assert.equal((await lookup([{...prior,scheduled_for}])).newClient,null);
});
test('malformed booking cutoff cannot be normalized into eligibility',async()=>{
 for(const before of ['2026-11-31T12:00:00Z','2026-11-01','2026-11-01T24:00:00Z'])assert.equal((await lookup([],{before,coverage:{...fullCoverage,through:'2027-01-01T00:00:00Z'}})).newClient,null);
});
test('current, future, canceled, and deleted rows preserve existing exclusions',async()=>{
 for(const change of [{id:'current1'},{scheduled_for:'2026-11-06T00:00:00Z'},{status:'canceled'},{canceled_at:'2025-01-02T00:00:00Z'},{deleted:true}])assert.equal((await lookup([{...prior,...change}])).newClient,true);
});
test('unresolved prior lifecycle holds',async()=>{
 for(const change of [{status:'draft'},{status:'waiting'},{status:'review'},{confirmed:false},{confirmed:undefined}])assert.equal((await lookup([{...prior,...change}])).newClient,null);
});
test('known non-Customer roles do not become prior customer business',async()=>{
 for(const role of ['Buyer Agent','Listing Agent','Sub Contractor','Insurance Agent','Lender','Builder','Transaction Coordinator','Attorney','Title Company','Others'])assert.equal((await lookup([{...prior,contacts:[{id:'client1',role}]}])).newClient,true);
});
test('unrelated, absent, unknown, or duplicated queried memberships hold',async()=>{
 for(const contacts of [[],[{id:'other',role:'Customer'}],[{id:'client1',role:'unknown'}],[{id:'client1'}],[{id:'client1',role:'Customer'},{id:'client1',role:'Buyer Agent'}],[{id:'client1',role:'Customer'},{id:'client1',role:'Customer'}]])assert.equal((await lookup([{...prior,contacts}])).newClient,null);
});
test('exact email mismatch, malformed contact ID, and source identity conflict hold',async()=>{
 for(const c of [{id:'client1',email:'other@example.com'},{id:'bad id',email:'test@example.com'}])assert.equal((await lookup([],{read:async path=>path.startsWith('contacts?')?page([c]):page([])})).newClient,null);
 assert.equal((await lookup([],{sharedEmailEvidence:{verified:true,reference:'synthetic-shared-conflict'}})).newClient,null);
 assert.equal((await lookup([],{verifiedAliases:[{email:'bad',verified:true,reference:'synthetic-alias'}]})).newClient,null);
});
test('request includes all-status/deletion flags and normalized exact email',async()=>{
 const paths=[];await lookup([],{email:' TEST@EXAMPLE.COM ',read:async path=>{paths.push(path);return path.startsWith('contacts?')?page([contact]):page([]);}});
 assert.equal(new URL(paths[0],'https://local.invalid/').searchParams.get('email'),'test@example.com');
 const q=new URL(paths[1],'https://local.invalid/').searchParams;assert.equal(q.get('contact_id'),'client1');assert.equal(q.get('include_canceled'),'true');assert.equal(q.get('include_deleted'),'true');
});
for(const [label,response] of [['missing cursor',{data:[],total:0}],['bad cursor',{data:[],next_cursor:0,total:0}],['count mismatch',{data:[],next_cursor:null,total:1}],['invalid row ID',page([{...prior,id:'bad id'}])],['duplicate row IDs',page([prior,prior])]])test(`${label} holds`,async()=>{
 assert.equal((await lookup([],{read:async path=>path.startsWith('contacts?')?page([contact]):response})).newClient,null);
});
test('read failure and page/contact budgets hold',async()=>{
 assert.equal((await lookup([],{read:async()=>{throw Error('unavailable');}})).newClient,null);
 assert.equal((await lookup([],{maxPages:1})).newClient,null);
 assert.equal((await lookup([],{maxContacts:0})).newClient,null);
});
test('changing totals and repeated cursor hold',async()=>{
 for(const repeated of [false,true]){let n=0;const r=await lookup([],{read:async path=>{if(path.startsWith('contacts?'))return page([contact]);n++;return n===1?{data:[],next_cursor:'cursor1',total:1}:{data:[],next_cursor:repeated?'cursor1':null,total:repeated?1:2};}});assert.equal(r.newClient,null);}
});
const bothContacts=[{id:'client1',email:'test@example.com'},{id:'client2',email:'test@example.com'}];
const bothLinks=[{id:'client1',role:'Customer',email:'test@example.com'},{id:'client2',role:'Customer',email:'test@example.com'}];
test('conflicting cross-contact copies cannot falsely clear a prior job',async()=>{
 const r=await lookup([],{read:async path=>path.startsWith('contacts?')?page(bothContacts):page([{...prior,contacts:bothLinks,status:path.includes('client1')?'canceled':'confirmed'}])});assert.equal(r.newClient,null);
});
test('identical cross-contact copies are allowed, independent of contact ordering',async()=>{
 const r=await lookup([],{read:async path=>path.startsWith('contacts?')?page(bothContacts):page([{...prior,contacts:path.includes('client1')?bothLinks:[...bothLinks].reverse()}])});assert.equal(r.newClient,false);
});
test('first non-Customer copy does not hide second Customer relationship',async()=>{
 const contacts=[{id:'client1',role:'Buyer Agent',email:'test@example.com'},{id:'client2',role:'Customer',email:'test@example.com'}];
 const r=await lookup([],{read:async path=>path.startsWith('contacts?')?page(bothContacts):page([{...prior,contacts}])});assert.equal(r.newClient,false);
});

function runtimeFixture({policyChange={},historyChange={},inspectionChange={},advanceAfterReward=0}={}){
 let clock=now;const keys=[];let legacyCalls=0;
 const policy={verified:true,reference:'synthetic-policy',validUntil:new Date(now+60000).toISOString(),bookingCreatedAtVerified:true,consentDefinesConsumerEligibility:true,historyCoverage:{...fullCoverage,...historyChange},...policyChange};
 const inspection={...prior,id:'current1',created_at:before,ends_at:'2026-11-04T12:00:00Z',reports:{status:'published'},services:[{id:APPROVED_REFERRAL_FULL_SERVICE_IDS[0]}],discount_codes:[{code:'CODE1'}],price:{paid:true,payment_status:'paid',amount_due:0,amount_paid:350},refunded:false,disputed:false,...inspectionChange};
 const snapshot={codes:[{Code:'CODE1','Assignment State':'ASSIGNED','Hive State':'VERIFIED','Referrer Email':'referrer@example.com','Referrer ID':'referrer1','Assigned At':'2026-10-01T00:00:00Z'}],shares:[{Code:'CODE1','Referrer Email':'referrer@example.com','Terms Version':'2026-10-04-personal-share','Consent At':'2026-10-10T00:00:00Z'}],uses:[]};
 const reader=productionQualifiedCaseReader({store:{get:async key=>{keys.push(key);assert.equal(key,'qualification-source-policy/current');return policy;}},reviewStore:{async *list(){}},readHive:async path=>path==='inspections/current1'?inspection:path.startsWith('contacts?')?page([contact]):page([]),ledger:async(op)=>{assert.equal(op,'codeSnapshot');return snapshot;},legacyLookup:async()=>{legacyCalls++;throw Error('no legacy allowed');},readPriorReward:async()=>{clock+=advanceAfterReward;return {verified:true,useId:'HIVE-current1',email:'test@example.com',clear:true,reference:'synthetic-no-prior-reward'};},now:()=>clock});
 return {reader,keys,legacyCalls:()=>legacyCalls};
}
test('production uses private Hive certificate and never archive or legacy injection',async()=>{
 const f=runtimeFixture();const r=await f.reader('HIVE-current1');assert.equal(r.facts.newCustomerVerified,true);assert.equal(r.storedEvent,null);assert.equal(f.legacyCalls(),0);assert.deepEqual(f.keys,['qualification-source-policy/current']);
});
test('production rejects absent/non-Hive mode even when other policy fields are populated',async()=>{
 for(const sourceMode of [undefined,'current-plus-legacy','hive']){const f=runtimeFixture({historyChange:{sourceMode}});await assert.rejects(()=>f.reader('HIVE-current1'),/Hive migrated history policy unverified/);}
});
test('unverified migration does not become qualified-new-customer in production',async()=>{
 const f=runtimeFixture({historyChange:{historicalMigrationVerified:false}});const r=await f.reader('HIVE-current1');assert.equal(r.facts.newCustomerVerified,false);
});
test('outer policy is rejected when missing verification, expired, or stale during read',async()=>{
 for(const policyChange of [{verified:false},{validUntil:new Date(now).toISOString()},{validUntil:'invalid'}]){const f=runtimeFixture({policyChange});await assert.rejects(()=>f.reader('HIVE-current1'),/Source coverage not verified/);}
 const f=runtimeFixture({advanceAfterReward:60000});await assert.rejects(()=>f.reader('HIVE-current1'),/Source coverage expired during qualification/);
});
test('refund/dispute and current completion holds stay enforced',async()=>{
 for(const inspectionChange of [{refunded:undefined},{disputed:undefined},{reports:{status:'draft'}}]){const f=runtimeFixture({inspectionChange});await assert.rejects(()=>f.reader('HIVE-current1'),/source state unverified/);}
});
