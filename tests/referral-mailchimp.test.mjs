import test from 'node:test';import assert from 'node:assert/strict';
import {referralDates,referralOwners,syncOwner,syncReferrals,mailchimpClient,REFERRAL_TAG} from '../netlify/lib/referral-mailchimp.mjs';
const owner={Code:'INS25ABCDEFG','Referrer Email':' ALEX@example.com ','Referrer Name':'Alex Test','Assigned At':'2026-10-04T23:55:00Z','Assignment State':'ASSIGNED','Hive State':'VERIFIED'};
const now=new Date('2026-10-05T00:00:00Z');
test('dates use the original New York calendar date and clamp six-month month ends',()=>{
 assert.deepEqual(referralDates(owner['Assigned At']),{REF2DAY:'10/06/2026',REFSIX:'04/04/2027'});
 assert.deepEqual(referralDates('2026-09-01T01:00:00Z'),{REF2DAY:'09/02/2026',REFSIX:'02/28/2027'});
});
test('only the oldest verified assigned code per owner is used; legacy opt-outs remain suppressed',()=>{
 const rows=[owner,{...owner,Code:'INS25HJKLMNP','Assigned At':'2026-10-05T01:00:00Z'}];
 assert.equal(referralOwners({codes:rows}).length,1);assert.equal(referralOwners({codes:rows})[0].Code,owner.Code);
 assert.equal(referralOwners({codes:[...rows,{...owner,'Email Unsubscribed At':'2026-10-05'}]}).length,0);
});
test('new contacts receive referral-only fields and tag without changing existing audience status',async()=>{
 const calls=[];await syncOwner(owner,{now,request:async(method,path,body)=>{calls.push({method,path,body});return method==='GET'?null:{status:'subscribed'};}});
 const put=calls.find(c=>c.method==='PUT');assert.equal(put.body.status,undefined);assert.equal(put.body.status_if_new,'subscribed');assert.equal(put.body.email_address,'alex@example.com');assert.equal(put.body.merge_fields.REFCODE,owner.Code);assert.equal(put.body.merge_fields.REF2DAY,'10/06/2026');assert.equal(put.body.merge_fields.FNAME,undefined);
 assert.deepEqual(calls.at(-1).body,{tags:[{name:REFERRAL_TAG,status:'active'}]});
});
test('unsubscribed, cleaned, pending and archived contacts never get resubscribed',async()=>{
 for(const status of ['unsubscribed','cleaned','pending','archived','transactional']){let writes=0;const result=await syncOwner(owner,{now,request:async method=>{if(method!=='GET')writes++;return {status};}});assert.equal(result.status,'suppressed');assert.equal(writes,0);}
});
test('repeat syncs preserve original dates and do not re-add the tag',async()=>{
 const member={status:'subscribed',merge_fields:{REFCODE:owner.Code,REFNAME:'Alex',REF2DAY:'2026-10-06',REFSIX:'2027-04-04'},tags:[{name:REFERRAL_TAG}]};let writes=0;
 const result=await syncOwner({...owner,'Assigned At':'2026-11-20T16:00:00Z'},{now,member,request:async()=>{writes++;}});assert.equal(result.status,'unchanged');assert.equal(writes,0);
});
test('a conflicting saved code is held for review, and a concurrent opt-out is respected',async()=>{
 assert.equal((await syncOwner(owner,{now,member:{status:'subscribed',merge_fields:{REFCODE:'INS25HJKLMNP'}},request:async()=>assert.fail()})).status,'review');
 const calls=[];const result=await syncOwner(owner,{now,member:null,request:async(method)=>{calls.push(method);return {status:'unsubscribed'};}});assert.equal(result.status,'suppressed');assert.deepEqual(calls,['PUT']);
});
test('overdue and previously sent stages are not backfilled',async()=>{
 let body;await syncOwner({...owner,'2-Day Email State':'SENT'},{now,member:null,request:async(method,path,b)=>{if(method==='PUT')body=b;return {status:'subscribed'};}});assert.equal(body.merge_fields.REF2DAY,undefined);assert.ok(body.merge_fields.REFSIX);
 await syncOwner(owner,{now:new Date('2027-04-10'),member:null,request:async(method,path,b)=>{if(method==='PUT')body=b;return {status:'subscribed'};}});assert.equal(body.merge_fields.REF2DAY,undefined);assert.equal(body.merge_fields.REFSIX,undefined);
});
test('disabled synchronization does not access either provider',async()=>{assert.deepEqual(await syncReferrals({env:{},callLedger:()=>assert.fail(),request:()=>assert.fail()}),{enabled:false});});
test('Mailchimp errors cannot masquerade as a missing contact',async()=>{
 const api=mailchimpClient({MAILCHIMP_API_KEY:'test-us5',MAILCHIMP_REFERRAL_AUDIENCE_ID:'3ebb3017d4'},async()=>new Response('{}',{status:503}));await assert.rejects(()=>api('GET','/members/hash'));
});
test('worker does not enroll existing untagged agents and limits each batch',async()=>{
 const codes=Array.from({length:4},(_,i)=>({...owner,'Referrer Email':`ref${i}@example.com`,Code:`INS25ABCDE${i+2}G`}));let puts=0;
 const result=await syncReferrals({env:{REFERRAL_MAILCHIMP_ENABLED:'true'},now,callLedger:async()=>({codes}),request:async(method,path)=>{if(method==='GET')return {total_items:1,members:[{email_address:'agent@example.com',status:'subscribed',merge_fields:{}}]};if(method==='PUT')puts++;return {status:'subscribed'};}});
 assert.equal(puts,3);assert.equal(result.synced,3);
});
test('contact capacity holds new contacts without purchasing an overage',async()=>{
 let writes=0;await assert.rejects(()=>syncReferrals({env:{REFERRAL_MAILCHIMP_ENABLED:'true',MAILCHIMP_CONTACT_LIMIT:'1'},now,callLedger:async()=>({codes:[owner]}),request:async(method)=>{if(method==='GET')return {total_items:1,members:[{email_address:'agent@example.com',status:'subscribed',merge_fields:{}}]};writes++;return {};}}),/capacity/);assert.equal(writes,0);
});
