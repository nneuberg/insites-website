import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {REMOVABLE_HIVE_TAGS,tagChanges,reconcileHiveTags} from '../netlify/lib/hive-tag-sync.mjs';
import {createEngine} from '../netlify/lib/review-engine.mjs';
import {AUDIENCES} from '../netlify/lib/review-policy.mjs';

const OWNED=[
 '1st time buying agent','new selling agent','repeat selling agent',
 'absent selling agent','absent buying agent','repeat buying agent',
 'super buying agent','vip buying agent','no business'
];
const MANUAL=['google reviewed','REVIEW:PENDING','REVIEW:COMPLETE','REF:CODE-OWNER',
 'REF:QA','feedback received','photo client','PHOTO:DELIVERED','campaign october',
 'CAMPAIGN:PAUSED','SUPPRESS:EMAIL','do not email','manual VIP','Past Client',
 'first time buying agent','vip buying agents','no business:manual'];
const norm=s=>s.trim().toLowerCase();
const tags=names=>names.map(name=>({name}));
const contact=(names=[],extra={})=>({id:'fixture-one',email:'fixture@example.invalid',tags:tags(names),...extra});
const inactive=names=>names.map(name=>({name,status:'inactive'}));
const active=names=>names.map(name=>({name,status:'active'}));

// No provider SDK or network is used. Even createEngine's HTTP calls terminate
// in this injected fetcher with fake credentials and reserved-domain contacts.
function fixture(options={}){
 const entries=new Map(),members=new Map(),calls=[],writes=[];
 let sequence=0,clock=Date.parse('2026-10-25T12:00:00Z');
 const store={
  async get(key){return structuredClone(entries.get(key)?.data??null);},
  async getWithMetadata(key){return structuredClone(entries.get(key)??null);},
  async setJSON(key,data,condition={}){
   await options.beforeSave?.(key,data);
   const old=entries.get(key);
   if(condition.onlyIfNew&&old||condition.onlyIfMatch&&old?.etag!==condition.onlyIfMatch)return {modified:false};
   entries.set(key,{data:structuredClone(data),etag:String(++sequence)});return {modified:true};
  }
 };
 const keyFor=(role,email='fixture@example.invalid')=>`/3.0/lists/${AUDIENCES[role]}/members/${createHash('md5').update(email).digest('hex')}`;
 for(const role of ['Agent','Customer'])members.set(keyFor(role),{
  status:role==='Agent'?'unsubscribed':'transactional',email_address:'fixture@example.invalid',
  merge_fields:{FNAME:'Fixture',REVLINK:'',REFDATE:'',HISTORY:'retain'},
  tags:tags(options.memberTags??['no business',...MANUAL])
 });
 async function route(url,request){
  const u=new URL(url);
  if(u.hostname==='api.hiveinspect.com'){
   assert.equal(request.method,'GET','sync never writes Hive');
   if(u.pathname==='/v1/tags')return Response.json(options.catalog??{data:tags([...OWNED,...MANUAL])});
   assert.equal(u.pathname,'/v1/contacts');
   if(u.searchParams.has('email'))return Response.json(options.matches??{data:[contact(options.hiveTags??['repeat buying agent'])]});
   return Response.json(options.page?await options.page(u.searchParams):{data:[contact()],next_cursor:null,total:1});
  }
  assert.equal(u.hostname,'us5.api.mailchimp.com','unexpected service');
  const key=u.pathname.replace(/\/tags$/,''),member=members.get(key);
  if(!member)return new Response(null,{status:404});
  if(request.method==='GET')return Response.json(member);
  assert.equal(request.method,'POST');assert.ok(u.pathname.endsWith('/tags'));
  const body=JSON.parse(request.body);assert.deepEqual(Object.keys(body),['tags']);
  writes.push({key,body:structuredClone(body)});
  for(const change of body.tags){
   assert.ok(['active','inactive'].includes(change.status));
   member.tags=member.tags.filter(t=>norm(t.name)!==norm(change.name));
   if(change.status==='active')member.tags.push({name:change.name});
  }
  return new Response(null,{status:204});
 }
 const engine=createEngine({store,now:()=>clock,env:{HIVE_API_KEY:'mock',MAILCHIMP_API_KEY:'mock-us5'},fetcher:async(url,request)=>{
  calls.push({url,method:request.method,body:request.body});
  return options.intercept?options.intercept(url,request,()=>route(url,request)):route(url,request);
 }});
 return {store,engine,entries,members,calls,writes,keyFor,now:()=>clock,advance:ms=>clock+=ms,
  run:(extra={})=>reconcileHiveTags({engine,store,now:()=>clock,apply:true,...extra})};
}

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
 const f=fixture({matches:{data:[contact(['no business']),contact(['repeat buying agent'],{id:'fixture-two',email:' FIXTURE@EXAMPLE.INVALID '})]}});
 await f.run();for(const member of f.members.values())assert.ok(member.tags.some(t=>t.name==='no business'));
 assert.ok(f.writes.every(w=>w.body.tags.every(t=>t.status==='active')));
});
for(const [name,matches] of Object.entries({
 missing:{},nullData:{data:null},empty:{data:[]},paginated:{data:[contact()],next_cursor:'more'},
 missingTags:{data:[{email:'fixture@example.invalid'}]},nullTags:{data:[contact(),contact([],{tags:null})]},
 wrongEmail:{data:[contact([],{email:'another@example.invalid'})]},invalidName:{data:[contact([],{tags:[{}]})]}
}))test(`incomplete email lookup (${name}) fails closed and keeps contact queued`,async()=>{
 const f=fixture({matches});await assert.rejects(f.run());assert.equal(f.writes.length,0);
 assert.equal((await f.store.get('tag-sync/all-live-recent')).pending.length,1);
});
for(const [name,catalog] of Object.entries({missing:{},nullData:{data:null},paginated:{data:tags(OWNED),next_cursor:'more'},invalidName:{data:[{name:' '}]}}))
 test(`incomplete catalog (${name}) aborts before contact or member reads`,async()=>{
  const f=fixture({catalog});await assert.rejects(f.run());assert.equal(f.calls.length,1);assert.equal(f.writes.length,0);
 });
