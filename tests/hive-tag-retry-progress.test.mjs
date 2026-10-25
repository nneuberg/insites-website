import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,contact,page,MANUAL} from './hive-tag-sync-harness.mjs';
const holdKey='tag-sync/holds-live';
const email='fixture@example.invalid';
const holds=async f=>(await f.store.get(holdKey))?.records??[];
async function repairedFixture({memberTags=['repeat buying agent',...MANUAL],mutate=false,catalogDelay=0,requestDelay=9000}={}){
 const f=fixture({memberTags,matches:page([contact([],{tags:null})])});await f.run();
 f.options.matches=page([contact(mutate?['vip buying agent']:['repeat buying agent'])]);
 f.options.page=()=>page([]);
 const trace=[];
 f.options.intercept=async(url,request,next)=>{
  const start=f.now(),response=await next();
  const delay=url.includes('email=')||url.includes('/members/')?requestDelay:url.endsWith('/tags')?catalogDelay:0;
  // Concurrent reads finish after max(latencies), not their sum. No real timers or network.
  await Promise.resolve();f.advance(Math.max(0,start+delay-f.now()));
  trace.push({url,method:request.method,start,end:f.now()});return response;
 };
 return {f,trace};
}
async function tick(f){f.advance(3600000);return f.run();}
async function drain(f){for(let i=0;i<8&&(await holds(f)).length;i++)await tick(f);assert.deepEqual(await holds(f),[]);}
function assertOnlyTagChanges(f){
 for(const member of f.members.values()){
  for(const name of MANUAL)assert.ok(member.tags.some(t=>t.name===name),name);
  assert.ok(['unsubscribed','transactional'].includes(member.status));assert.equal(member.merge_fields.HISTORY,'retain');
 }
}
test('repaired holds finish both audiences under sustained nine-second successful reads',async()=>{
 const {f,trace}=await repairedFixture();const results=[];
 for(let i=0;i<3&&(await holds(f)).length;i++){f.advance(3600000);results.push(await f.run());}
 assert.equal((await holds(f)).length,0,JSON.stringify(results.map(r=>({retried:r.retried,resolved:r.resolvedHolds,unresolved:r.unresolvedHolds,budget:r.budgetExhausted}))));
 for(const role of ['Agent','Customer'])assert.ok(trace.some(c=>c.url.endsWith(f.keyFor(role))&&c.method==='GET'));
 assert.equal(f.writes.length,0);
});
for(const latency of [9000,11900])test(`slow ${latency}ms catalog, source, member and tag mutation finish in two bounded audience turns`,async()=>{
 const {f,trace}=await repairedFixture({mutate:true,catalogDelay:latency,requestDelay:latency});
 for(const role of ['Agent','Customer']){
  const start=f.now()+3600000,offset=trace.length,r=await tick(f);
  assert.ok(f.now()-start<=latency*2);assert.equal(r.retryAudiencesCompleted,1);
  assert.equal(trace.slice(offset).filter(c=>c.method==='POST').length,1);
  assert.ok(trace.slice(offset).find(c=>c.method==='POST').url.includes(f.keyFor(role)));
  const lookups=trace.slice(offset).filter(c=>c.method==='GET'&&(c.url.includes('email=')||c.url.includes('/members/')||c.url.endsWith('/tags')));
  assert.equal(new Set(lookups.map(c=>c.start)).size,1,'fresh reads overlap instead of adding three request latencies');
 }
 assert.deepEqual(await holds(f),[]);assert.equal(f.writes.length,2);
 for(const member of f.members.values())assert.ok(member.tags.some(t=>t.name==='vip buying agent'));
 assertOnlyTagChanges(f);await tick(f);assert.equal(f.writes.length,2);
});
test('changed source tags invalidate earlier audience completion and every write uses the new snapshot',async()=>{
 const {f}=await repairedFixture({mutate:true});await tick(f);const first=(await holds(f))[0].progress;
 assert.deepEqual(first.completed,['Agent']);f.options.matches=page([contact(['no business'])]);
 await tick(f);const second=(await holds(f))[0].progress;assert.notEqual(second.sourceKey,first.sourceKey);assert.deepEqual(second.completed,['Customer']);
 assert.equal(f.writes.length,2);assert.deepEqual(f.writes[1].body.tags,[{name:'no business',status:'active'},{name:'repeat buying agent',status:'inactive'}]);
 await tick(f);assert.deepEqual(await holds(f),[]);assert.equal(f.writes.length,3);
 for(const member of f.members.values()){assert.ok(member.tags.some(t=>t.name==='no business'));assert.ok(!member.tags.some(t=>t.name==='vip buying agent'));}assertOnlyTagChanges(f);
});
test('equivalent normalized duplicate tag unions keep valid completion',async()=>{
 const {f}=await repairedFixture({mutate:true});await tick(f);const key=(await holds(f))[0].progress.sourceKey;
 f.options.matches=page([contact([' VIP BUYING AGENT ']),contact(['vip buying agent'],{id:'duplicate'})]);
 await tick(f);assert.deepEqual(await holds(f),[]);assert.equal(f.writes.length,2);assert.match(key,/^[a-f0-9]{64}$/);
});
test('malformed repaired source clears completed audiences without writing cached tags',async()=>{
 const {f}=await repairedFixture({mutate:true});await tick(f);f.options.matches=page([contact([],{tags:null})]);
 await tick(f);assert.deepEqual((await holds(f))[0].progress.completed,[]);assert.equal((await holds(f))[0].progress.sourceKey,null);assert.equal(f.writes.length,1);
 f.options.matches=page([contact(['no business'])]);await drain(f);assert.equal(f.writes.length,3);assertOnlyTagChanges(f);
});
for(const ambiguous of [false,true])test(`source invalidation persistence ${ambiguous?'acknowledgement loss':'failure'} cannot write or certify obsolete progress`,async()=>{
 const {f}=await repairedFixture({mutate:true});await tick(f);const old=(await holds(f))[0].progress.sourceKey;
 f.options.matches=page([contact(['no business'])]);const save=f.store.setJSON;let fail=true;
 f.store.setJSON=async(k,v,o)=>{
  if(fail&&k===holdKey&&v.records[0]?.progress.sourceKey!==old){fail=false;if(ambiguous)await save(k,v,o);throw Error('invalidation save interrupted');}
  return save(k,v,o);
 };
 await assert.rejects(tick(f),/invalidation save interrupted/);assert.equal(f.writes.length,1);assert.equal((await holds(f)).length,1);
 if(ambiguous)assert.deepEqual((await holds(f))[0].progress.completed,[]);
 await drain(f);assert.equal(f.writes.length,3);assertOnlyTagChanges(f);
});
for(const ambiguous of [false,true])test(`audience completion persistence ${ambiguous?'acknowledgement loss':'failure'} replays reads without replaying the mutation`,async()=>{
 const {f}=await repairedFixture({mutate:true});const save=f.store.setJSON;let fail=true;
 f.store.setJSON=async(k,v,o)=>{
  if(fail&&k===holdKey&&v.records[0]?.progress.completed.length===1){fail=false;if(ambiguous)await save(k,v,o);throw Error('completion save interrupted');}
  return save(k,v,o);
 };
 await assert.rejects(tick(f),/completion save interrupted/);assert.equal(f.writes.length,1);
 await drain(f);assert.equal(f.writes.length,2);assertOnlyTagChanges(f);
});
for(const failure of ['lost-response','invalid-json'])test(`uncertain slow write (${failure}) leaves resumable work and never replays an applied tag mutation`,async()=>{
 const {f}=await repairedFixture({mutate:true});const intercept=f.options.intercept;let fail=true;
 f.options.intercept=async(url,request,next)=>{
  const response=await intercept(url,request,next);
  if(fail&&request.method==='POST'){fail=false;if(failure==='lost-response')throw Error('response lost');return new Response('{',{status:200});}return response;
 };
 await assert.rejects(tick(f));assert.equal(f.writes.length,1);assert.equal((await holds(f)).length,1);
 await drain(f);assert.equal(f.writes.length,2);assertOnlyTagChanges(f);
});
test('an interruption after clearing a completed hold does not recreate stale retry work',async()=>{
 const {f}=await repairedFixture({mutate:true});await tick(f);const save=f.store.setJSON;let fail=true;
 f.store.setJSON=async(k,v,o)=>{const r=await save(k,v,o);if(fail&&k===holdKey&&v.records.length===0){fail=false;throw Error('resolution acknowledgement lost');}return r;};
 await assert.rejects(tick(f),/resolution acknowledgement lost/);assert.deepEqual(await holds(f),[]);assert.equal(f.writes.length,2);await tick(f);assert.equal(f.writes.length,2);
});
test('crash after reservation rotates the audience even when the first audience never starts',async()=>{
 const {f,trace}=await repairedFixture({mutate:true});const save=f.store.setJSON;let fail=true;
 f.store.setJSON=async(k,v,o)=>{const r=await save(k,v,o);if(fail&&k===holdKey&&v.records[0]?.attempts===2){fail=false;throw Error('reservation interrupted');}return r;};
 await assert.rejects(tick(f),/reservation interrupted/);assert.equal(trace.length,0);
 await tick(f);assert.ok(f.writes[0].key===f.keyFor('Customer'));await drain(f);assert.equal(f.writes.length,2);
});
for(const service of ['catalog','source','member'])for(const failure of [401,429,'transport','invalid-json'])
 test(`parallel ${service} ${failure} remains a run-stopping global failure`,async()=>{
  const {f}=await repairedFixture({mutate:true});const original=f.options.intercept;
  f.options.intercept=(url,request,next)=>{
   const target=service==='catalog'?url.endsWith('/v1/tags'):service==='source'?url.includes('email='):url.includes('/members/');
   if(target){if(failure==='transport')throw Error('transport unavailable');if(failure==='invalid-json')return new Response('{',{status:200});return new Response(null,{status:failure});}
   return original(url,request,next);
  };
  await assert.rejects(tick(f));assert.equal(f.writes.length,0);assert.equal((await holds(f)).length,1);assert.equal((await holds(f))[0].reason,'invalid-source-contact-tags');
 });
