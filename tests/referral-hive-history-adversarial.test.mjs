import test from 'node:test';
import assert from 'node:assert/strict';
import {customerHistory} from '../netlify/lib/referral-customer-history.mjs';
import {productionQualifiedCaseReader} from '../netlify/lib/referral-source-runtime.mjs';

// Synthetic, offline reviewer fixtures. These do not certify any live source.
const before='2026-11-04T12:00:00.000Z';
const email='synthetic-review@example.com';
const coverage={sourceMode:'hive-migrated',exactEmailLookupVerified:true,currentHistoryComplete:true,scope:'exact-email-index',through:before,deletedBehaviorVerified:true,reference:'synthetic-current',historicalMigrationVerified:true,migrationReference:'synthetic-migration'};
const page=data=>({data,next_cursor:null,total:data.length});
const member=(id,role='Customer')=>({id,role,email});
const inspection=(extra={})=>({id:'old1',contacts:[member('client1')],status:'confirmed',confirmed:true,canceled_at:null,deleted:false,scheduled_for:'2025-01-01T12:00:00Z',...extra});
function reader(rows=[],ids=['client1']) {return async path=>{const u=new URL(path,'https://local.invalid');if(u.pathname==='/contacts')return page(ids.map(id=>({id,email})));return page(typeof rows==='function'?rows(u.searchParams.get('contact_id')):rows);};}
async function history(extra={}) {return customerHistory({read:reader(),email,sourceContactIds:['client1'],currentInspectionId:'current1',before,coverage,legacyLookup:()=>{throw Error('Legacy must not run');},...extra});}

test('complete Hive mode clears without legacy and retains scoped identity claim',async()=>{const r=await history();assert.equal(r.newClient,true);assert.equal(r.globalPersonHistoryComplete,false);assert.equal(r.evidenceReference,'synthetic-current; synthetic-migration');});
for(const key of ['exactEmailLookupVerified','currentHistoryComplete','deletedBehaviorVerified','historicalMigrationVerified'])test(`coverage flag ${key} must be literal true`,async()=>{for(const value of [false,undefined,'true',1])assert.equal((await history({coverage:{...coverage,[key]:value}})).newClient,null);});
for(const key of ['reference','migrationReference'])test(`coverage ${key} must be nonempty`,async()=>{for(const value of [undefined,'', '  ',true])assert.equal((await history({coverage:{...coverage,[key]:value}})).newClient,null);});
test('old coverage and unsupported mode hold',async()=>{assert.equal((await history({coverage:{...coverage,through:'2026-11-04T11:59:59.999Z'}})).newClient,null);assert.equal((await history({coverage:{...coverage,sourceMode:'hive'}})).newClient,null);});
test('prior scheduled Customer disqualifies even absent migration certification',async()=>{assert.equal((await history({read:reader([inspection()]),coverage:{sourceMode:'hive-migrated'}})).newClient,false);});
test('starts_at only, conflicting timestamps and date-only history hold',async()=>{for(const extra of [{scheduled_for:undefined,starts_at:'2025-01-01T12:00:00Z'},{starts_at:'2025-01-02T12:00:00Z'},{scheduled_for:'2025-01-01'}])assert.equal((await history({read:reader([inspection(extra)])})).newClient,null);});
test('equivalent timestamp offsets do not conflict',async()=>{assert.equal((await history({read:reader([inspection({starts_at:'2025-01-01T07:00:00-05:00'})])})).newClient,false);});
test('known non-Customer role is ignored',async()=>{assert.equal((await history({read:reader([inspection({contacts:[member('client1','Buyer Agent')]})])})).newClient,true);});
test('queried unknown, missing and duplicated membership hold',async()=>{for(const contacts of [[],[member('other')],[member('client1','Unrecognized')],[member('client1'),member('client1','Buyer Agent')]])assert.equal((await history({read:reader([inspection({contacts})])})).newClient,null);});
test('canceled-first and confirmed-second duplicate conflict holds',async()=>{assert.equal((await history({read:reader(id=>[inspection({contacts:[member('client1'),member('client2')],status:id==='client1'?'canceled':'confirmed'})],['client1','client2'])})).newClient,null);});
test('mixed-role first then Customer second identical overlap disqualifies',async()=>{const row=inspection({contacts:[member('client1','Buyer Agent'),member('client2')]});assert.equal((await history({read:reader([row],['client1','client2'])})).newClient,false);});
test('Customer first then mixed-role second identical overlap disqualifies',async()=>{const row=inspection({contacts:[member('client1'),member('client2','Buyer Agent')]});assert.equal((await history({read:reader([row],['client1','client2'])})).newClient,false);});
test('contact order-only changes in duplicate overlap remain equivalent',async()=>{assert.equal((await history({read:reader(id=>[inspection({contacts:id==='client1'?[member('client1','Buyer Agent'),member('client2')]:[member('client2'),member('client1','Buyer Agent')]})],['client1','client2'])})).newClient,false);});
test('canceled-only identical overlaps can clear under coverage',async()=>{assert.equal((await history({read:reader([inspection({contacts:[member('client1'),member('client2')],status:'canceled'})],['client1','client2'])})).newClient,true);});
test('duplicate rows within a query hold',async()=>{assert.equal((await history({read:reader([inspection(),inspection()])})).newClient,null);});
test('malformed pagination envelope holds',async()=>{for(const bad of [{data:[],total:0},{data:[],total:1,next_cursor:null},{data:[],total:0,next_cursor:''},{data:[],total:'0',next_cursor:null}])assert.equal((await history({read:async()=>bad})).newClient,null);});
test('repeated cursor and changing totals hold',async()=>{for(const change of [false,true]){let n=0;assert.equal((await history({read:async()=>({data:[],total:change?n++:0,next_cursor:'repeat'})})).newClient,null);}});
test('source read rejection and page budget exhaustion hold',async()=>{assert.equal((await history({read:async()=>{throw Error('synthetic outage');}})).newClient,null);assert.equal((await history({maxPages:1})).newClient,null);});
test('identity conflict and exact-email mismatch hold',async()=>{assert.equal((await history({sharedEmailEvidence:{verified:true,reference:'synthetic-conflict'}})).newClient,null);assert.equal((await history({read:async()=>page([{id:'client1',email:'other@example.com'}])})).newClient,null);});