test('an explicitly empty contact tag array removes only owned statuses, even with an empty catalog',async()=>{
 const f=fixture({catalog:{data:[]},matches:{data:[contact([])]}});await f.run();
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
 const queries=[];const f=fixture({page:q=>{queries.push(Object.fromEntries(q));return {data:[contact()],next_cursor:q.has('cursor')?null:'page-2',total:2};}});
 assert.equal((await f.run()).cycleComplete,false);
 for(const pass of ['recent','full'])assert.equal((await f.store.get(`tag-sync/all-live-${pass}`)).cursor,'page-2');
 const result=await f.run();assert.equal(result.cycleComplete,true);assert.equal(result.fullContacts,2);
 assert.deepEqual(queries.map(q=>q.limit),['25','25','25','25']);
 assert.deepEqual(queries.map(q=>q.cursor),[undefined,undefined,'page-2','page-2']);
 assert.ok(queries[0].updated_since);assert.equal(queries[1].updated_since,undefined);
 assert.equal(f.writes.length,2);
});
test('deadline interruption preserves pending page items before advancing its cursor',async()=>{
 let f;f=fixture({page:()=>({data:[contact(),contact([],{id:'second'})],next_cursor:'next',total:3}),intercept:async(url,request,next)=>{
  if(url.includes('email='))f.advance(19000);return next();
 }});
 await f.run();assert.equal((await f.store.get('tag-sync/all-live-recent')).pending.length,1);
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
 const f=fixture({page:()=>({data:[contact([],{email:''}),contact([],{email:'invalid'})]})});await f.run();assert.equal(f.writes.length,0);
 assert.ok(f.calls.every(c=>!c.url.includes('/members/')));
});
test('known source-completeness limit: an understated email page without a cursor is currently trusted',async()=>{
 // Characterization of an existing gap, NOT a completeness guarantee. A missing
 // duplicate might hold the status removed here. The ownership fix still protects
 // all non-owned tags. A separate source-validation change is needed for totals.
 const f=fixture({matches:{data:[contact([])],total:2,next_cursor:null}});await f.run();
 assert.equal(f.writes.length,2);for(const member of f.members.values())assert.deepEqual(member.tags,tags(MANUAL));
});
test('known pagination limit: inconsistent discovery total without a cursor is currently marked complete',async()=>{
 const f=fixture({page:()=>({data:[],total:2,next_cursor:null})});const result=await f.run();
 assert.equal(result.cycleComplete,true);assert.equal(result.fullChecked,0);assert.equal(f.writes.length,0);
});
