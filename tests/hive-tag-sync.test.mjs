import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {REMOVABLE_HIVE_TAGS,tagChanges} from '../netlify/lib/hive-tag-sync.mjs';
import {fixture,contact,tags,page,catalogPage,OWNED,MANUAL} from './hive-tag-sync-harness.mjs';
const inactive=names=>names.map(name=>({name,status:'inactive'}));
const active=names=>names.map(name=>({name,status:'active'}));

test('the immutable removal boundary is exactly the nine approved automatic statuses',()=>{
 assert.deepEqual(REMOVABLE_HIVE_TAGS,OWNED);assert.ok(Object.isFrozen(REMOVABLE_HIVE_TAGS));
 assert.deepEqual(tagChanges(OWNED,[],[]),active(OWNED));
 assert.deepEqual(tagChanges([],OWNED,[]),inactive(OWNED));
 assert.deepEqual(tagChanges(OWNED,OWNED,OWNED),[]);
});
test('every non-owned tag survives even a same-name current or historical Hive catalog collision',()=>{
 const arbitrary=Array.from({length:500},(_,i)=>`manual tag ${i}`);
 const names=[...MANUAL,...arbitrary];
 assert.deepEqual(tagChanges([],names,names),[]);
 assert.deepEqual(tagChanges([],names,[]),[]);
});
test('preserves existing Hive additions while excluding review workflow-owned additions',()=>{
 const names=['new manual Hive tag','google reviewed','REF:QA','photo client','campaign october'];
 assert.deepEqual(tagChanges([...names,'REVIEW:PENDING','feedback received'],[],names),active(names));
});
test('case and surrounding whitespace normalize ownership, presence and protected operational names',()=>{
 const names=OWNED.map(n=>`  ${n.toUpperCase()}\t`);
 assert.deepEqual(tagChanges([],names,[]),inactive(names));
 assert.deepEqual(tagChanges(OWNED,names,OWNED),[]);
 assert.deepEqual(tagChanges([' VIP BUYING AGENT ','vip buying agent'],[],[]),active(['vip buying agent']));
 const operational=MANUAL.map(n=>`  ${n.toUpperCase()}  `);
 assert.deepEqual(tagChanges([],operational,operational),[]);
 assert.deepEqual(tagChanges(['  REVIEW:PENDING ',' FEEDBACK RECEIVED '],[],[]),[]);
 assert.deepEqual(tagChanges([],['vip  buying agent'],['vip  buying agent']),[]);
});
test('missing, null, non-array, blank and invalid tag names reject before any changes',()=>{
 for(const bad of [undefined,null,{},'', [null],[{}],[1],[''],['  ']]){
  for(const index of [0,1,2]){const input=[[],[],[]];input[index]=bad;assert.throws(()=>tagChanges(...input),/Incomplete tag data/);}
 }
});
test('live reconciliation changes only tags on existing audience members and is idempotent',async()=>{
 const f=fixture(),before=[...f.members.values()].map(({tags,...rest})=>structuredClone(rest));
 const result=await f.run();assert.equal(result.added,2);assert.equal(result.removed,2);
 assert.equal(result.removalPolicy,'automatic-agent-status-v1');assert.deepEqual(result.removableTags,OWNED);
 for(const member of f.members.values())assert.deepEqual(member.tags,tags([...MANUAL,'repeat buying agent']));
 assert.deepEqual([...f.members.values()].map(({tags,...rest})=>rest),before);
 assert.equal((await f.run()).added,0);assert.equal(f.writes.length,2);
 assert.equal((await f.store.get('tag-sync/last-live')).removalPolicy,'automatic-agent-status-v1');
});
test('audit calculates the same plan with zero Mailchimp writes and separate cursor state',async()=>{
 const f=fixture(),before=structuredClone([...f.members]);const result=await f.run({apply:false});
 assert.equal(result.mode,'audit');assert.ok(result.added>0);assert.equal(f.writes.length,0);
 assert.deepEqual([...f.members],before);assert.equal(await f.store.get('tag-sync/all-live-full'),null);
 assert.ok(await f.store.get('tag-sync/all-audit-full'));
});
test('union of duplicate Hive emails prevents a status present on either record being removed',async()=>{
 const f=fixture({matches:page([contact(['no business']),contact(['repeat buying agent'],{id:'fixture-two',email:' FIXTURE@EXAMPLE.INVALID '})])});
 await f.run();for(const member of f.members.values())assert.ok(member.tags.some(t=>t.name==='no business'));
 assert.ok(f.writes.every(w=>w.body.tags.every(t=>t.status==='active')));
});
for(const [name,matches] of Object.entries({
 missing:{},nullData:{data:null},paginated:{data:[contact()],next_cursor:'more',total:2},
 wrongEmail:page([contact([],{email:'another@example.invalid'})])
}))test(`incomplete email lookup (${name}) fails closed and keeps contact queued`,async()=>{
 const f=fixture({matches});await assert.rejects(f.run());assert.equal(f.writes.length,0);
 assert.equal((await f.store.get('tag-sync/all-live-recent')).pending.length,1);
});
for(const [name,catalog] of Object.entries({missing:{},nullData:{data:null},paginated:{...catalogPage(OWNED),next_cursor:'more'},invalidName:catalogPage([' '])}))
 test(`incomplete catalog (${name}) aborts before contact or member reads`,async()=>{
  const f=fixture({catalog});await assert.rejects(f.run());assert.equal(f.calls.length,1);assert.equal(f.writes.length,0);
 });
