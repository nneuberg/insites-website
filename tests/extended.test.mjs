import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,inspection,now} from './harness.mjs';
import {googleSync} from '../netlify/lib/review-google.mjs';
import {createEngine} from '../netlify/lib/review-engine.mjs';
import {DAY} from '../netlify/lib/review-policy.mjs';
globalThis.fetch=()=>{throw Error('Real network prohibited in isolated tests');};
const rows=s=>[...s.entries].filter(([k])=>k.startsWith('requests/')).map(([,v])=>v.data);
const sends=s=>s.calls.filter(c=>c.body?.tags?.some(t=>t.name==='REVIEW:PENDING'&&t.status==='active'));
const customer=s=>rows(s).find(r=>r.role==='Customer');
test('test feedback is saved without any Mailchimp or Hive calls',async()=>{
 const s=setup();await s.engine.enroll(inspection);const r=customer(s);r.isTest=true;await s.engine.save(r);
 const before=s.calls.length;await s.engine.feedback(r.token,{rating:5,feedback:'isolated fixture'});
 assert.equal(s.calls.length,before);assert.equal((await s.engine.get(r.token)).rating,5);
 assert.equal((await s.engine.get(r.token)).finishSynced,true);
});
test('paused production feedback rejects before changing records or calling providers',async()=>{
 const s=setup();await s.engine.enroll(inspection);const r=customer(s);let writes=0;
 const paused=createEngine({store:s.store,env:{REVIEW_ENABLED:'false',MAILCHIMP_API_KEY:'fixture-us5'},now:()=>now,
 fetcher:async(_u,o)=>{if(o.method!=='GET')writes++;return Response.json({});}});
 await assert.rejects(()=>paused.feedback(r.token,{rating:5,feedback:'isolated fixture'}),/paused/);
 assert.equal(writes,0);assert(!(await s.engine.get(r.token)).ratedAt);
});
for(const role of ['Customer','Agent'])test(role+' confirmation writes exact Hive and Mailchimp tags once and preserves identity',async()=>{
 const s=setup();await s.engine.enroll(inspection);const r=rows(s).find(r=>r.role===role);
 await s.engine.confirmGoogle(r.token,{reviewId:'verified-'+role});await s.engine.confirmGoogle(r.token,{reviewId:'verified-'+role});
 const tags=s.calls.filter(c=>c.path.includes('/contacts/')&&c.method==='PATCH');
 assert(tags.every(c=>c.path.endsWith('/'+r.contactId)));
 assert(tags.every(c=>c.body.tags.includes('Past Client')&&c.body.tags.includes('google reviewed')));
 const mc=s.calls.filter(c=>c.body?.tags?.some(t=>t.name==='google reviewed'&&t.status==='active'));
 assert(mc.length>0);assert(mc.every(c=>c.path.includes(role==='Customer'?'8f8749ba24':'3ebb3017d4')));
 assert.equal([...s.entries].filter(([k])=>k.startsWith('confirmed/')).length,1);
 assert.equal((await s.engine.get(r.token)).googleReviewId,'verified-'+role);
});
test('full fake scan enrolls two roles; reminders occur only on days 0, 3, 7 and expire on 14',async()=>{
 const s=setup(); await s.engine.run(); assert.equal(rows(s).length,2); assert.equal(sends(s).length,2);
 await s.engine.run(); assert.equal(sends(s).length,2); s.advance(2); await s.engine.run(); assert.equal(sends(s).length,2);
 s.advance(1); await s.engine.run(); assert.equal(sends(s).length,4);s.advance(4);await s.engine.run();assert.equal(sends(s).length,6);
 s.advance(7);await s.engine.run();assert.equal(sends(s).length,6);assert(rows(s).every(r=>r.endedAt&&r.finishSynced));
});
test('unsubscribed member stops subsequent reminders without triggering new mail',async()=>{
 const s=setup();await s.engine.enroll(inspection);const r=customer(s);await s.engine.process(r.token);
 for(const m of s.members.values())m.status='unsubscribed';s.advance(3);await s.engine.process(r.token);
 assert.equal(sends(s).length,1);assert.equal((await s.engine.get(r.token)).suppressed,true);
});
test('missing Mailchimp member is skipped rather than subscribed',async()=>{
 const s=setup({intercept:(u,o,next)=>u.includes('/members/')?new Response('{}',{status:404}):next(u,o)});
 await s.engine.enroll(inspection);assert.equal(rows(s).length,0);
});
test('Mailchimp Google reviewed tag stops the next reminder',async()=>{
 const s=setup();await s.engine.enroll(inspection);const r=customer(s);await s.engine.process(r.token);
 for(const m of s.members.values())m.tags.push({name:'google reviewed'});s.advance(3);await s.engine.process(r.token);
 assert.equal(sends(s).length,1);assert((await s.engine.get(r.token)).googleReviewedAt);
});
test('identical feedback is idempotent; edits require the current revision',async()=>{
 const s=setup();await s.engine.enroll(inspection);const r=customer(s);
 await s.engine.feedback(r.token,{rating:1,feedback:'fixture'});const count=s.calls.length;
 await s.engine.feedback(r.token,{rating:1,feedback:'fixture'});assert.equal(s.calls.length,count);
 await assert.rejects(()=>s.engine.feedback(r.token,{rating:5,feedback:''}),/Reload/);
});
test('invalid feedback does not stop or alter a request',async()=>{
 const s=setup();await s.engine.enroll(inspection);const r=customer(s);
 for(const rating of [0,6,1.5])await assert.rejects(()=>s.engine.feedback(r.token,{rating,feedback:''}),/Invalid feedback/);
 assert(!(await s.engine.get(r.token)).endedAt);
});
test('Mailchimp ambiguous successful tag addition is reconciled without a duplicate trigger',async()=>{
 let fail=true;
 const s=setup({intercept:async(u,o,next)=>{const r=await next(u,o);if(fail&&o.body&&JSON.parse(o.body).tags?.some(t=>t.name==='REVIEW:PENDING'&&t.status==='active')){fail=false;throw Error('Simulated lost response');}return r;}});
 await s.engine.enroll(inspection);const r=customer(s);await assert.rejects(()=>s.engine.process(r.token));
 await s.engine.process(r.token);assert.equal(sends(s).length,1);assert.deepEqual((await s.engine.get(r.token)).sentStages,[0]);
});
test('merge-field failure leaves a retryable request and no mail trigger',async()=>{
 let fail=true;const s=setup({intercept:(u,o,next)=>{if(fail&&o.method==='PATCH'&&o.body?.includes('REVLINK')){fail=false;return new Response('{}',{status:503});}return next(u,o);}});
 await s.engine.enroll(inspection);const r=customer(s);await assert.rejects(()=>s.engine.process(r.token));assert.equal(sends(s).length,0);
 await s.engine.process(r.token);assert.equal(sends(s).length,1);
});
test('test-marked active request never triggers review mail',async()=>{
 const s=setup();await s.engine.enroll(inspection);const r=customer(s);r.isTest=true;await s.engine.save(r);
 await s.engine.process(r.token);assert.equal(sends(s).length,0);
});
const googleEnv={REVIEW_ENABLED:'true',GOOGLE_REVIEW_CLIENT_ID:'fixture',GOOGLE_REVIEW_CLIENT_SECRET:'fixture',GOOGLE_REVIEW_REFRESH_TOKEN:'fixture',GOOGLE_REVIEW_LOCATION:'accounts/fixture/locations/fixture',RESEND_API_KEY:'fixture'};
const review={reviewId:'fixture-review',createTime:new Date(now+1000).toISOString(),starRating:'FIVE',reviewer:{displayName:'<script>fixture</script>'},comment:'<img src=x>'};
function google(s,{data={reviews:[review]},failAt='',clock=now+2000}={}){
 const calls=[];const sync=googleSync({store:s.store,engine:s.engine,env:googleEnv,now:()=>clock,fetcher:async(u,o)=>{
 calls.push({u,o});if(failAt&&u.includes(failAt))return new Response('{}',{status:503});
 if(u.includes('oauth2'))return Response.json({access_token:'fake-access'});
 if(u.includes('mybusiness.googleapis'))return Response.json(data);
 if(u==='https://api.resend.com/emails')return Response.json({id:'fixture'});
 throw Error('Unexpected mocked destination');
 }});return {sync,calls};
}
test('first Google sync establishes isolated baseline and sends no match notices',async()=>{
 const s=setup();await s.engine.enroll(inspection);const g=google(s);assert.deepEqual(await g.sync.run(),{baselineCreated:true});
 assert(!g.calls.some(c=>c.u.includes('resend')));assert(await s.store.get('google-baseline'));
});
test('Google notice renders escaped content, uses safe links, and is deduplicated',async()=>{
 const s=setup();await s.engine.enroll(inspection);await s.store.setJSON('google-baseline',{since:now});
 const g=google(s);assert.deepEqual(await g.sync.run(),{notified:1});assert.deepEqual(await g.sync.run(),{notified:0});
 const mails=g.calls.filter(c=>c.u.includes('resend'));assert.equal(mails.length,1);const mail=JSON.parse(mails[0].o.body);
 assert.deepEqual(mail.to,['neal@insites.services']);assert(!mail.html.includes('<script>'));assert(!mail.html.includes('<img src=x>'));
 assert(mail.html.includes('&lt;script&gt;'));assert(mail.html.includes('https://www.insites.services/review-match/?token='));
 const matches=[...s.entries].filter(([k])=>k.startsWith('matches/'));assert.equal(matches.length,2);
 await s.engine.confirmGoogle(customer(s).token,review);s.advance(7);await s.engine.process(customer(s).token);assert.equal(sends(s).length,0);
});
test('old Google reviews and test records produce no match notices',async()=>{
 const s=setup();await s.engine.enroll(inspection);await s.store.setJSON('google-baseline',{since:now+5000});
 assert.deepEqual(await google(s).sync.run(),{notified:0});
 await s.store.setJSON('google-baseline',{since:now});for(const r of rows(s)){r.isTest=true;await s.engine.save(r);}
 assert.deepEqual(await google(s).sync.run(),{notified:0});
});
test('Google authorization failure writes no baseline and sends no email',async()=>{
 const s=setup();const g=google(s,{failAt:'oauth2'});await assert.rejects(()=>g.sync.run());assert.equal(s.entries.size,0);assert.equal(g.calls.length,1);
});
test('failed match email remains retryable and reuses idempotency key',async()=>{
 const s=setup();await s.engine.enroll(inspection);await s.store.setJSON('google-baseline',{since:now});
 const a=google(s,{failAt:'resend'});await assert.rejects(()=>a.sync.run());
 const b=google(s);await b.sync.run();assert.equal(a.calls.at(-1).o.headers['Idempotency-Key'],b.calls.at(-1).o.headers['Idempotency-Key']);
});
test('Google sync requests only the latest 50 by update time and ignores additional pages',async()=>{
 const s=setup();await s.engine.enroll(inspection);await s.store.setJSON('google-baseline',{since:now});
 const old={...review,createTime:new Date(now-DAY).toISOString()};
 const g=google(s,{data:{reviews:Array.from({length:50},(_,i)=>({...old,reviewId:'old-'+i})),nextPageToken:'page-2',totalReviewCount:362}});
 assert.deepEqual(await g.sync.run(),{notified:0});
 const requests=g.calls.filter(c=>c.u.includes('mybusiness.googleapis'));assert.equal(requests.length,1);
 const query=new URL(requests[0].u).searchParams;
 assert.equal(query.get('pageSize'),'50');assert.equal(query.get('orderBy'),'updateTime desc');assert.equal(query.has('pageToken'),false);
});
test('duplicate review within the first page generates only one notice',async()=>{
 const s=setup();await s.engine.enroll(inspection);await s.store.setJSON('google-baseline',{since:now});
 const g=google(s,{data:{reviews:[review,review],nextPageToken:'unused'}});
 assert.deepEqual(await g.sync.run(),{notified:1});assert.equal(g.calls.filter(c=>c.u.includes('resend')).length,1);
 assert.equal(g.calls.filter(c=>c.u.includes('mybusiness.googleapis')).length,1);
});
test('expired test request never performs finish side effects',async()=>{
 const s=setup();await s.engine.enroll(inspection);const r=customer(s);r.isTest=true;await s.engine.save(r);s.advance(15);
 const before=s.calls.length;await s.engine.process(r.token);assert.equal(s.calls.length,before);
});
test('test feedback works while globally paused, with no external calls',async()=>{
 const s=setup();await s.engine.enroll(inspection);const r=customer(s);r.isTest=true;await s.engine.save(r);
 const paused=createEngine({store:s.store,env:{REVIEW_ENABLED:'false'},now:()=>now,fetcher:()=>{throw Error('Unexpected provider call');}});
 assert.deepEqual(await paused.feedback(r.token,{rating:2,feedback:'fixture'}),{saved:true});
});
test('paused direct processing and confirmation cannot mutate provider tags',async()=>{
 const s=setup();await s.engine.enroll(inspection);const r=customer(s);let calls=0;
 const paused=createEngine({store:s.store,env:{REVIEW_ENABLED:'false'},now:()=>now,fetcher:()=>{calls++;throw Error('Unexpected');}});
 await paused.process(r.token);await assert.rejects(()=>paused.confirmGoogle(r.token,review),/paused/);
 assert.equal(calls,0);assert(!(await s.engine.get(r.token)).googleReviewedAt);
});
