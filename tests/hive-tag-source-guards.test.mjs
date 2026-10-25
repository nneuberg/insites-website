import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,contact,page,catalogPage,MANUAL} from './hive-tag-sync-harness.mjs';
const recent='tag-sync/all-live-recent',full='tag-sync/all-live-full',holdKey='tag-sync/holds-live',last='tag-sync/last-live';
const bad=contact([],{id:'bad',email:'bad@example.invalid',tags:null});
const good=contact(['repeat buying agent']);
const validMatches=q=>page([contact(['repeat buying agent'],{id:q.get('email'),email:q.get('email')})]);
const malformedMatches=q=>page([contact([],{id:q.get('email'),email:q.get('email'),tags:null})]);
const heldRecord=(email,now,extra={})=>({id:email,email,firstHeldAt:now-600000,lastAttemptAt:now-600000,attempts:1,nextAttemptAt:now-300000,reason:'invalid-source-contact-tags',...extra});
async function holds(f){return (await f.store.get(holdKey))?.records??[];}
function addMember(f,email){for(const role of ['Agent','Customer'])f.members.set(f.keyFor(role,email),structuredClone(f.members.get(f.keyFor(role))));}
function badFirst(options={}){
 const f=fixture({page:()=>page([bad,good]),matches:q=>q.get('email')===bad.email?page([bad]):validMatches(q),...options});addMember(f,bad.email);return f;
}

const malformedEnvelopes={
 missingCursor:{data:[contact()],total:1},falseCursor:{data:[contact()],total:1,next_cursor:false},
 emptyCursor:{data:[contact()],total:1,next_cursor:''},numericCursor:{data:[contact()],total:1,next_cursor:3},
 missingTotal:{data:[contact()],next_cursor:null},stringTotal:{data:[contact()],next_cursor:null,total:'1'},
 negativeTotal:{data:[],next_cursor:null,total:-1},fractionTotal:{data:[],next_cursor:null,total:1.5},
 unsafeTotal:{data:[],next_cursor:null,total:Number.MAX_SAFE_INTEGER+1},
 tooFewTotal:{data:[contact()],next_cursor:null,total:0},
 missingID:page([contact([],{id:undefined})]),duplicateIDs:page([contact(),contact()])
};
for(const [name,value] of Object.entries(malformedEnvelopes))test(`email metadata ${name} stops before writes and never creates a bad-record hold`,async()=>{
 const f=fixture({matches:value});await assert.rejects(f.run());assert.equal(f.writes.length,0);assert.deepEqual(await holds(f),[]);
 assert.equal((await f.store.get(recent)).pending.length,1);assert.equal(await f.store.get(last),null);
});
for(const [name,value] of Object.entries(malformedEnvelopes))test(`discovery metadata ${name} leaves the saved cursor and watermarks unchanged`,async()=>{
 const f=fixture({page:()=>value}),state={cursor:'resume',since:f.now()-600000,cycleStarted:f.now()-600000,lastCycleComplete:123};
 await f.store.setJSON(recent,state);await assert.rejects(f.run());assert.deepEqual(await f.store.get(recent),state);assert.equal(f.writes.length,0);
});
for(const [name,value] of Object.entries({missingCursor:{data:[] ,total:0},missingTotal:{data:[],next_cursor:null},mismatch:{...catalogPage(['no business']),total:2},duplicateIDs:page([{id:'same',name:'one'},{id:'same',name:'two'}])}))
 test(`catalog ${name} is rejected before saving catalog or fetching contacts`,async()=>{
  const f=fixture({catalog:value});await assert.rejects(f.run());assert.equal(await f.store.get('tag-sync/catalog'),null);assert.equal(f.calls.length,1);
 });