test('a concurrent global member failure wins over isolated bad Hive tags and waits for all reads',async()=>{
 const {f,trace}=await repairedFixture();f.options.matches=page([contact([],{tags:null})]);const original=f.options.intercept;
 f.options.intercept=(url,request,next)=>url.includes('/members/')?new Response(null,{status:403}):original(url,request,next);
 await assert.rejects(tick(f),{status:403});assert.ok(trace.some(c=>c.url.includes('email=')));assert.equal(f.writes.length,0);
});
test('incomplete pagination on a later audience fails closed instead of using the previous source snapshot',async()=>{
 const {f}=await repairedFixture({mutate:true});await tick(f);f.options.matches={data:[contact([])],next_cursor:null,total:2};
 await assert.rejects(tick(f),/Incomplete email match/);assert.equal(f.writes.length,1);assert.deepEqual((await holds(f))[0].progress.completed,['Agent']);
 f.options.matches=page([contact(['no business'])]);await drain(f);assert.equal(f.writes.length,3);
});
test('two slow repaired records alternate due turns without starving either audience',async()=>{
 const {f,trace}=await repairedFixture({mutate:true});const saved=await f.store.get(holdKey);
 saved.records.push({...saved.records[0],id:'second',email:'second@example.invalid'});await f.store.setJSON(holdKey,saved);
 for(const role of ['Agent','Customer'])f.members.set(f.keyFor(role,'second@example.invalid'),structuredClone(f.members.get(f.keyFor(role))));
 f.options.matches=q=>page([contact(['vip buying agent'],{email:q.get('email')})]);
 for(let i=0;i<4;i++)await tick(f);
 assert.deepEqual(await holds(f),[]);assert.equal(f.writes.length,4);
 assert.deepEqual(trace.filter(c=>c.url.includes('email=')).map(c=>new URL(c.url).searchParams.get('email')),[email,'second@example.invalid',email,'second@example.invalid']);
 assertOnlyTagChanges(f);
});
test('resolved held emails encountered by discovery are acknowledged without redoing the slow record in that tick',async()=>{
 const {f}=await repairedFixture({mutate:true});f.options.page=()=>page([contact()]);
 await tick(f);await tick(f);assert.deepEqual(await holds(f),[]);assert.equal(f.writes.length,2);
 // The post-write time budget leaves discovery pending; a no-change recovery
 // finishes at 9s, giving discovery time to encounter the just-resolved email.
 const g=(await repairedFixture()).f;g.options.page=()=>page([contact()]);await tick(g);const r=await tick(g);
 assert.deepEqual(await holds(g),[]);assert.equal(r.deferred,2);assert.equal(r.cycleComplete,true);assert.equal(g.writes.length,0);
});
for(const ambiguous of [false,true])test(`budget hold persistence ${ambiguous?'acknowledgement loss':'failure'} preserves pending work`,async()=>{
 const f=fixture();const save=f.store.setJSON;let fail=true;
 f.options.intercept=async(url,request,next)=>{const r=await next();if(url.includes('email=')||url.includes('/members/'))f.advance(9000);return r;};
 f.store.setJSON=async(k,v,o)=>{
  if(fail&&k===holdKey){fail=false;if(ambiguous)await save(k,v,o);throw Error('budget hold save interrupted');}return save(k,v,o);
 };
 await assert.rejects(f.run(),/budget hold save interrupted/);assert.equal((await f.store.get('tag-sync/all-live-recent')).pending.length,1);assert.equal(f.writes.length,0);
 delete f.options.intercept;await tick(f);await drain(f);assert.equal(f.writes.length,2);
});
test('repeated slow valid discovery records enter resumable retry work while healthy contacts and full scanning progress',async()=>{
 const {f}=await repairedFixture({mutate:true});const healthy='healthy@example.invalid';
 for(const role of ['Agent','Customer'])f.members.set(f.keyFor(role,healthy),structuredClone(f.members.get(f.keyFor(role))));
 f.options.page=()=>page([contact(),contact([],{id:'healthy',email:healthy})]);
 f.options.matches=q=>page([contact(['vip buying agent'],{id:q.get('email'),email:q.get('email')})]);
 const original=f.options.intercept;
 f.options.intercept=(url,request,next)=>url.includes('healthy%40')||['Agent','Customer'].some(role=>url.includes(f.keyFor(role,healthy)))?next():original(url,request,next);
 const results=[];for(let i=0;i<8;i++)results.push(await tick(f));
 assert.ok(results.some(r=>r.fullChecked>0));assert.ok(results.some(r=>r.fullTraversalComplete));
 assert.ok(f.calls.some(c=>c.url.includes('healthy%40')));assert.equal(f.writes.length,4);assertOnlyTagChanges(f);
});
for(const progress of [null,{}, {version:1,nextRole:'Other',completed:[],sourceKey:null},{version:1,nextRole:'Agent',completed:['Agent'],sourceKey:null}])
 test(`invalid saved retry progress fails closed: ${JSON.stringify(progress)}`,async()=>{
  const {f}=await repairedFixture();const saved=await f.store.get(holdKey);saved.records[0].progress=progress;await f.store.setJSON(holdKey,saved);
  await assert.rejects(tick(f),/Invalid saved tag-sync holds/);assert.equal(f.writes.length,0);
 });