test('an explicitly empty contact tag array removes only owned statuses, even with an empty catalog',async()=>{
 const f=fixture({catalog:catalogPage([]),matches:page([contact([])])});await f.run();
 for(const member of f.members.values())assert.deepEqual(member.tags,tags(MANUAL));
 assert.ok(f.writes.every(w=>w.body.tags.every(t=>t.status==='inactive'&&OWNED.includes(t.name))));
});
test('an empty discovery page is valid and never treats absent contacts as untagged',async()=>{
 const f=fixture({page:()=>({data:[],total:0,next_cursor:null})});const result=await f.run();
 assert.equal(result.cycleComplete,true);assert.equal(result.fullChecked,0);assert.equal(f.writes.length,0);
});
test('malformed discovery page preserves the previously saved cursor',async()=>{
 const f=fixture({page:()=>({})}),key='tag-sync/all-live-recent';
 const state={cursor:'resume',cycleStarted:f.now(),since:f.now()};await f.store.setJSON(key,state);
 await assert.rejects(f.run(),/Incomplete contact page/);assert.deepEqual(await f.store.get(key),state);assert.equal(f.writes.length,0);
});
test('missing Mailchimp members are skipped without import, upsert or subscription changes',async()=>{
 const f=fixture();f.members.clear();const r=await f.run();assert.equal(r.missingMembers,4);assert.equal(f.writes.length,0);
 assert.ok(f.calls.filter(c=>c.url.includes('/members/')).every(c=>c.method==='GET'));
});
test('missing Mailchimp tag arrays abort without removals',async()=>{
 const f=fixture();delete f.members.get(f.keyFor('Agent')).tags;await assert.rejects(f.run(),/Incomplete Mailchimp tags/);assert.equal(f.writes.length,0);
});
for(const status of [401,429,500,503])test(`HTTP ${status} source failure is not an empty read and retries the same queued contact`,async()=>{
 let fail=true;const f=fixture({intercept:(url,request,next)=>fail&&url.includes('email=')?new Response(null,{status}):next()});
 await assert.rejects(f.run(),{status});assert.equal(f.writes.length,0);
 assert.equal((await f.store.get('tag-sync/all-live-recent')).pending.length,1);
 fail=false;await f.run();assert.equal(f.writes.length,2);
});
test('failed Mailchimp GET is retried without assuming an empty member',async()=>{
 let fail=true;const f=fixture({intercept:(url,request,next)=>fail&&url.includes('/members/')?new Response(null,{status:503}):next()});
 await assert.rejects(f.run(),{status:503});assert.equal(f.writes.length,0);fail=false;await f.run();assert.equal(f.writes.length,2);
});
test('failed tag write stays pending and retries after reading current state',async()=>{
 let fail=true;const f=fixture({intercept:(url,request,next)=>fail&&request.method==='POST'?new Response(null,{status:429}):next()});
 await assert.rejects(f.run(),{status:429});assert.equal(f.writes.length,0);
 assert.equal((await f.store.get('tag-sync/all-live-recent')).pending.length,1);fail=false;await f.run();assert.equal(f.writes.length,2);
});
for(const kind of ['timeout-after-apply','invalid-success-json'])test(`uncertain response (${kind}) recovers by re-reading without replaying applied mutations`,async()=>{
 let fail=true;const f=fixture({intercept:async(url,request,next)=>{
  const response=await next();if(fail&&request.method==='POST'){fail=false;if(kind==='timeout-after-apply')throw Error('mock response lost');return new Response('{',{status:200});}return response;
 }});
 await assert.rejects(f.run());assert.equal(f.writes.length,1);
 assert.equal((await f.store.get('tag-sync/all-live-recent')).pending.length,1);
 await f.run();assert.equal(f.writes.length,2);await f.run();assert.equal(f.writes.length,2);
});
test('interruption after writes but before checkpoint recovers without replay or skipping the contact',async()=>{
 let fail=true;const f=fixture({beforeSave:(key,data)=>{
  if(fail&&key==='tag-sync/all-live-recent'&&data.pending?.length===0){fail=false;throw Error('mock checkpoint interruption');}
 }});
 await assert.rejects(f.run(),/checkpoint interruption/);assert.equal(f.writes.length,2);
 assert.equal((await f.store.get('tag-sync/all-live-recent')).pending.length,1);
 await f.run();assert.equal(f.writes.length,2);assert.equal((await f.store.get('tag-sync/all-live-recent')).pending,undefined);
});
test('recent and full scans retain independent cursors, use limit 25 and finish the next page on the next run',async()=>{
 const queries=[];const f=fixture({page:q=>{queries.push(Object.fromEntries(q));return {data:[contact([],{id:q.has('cursor')?'fixture-two':'fixture-one'})],next_cursor:q.has('cursor')?null:'page-2',total:2};}});
 assert.equal((await f.run()).cycleComplete,false);
 for(const pass of ['recent','full'])assert.equal((await f.store.get(`tag-sync/all-live-${pass}`)).cursor,'page-2');
 const result=await f.run();assert.equal(result.cycleComplete,true);assert.equal(result.fullContacts,2);
 assert.deepEqual(queries.map(q=>q.limit),['25','25','25','25']);
 assert.deepEqual(queries.map(q=>q.cursor),[undefined,undefined,'page-2','page-2']);
 assert.ok(queries[0].updated_since);assert.equal(queries[1].updated_since,undefined);
 assert.equal(f.writes.length,2);
});
test('deadline interruption preserves pending page items before advancing its cursor',async()=>{
 let f;f=fixture({page:q=>q.has('cursor')?{data:[contact([],{id:'third'})],next_cursor:null,total:3}:{data:[contact(),contact([],{id:'second'})],next_cursor:'next',total:3},intercept:async(url,request,next)=>{
  if(url.includes('email=')&&f.now()===Date.parse('2026-10-25T12:00:00Z'))f.advance(19000);return next();
 }});
 await f.run();assert.equal((await f.store.get('tag-sync/all-live-recent')).pending.length,2);
 assert.equal((await f.store.get('tag-sync/all-live-recent')).cursor,null);
 await f.run();assert.equal((await f.store.get('tag-sync/all-live-recent')).cursor,'next');
 assert.equal(f.writes.length,2);
});
test('real engine lock prevents concurrent scans and releases after completion',async()=>{
 let release,entered;const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r);let held=false;
 const f=fixture({intercept:async(url,request,next)=>{if(!held&&url.endsWith('/tags')&&request.method==='GET'){held=true;entered();await gate;}return next();}});
 const first=f.run();await ready;await assert.rejects(f.run(),/busy/);release();await first;
 await f.run();assert.equal(f.writes.length,2);
});
test('simultaneous lock acquisition admits one owner via conditional storage writes',async()=>{
 const f=fixture();const results=await Promise.allSettled([f.run(),f.run()]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.writes.length,2);
 assert.match(results.find(r=>r.status==='rejected').reason.message,/busy/);
});
test('an abandoned lock blocks until its existing lease expires, then recovery succeeds',async()=>{
 const f=fixture(),key='locks/'+createHash('sha256').update('hive-tag-reconciliation').digest('hex');
 await f.store.setJSON(key,{owner:'interrupted-owner',until:f.now()+120000});
 await assert.rejects(f.run(),/busy/);assert.equal(f.calls.length,0);
 f.advance(120001);await f.run();assert.equal(f.writes.length,2);assert.equal((await f.store.get(key)).until,0);
});
test('invalid contact emails are skipped without any member request',async()=>{
 const f=fixture({page:()=>page([contact([],{email:''}),contact([],{id:'fixture-two',email:'invalid'})])});await f.run();assert.equal(f.writes.length,0);
 assert.ok(f.calls.every(c=>!c.url.includes('/members/')));
});
test('an understated complete email page fails closed before writes',async()=>{
 const f=fixture({matches:{data:[contact([])],total:2,next_cursor:null}});await assert.rejects(f.run(),/Incomplete email match/);
 assert.equal(f.writes.length,0);assert.equal((await f.store.get('tag-sync/all-live-recent')).pending.length,1);
});
test('inconsistent terminal discovery totals preserve cursor and request an uncompleted restart',async()=>{
 const f=fixture({page:()=>({data:[],total:2,next_cursor:null})});await assert.rejects(f.run(),/inconsistent-terminal-count/);
 const saved=await f.store.get('tag-sync/all-live-recent');assert.equal(saved.cursor,null);assert.ok(saved.restartRequired);
 assert.equal(saved.lastVerifiedCycleComplete,undefined);assert.equal(await f.store.get('tag-sync/last-live'),null);assert.equal(f.writes.length,0);
});