for(const [name,records] of Object.entries({missing:[{id:'x',email:'fixture@example.invalid'}],null:[contact([],{tags:null})],blankName:[contact([],{tags:[{name:' '} ]})],nullTag:[contact([],{tags:[null]})],empty:[]}))
 test(`isolated contact ${name} is durably held without writes or false completion`,async()=>{
  const f=fixture({matches:page(records)}),result=await f.run();
  assert.equal(f.writes.length,0);assert.equal(result.held,1);assert.equal(result.unresolvedHolds,1);assert.equal(result.partial,true);
  assert.equal(result.fullTraversalComplete,true);assert.equal(result.cycleComplete,false);assert.equal((await holds(f)).length,1);
  assert.equal((await f.store.get(full)).lastVerifiedCycleComplete,undefined);
 });
test('bad first record does not block healthy contacts or the full pass, including subsequent ticks',async()=>{
 const f=badFirst();const r=await f.run();assert.equal(r.recentChecked,1);assert.equal(r.fullChecked,1);assert.equal(r.deferred,1);
 assert.equal(r.unresolvedHolds,1);assert.equal(f.writes.length,2);
 const initialBadReads=f.calls.filter(c=>c.url.includes('email=bad%40')).length;
 await f.run();assert.equal(f.calls.filter(c=>c.url.includes('email=bad%40')).length,initialBadReads);assert.equal(f.writes.length,2);
 for(const role of ['Agent','Customer'])assert.ok(f.members.get(f.keyFor(role,bad.email)).tags.some(t=>t.name==='no business'));
});
test('repairing a held contact resolves both audiences across due retries without replay',async()=>{
 const f=badFirst();await f.run();f.options.matches=validMatches;f.advance(300000);
 const first=await f.run();assert.equal(first.retryAudiencesCompleted,1);assert.equal(first.resolvedHolds,0);assert.equal(first.unresolvedHolds,1);f.advance(300000);
 const r=await f.run();assert.equal(r.retried,1);assert.equal(r.resolvedHolds,1);assert.equal(r.unresolvedHolds,0);assert.equal(r.cycleComplete,true);
 assert.equal(f.writes.length,4);await f.run();assert.equal(f.writes.length,4);assert.deepEqual(await holds(f),[]);
});
test('holds use one bounded fair retry per tick and back off without expiry',async()=>{
 const f=fixture({page:()=>page([]),matches:malformedMatches});const emails=['a@example.invalid','b@example.invalid','c@example.invalid'];
 await f.store.setJSON(holdKey,{version:1,records:emails.map(email=>heldRecord(email,f.now()))});
 for(const email of emails){const before=f.calls.length,r=await f.run();assert.equal(r.retried,1);const lookups=f.calls.slice(before).filter(c=>c.url.includes('email='));assert.equal(lookups.length,1);assert.equal(new URL(lookups[0].url).searchParams.get('email'),email);f.advance(1000);}
 assert.deepEqual((await holds(f)).map(h=>h.attempts),[2,2,2]);
 assert.ok((await holds(f)).every(h=>h.nextAttemptAt-h.lastAttemptAt===600000));
 assert.equal((await f.run()).retried,0);
 f.advance(365*86400000);assert.equal((await f.run()).retried,1);assert.equal((await holds(f)).length,3);
});
test('backoff caps at one hour and the original failure timestamp survives',async()=>{
 const f=fixture({page:()=>page([]),matches:malformedMatches}),record=heldRecord('a@example.invalid',f.now(),{attempts:40});
 await f.store.setJSON(holdKey,{version:1,records:[record]});await f.run();const saved=(await holds(f))[0];
 assert.equal(saved.attempts,41);assert.equal(saved.nextAttemptAt-saved.lastAttemptAt,3600000);assert.equal(saved.firstHeldAt,record.firstHeldAt);
});
test('hold write failure leaves the contact pending and stops safely',async()=>{
 let fail=true;const f=badFirst({beforeSave:key=>{if(fail&&key===holdKey)throw Error('hold storage unavailable');}});
 await assert.rejects(f.run(),/hold storage unavailable/);assert.equal((await f.store.get(recent)).pending.length,2);assert.equal(f.writes.length,0);
 fail=false;await f.run();assert.equal((await holds(f)).length,1);assert.equal(f.writes.length,2);
});
test('a rejected hold save is not treated as durable acknowledgement',async()=>{
 const f=badFirst(),save=f.store.setJSON;f.store.setJSON=(k,v,o)=>k===holdKey?Promise.resolve({modified:false}):save(k,v,o);
 await assert.rejects(f.run(),/not saved/);assert.equal((await f.store.get(recent)).pending.length,2);assert.equal(f.writes.length,0);
});
test('ambiguous hold persistence replays safely without duplicating or dropping the hold',async()=>{
 const f=badFirst(),save=f.store.setJSON;let fail=true;
 f.store.setJSON=async(k,v,o)=>{const r=await save(k,v,o);if(fail&&k===holdKey){fail=false;throw Error('hold acknowledgement lost');}return r;};
 await assert.rejects(f.run(),/acknowledgement lost/);assert.equal((await holds(f)).length,1);assert.equal((await f.store.get(recent)).pending.length,2);
 await f.run();assert.equal((await holds(f)).length,1);assert.equal((await holds(f))[0].attempts,1);assert.equal(f.writes.length,2);
});
test('crash after hold persistence but before pending checkpoint cannot lose a record',async()=>{
 let fail=true;const f=badFirst({beforeSave:(k,v)=>{if(fail&&k===recent&&v.pending?.length===1){fail=false;throw Error('checkpoint crash');}}});
 await assert.rejects(f.run(),/checkpoint crash/);assert.equal((await holds(f)).length,1);assert.equal((await f.store.get(recent)).pending.length,2);
 await f.run();assert.equal((await holds(f)).length,1);assert.equal(f.writes.length,2);assert.equal((await f.store.get(recent)).pending,undefined);
});
test('interruption after retry reservation lets the next due record proceed on recovery',async()=>{
 const f=fixture({page:()=>page([]),matches:malformedMatches}),save=f.store.setJSON;
 await f.store.setJSON(holdKey,{version:1,records:['a@example.invalid','b@example.invalid'].map(email=>heldRecord(email,f.now()))});let fail=true;
 f.store.setJSON=async(k,v,o)=>{const r=await save(k,v,o);if(fail&&k===holdKey&&v.records[0].attempts===2){fail=false;throw Error('retry reservation crash');}return r;};
 await assert.rejects(f.run(),/reservation crash/);await f.run();const lookups=f.calls.filter(c=>c.url.includes('email='));
 assert.equal(lookups.length,1);assert.equal(new URL(lookups[0].url).searchParams.get('email'),'b@example.invalid');
});
test('hold resolution checkpoint failure retains retry work and converges without replay',async()=>{
 let fail=false;const f=badFirst({beforeSave:(k,v)=>{if(fail&&k===holdKey&&v.records.length===0){fail=false;throw Error('resolution save failed');}}});
 await f.run();f.options.matches=validMatches;f.advance(300000);fail=true;
 await f.run();f.advance(300000);
 await assert.rejects(f.run(),/resolution save failed/);assert.equal((await holds(f)).length,1);assert.equal(f.writes.length,4);
 f.advance(600000);await f.run();assert.deepEqual(await holds(f),[]);assert.equal(f.writes.length,4);
});
for(const failure of [401,403,429,500,'network','invalid-json'])test(`global ${failure} during a held retry stops the run and retains all holds`,async()=>{
 const f=fixture({intercept:(url,request,next)=>{
  if(url.includes('email=')){if(failure==='network')throw Error('mock connection lost');if(failure==='invalid-json')return new Response('{',{status:200});return new Response(null,{status:failure});}return next();
 }});
 await f.store.setJSON(holdKey,{version:1,records:[heldRecord('a@example.invalid',f.now())]});await assert.rejects(f.run());
 assert.equal((await holds(f)).length,1);assert.equal(await f.store.get(recent),null);assert.equal(await f.store.get(full),null);assert.equal(f.writes.length,0);
});
test('live and audit hold queues are isolated and audit cannot repair live state',async()=>{
 const f=badFirst();await f.run();const before=await f.store.get(holdKey),writes=f.writes.length;await f.run({apply:false});
 assert.deepEqual(await f.store.get(holdKey),before);assert.equal(f.writes.length,writes);assert.equal((await f.store.get('tag-sync/holds-audit')).records.length,1);
});
test('valid short and empty intermediate pages follow cursors rather than page length',async()=>{
 const f=fixture({page:q=>q.get('cursor')==='p2'?{data:[],next_cursor:'p3',total:2}:q.get('cursor')==='p3'?{data:[contact([],{id:'b'})],next_cursor:null,total:2}:{data:[contact([],{id:'a'})],next_cursor:'p2',total:2}});
 assert.equal((await f.run()).cycleComplete,false);assert.equal((await f.run()).cycleComplete,false);const r=await f.run();assert.equal(r.cycleComplete,true);assert.equal(r.fullContacts,2);
});
for(const [reason,later] of Object.entries({
 'changed-total':{data:[contact([],{id:'b'})],next_cursor:null,total:3},
 'repeated-contact':{data:[contact([],{id:'a'})],next_cursor:null,total:2},
 'repeated-cursor':{data:[contact([],{id:'b'})],next_cursor:'p2',total:2},
 'inconsistent-terminal-count':{data:[],next_cursor:null,total:2}
}))test(`coverage ${reason} preserves cursor, refuses completion, and retries from a counted start`,async()=>{
 const f=fixture({page:q=>q.has('cursor')?later:{data:[contact([],{id:'a'})],next_cursor:'p2',total:2}});await f.run();
 const before=await f.store.get(recent),lastBefore=await f.store.get(last);await assert.rejects(f.run(),new RegExp(reason));
 const after=await f.store.get(recent);assert.equal(after.cursor,'p2');assert.equal(after.since,before.since);assert.deepEqual(after.coverage,before.coverage);
 assert.equal(after.restartRequired.reason,reason);assert.deepEqual(await f.store.get(last),lastBefore);assert.equal(after.lastVerifiedCycleComplete,undefined);
 f.options.page=q=>q.has('cursor')?{data:[contact([],{id:'b'})],next_cursor:null,total:2}:{data:[contact([],{id:'a'})],next_cursor:'p2',total:2};
 await f.run();assert.equal((await f.store.get(recent)).restartRequired,undefined);assert.equal((await f.store.get(recent)).since,before.since);
 await f.run();assert.ok((await f.store.get(recent)).lastVerifiedCycleComplete);assert.equal(f.writes.length,2);
});
test('a cursor cycle back to an earlier page is rejected before any page effects',async()=>{
 const f=fixture({page:q=>q.get('cursor')==='p3'?{data:[contact([],{id:'c'})],next_cursor:'p2',total:4}:q.get('cursor')==='p2'?{data:[contact([],{id:'b'})],next_cursor:'p3',total:4}:{data:[contact([],{id:'a'})],next_cursor:'p2',total:4}});
 await f.run();await f.run();await assert.rejects(f.run(),/repeated-cursor/);assert.equal((await f.store.get(recent)).cursor,'p3');
});
test('legacy pending contacts are consumed without inventing coverage or advancing its watermark',async()=>{
 const f=fixture(),oldSince=f.now()-3600000;
 await f.store.setJSON(full,{cursor:'old-page',pending:[{id:'legacy',email:good.email}],next:null,total:2729,since:oldSince,cycleStarted:oldSince,lastCycleComplete:123});
 const first=await f.run();assert.equal(first.fullCoverage,'legacy-unverified');assert.equal(first.cycleComplete,false);assert.equal(first.fullChecked,1);
 const state=await f.store.get(full);assert.equal(state.since,oldSince);assert.equal(state.lastCycleComplete,123);assert.equal(state.lastVerifiedCycleComplete,undefined);assert.equal(state.pending,undefined);
 const second=await f.run();assert.equal(second.cycleComplete,true);assert.equal(second.fullContacts,1);assert.ok((await f.store.get(full)).lastVerifiedCycleComplete);
});
test('legacy empty pending checkpoint finalizes its saved next cursor without re-fetching the page',async()=>{
 const f=fixture();await f.store.setJSON(full,{cursor:null,pending:[],next:'legacy-next',total:10,since:f.now(),cycleStarted:f.now()});
 const r=await f.run();assert.equal(r.fullCoverage,'in-progress');assert.equal((await f.store.get(full)).cursor,'legacy-next');
 assert.equal(f.calls.filter(c=>c.url.includes('/contacts?')&&!c.url.includes('email=')&&!c.url.includes('updated_since')).length,0);
});
test('interrupted processing retains counted pending IDs exactly once',async()=>{
 let fail=true;const f=fixture({beforeSave:(k,v)=>{if(fail&&k===full&&v.pending?.length===0){fail=false;throw Error('full checkpoint failed');}}});
 await assert.rejects(f.run(),/full checkpoint failed/);const state=await f.store.get(full);assert.equal(state.pending.length,1);assert.deepEqual(state.coverage.ids,['fixture-one']);
 const r=await f.run();assert.equal(r.fullContacts,1);assert.equal(r.cycleComplete,true);assert.equal(f.writes.length,2);
});
test('budget exhaustion durably retains slow work for bounded audience retries',async()=>{
 let f,slow=true;f=fixture({intercept:async(url,request,next)=>{const r=await next();if(slow&&url.includes('email=')){slow=false;f.advance(26000);}return r;}});
 const r=await f.run();assert.equal(r.budgetExhausted,true);assert.equal(r.partial,true);assert.equal(f.writes.length,0);
 assert.equal((await f.store.get(recent)).pending,undefined);assert.equal(await f.store.get(full),null);assert.equal((await holds(f))[0].reason,'reconciliation-budget');
 f.advance(300000);await f.run();f.advance(300000);await f.run();assert.equal(f.writes.length,2);assert.deepEqual(await holds(f),[]);
});
test('at most 25 discovery contacts per pass and one held retry run in a tick',async()=>{
 const contacts=Array.from({length:25},(_,i)=>contact([],{id:'id-'+i,email:`fixture-${i}@example.invalid`}));
 const f=fixture({page:()=>page(contacts),matches:validMatches});await f.store.setJSON(holdKey,{version:1,records:['a@example.invalid','b@example.invalid'].map(email=>heldRecord(email,f.now()))});
 const r=await f.run();assert.equal(r.retried,1);assert.equal(r.recentChecked,25);assert.equal(r.fullChecked,25);assert.equal(f.calls.filter(c=>c.url.includes('email=')).length,51);
});
test('valid-looking wrong provider tags remain an explicit undetectable limit',async()=>{
 const f=fixture({matches:page([contact([])])});await f.run();assert.equal(f.writes.length,2);
 for(const member of f.members.values())assert.deepEqual(member.tags.map(t=>t.name),MANUAL);
});
test('one invalid duplicate holds the entire email snapshot before either audience is changed',async()=>{
 const f=fixture({matches:page([contact(['no business']),contact([],{id:'other-duplicate',tags:null})])});
 const r=await f.run();assert.equal(r.unresolvedHolds,1);assert.equal(f.writes.length,0);
});
test('more records than the requested limit are rejected, not silently truncated',async()=>{
 const tooMany=Array.from({length:201},(_,i)=>contact([],{id:'contact-'+i}));
 const f=fixture({matches:page(tooMany)});await assert.rejects(f.run(),/Incomplete email match/);assert.equal(f.writes.length,0);
 const g=fixture({page:()=>page(tooMany.slice(0,26))});await assert.rejects(g.run(),/Incomplete contact page/);assert.equal(g.writes.length,0);
});
test('a zero-match hold can later recover without importing a missing Mailchimp member',async()=>{
 const f=fixture({matches:page([])});await f.run();f.members.clear();f.options.matches=validMatches;f.advance(300000);
 await f.run();f.advance(300000);
 const r=await f.run();assert.equal(r.resolvedHolds,1);assert.equal(r.unresolvedHolds,0);assert.equal(f.writes.length,0);
});