// Intentional adversarial assertions for malformed source data and budgets.
test('invalid calendar day cannot establish clean future history',async()=>{assert.equal((await history({read:reader([inspection({scheduled_for:'2026-11-31T12:00:00Z'})])})).newClient,null);});
test('malformed cancellation value cannot suppress prior history',async()=>{assert.equal((await history({read:reader([inspection({canceled_at:'not-a-date'})])})).newClient,null);});
test('malformed extra contact identity must hold rather than be ignored',async()=>{assert.equal((await history({read:reader([inspection({contacts:[member('client1','Buyer Agent'),{role:'Customer',email}]})])})).newClient,null);});
test('unknown extra contact role must hold rather than be ignored',async()=>{assert.equal((await history({read:reader([inspection({contacts:[member('client1','Buyer Agent'),member('other','Unrecognized')]})])})).newClient,null);});
test('initial source-contact set must respect contact budget even with empty exact index',async()=>{assert.equal((await history({sourceContactIds:['client1','client2'],maxContacts:1,read:reader([],[])})).newClient,null);});

function runtimeFixture(policy,clock=()=>Date.parse('2026-11-05T12:00:00Z')) {
 const keys=[];let legacyCalls=0;
 const current={id:'current1',contacts:[member('client1')],status:'confirmed',confirmed:true,canceled_at:null,deleted:false,created_at:before,ends_at:'2026-11-04T14:00:00Z',reports:{status:'published'},price:{paid:true,payment_status:'paid',amount_due:0,amount_paid:500},discount_codes:[{code:'REVIEW'}],services:[],refunded:false,disputed:false};
 const run=productionQualifiedCaseReader({store:{get:async key=>{keys.push(key);return policy;}},reviewStore:{async *list(){}},readHive:async path=>path==='inspections/current1'?current:reader()(path),ledger:async()=>({codes:[{Code:'REVIEW','Assignment State':'ASSIGNED','Hive State':'VERIFIED','Referrer Email':'referrer@example.com','Referrer ID':'ref1','Assigned At':'2026-11-01T12:00:00Z'}],shares:[],uses:[]}),readPriorReward:async()=>({}),legacyLookup:()=>{legacyCalls++;throw Error('Legacy must not run');},now:clock});
 return {run,keys,legacyCalls:()=>legacyCalls};
}
const policy={verified:true,reference:'synthetic-policy',validUntil:'2026-11-06T12:00:00Z',historyCoverage:coverage};
test('runtime Hive mode reads only policy and ignores injected legacy adapter',async()=>{const f=runtimeFixture(policy);const result=await f.run('HIVE-current1');assert.equal(result.facts.newCustomerVerified,true);assert.deepEqual(f.keys,['qualification-source-policy/current']);assert.equal(f.legacyCalls(),0);});
test('runtime missing, unsupported and legacy modes reject without archive lookup',async()=>{for(const sourceMode of [undefined,'unknown','current-plus-legacy']){const f=runtimeFixture({...policy,historyCoverage:{...coverage,sourceMode}});await assert.rejects(f.run('HIVE-current1'),/Hive migrated history policy unverified/);assert.deepEqual(f.keys,['qualification-source-policy/current']);assert.equal(f.legacyCalls(),0);}});
test('expired or unverified runtime policy rejects',async()=>{for(const change of [{validUntil:'2026-11-05T12:00:00Z'},{validUntil:'not-a-date'},{verified:false}]){const f=runtimeFixture({...policy,...change});await assert.rejects(f.run('HIVE-current1'),/Source coverage not verified/);}});
test('invalid calendar coverage horizon must not certify absence',async()=>{assert.equal((await history({coverage:{...coverage,through:'2026-11-31T12:00:00Z'}})).newClient,null);});
test('invalid calendar policy expiry must not certify freshness',async()=>{const f=runtimeFixture({...policy,validUntil:'2026-11-31T12:00:00Z'});await assert.rejects(f.run('HIVE-current1'),/Source coverage not verified/);});
