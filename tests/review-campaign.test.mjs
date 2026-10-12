import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngine} from '../netlify/lib/review-engine.mjs';
import {DAY,eligibleRecipients,referralDates,dueStage} from '../netlify/lib/review-policy.mjs';
import invitation from '../netlify/functions/review-invitation.mjs';
const now=Date.parse('2026-10-12T18:00:00Z');
const inspection={id:'inspection',confirmed:true,ends_at:'2026-10-12T12:00:00Z',price:{paid:true,amount_due:0},agreements:{all_signed:true},reports:{status:'published'},address:{full:'Test address'},contacts:[{id:'client',role:'Customer',first_name:'Alex',email:'alex@example.com'},{id:'agent',role:'Buyer Agent',first_name:'Agent',email:'agent@example.com'}]};
function setup(){
 const entries=new Map(),members=new Map(),calls=[];let seq=0,clock=now;
 const store={async get(k){return structuredClone(entries.get(k)?.data??null);},async getWithMetadata(k){return structuredClone(entries.get(k)??null);},async setJSON(k,data,o={}){const old=entries.get(k);if(o.onlyIfNew&&old||o.onlyIfMatch&&old?.etag!==o.onlyIfMatch)return {modified:false};entries.set(k,{data:structuredClone(data),etag:String(++seq)});return {modified:true};},async *list({prefix}){yield {blobs:[...entries.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key}))};}};
 const fetcher=async(url,options)=>{
  const path=new URL(url).pathname,body=options.body?JSON.parse(options.body):null;calls.push({path,body,method:options.method});
  if(path.includes('/members/')){
   const key=path.replace(/\/tags$/,''),member=members.get(key)||{status:'subscribed',tags:[]};
   if(path.endsWith('/tags'))for(const tag of body.tags){member.tags=member.tags.filter(t=>t.name!==tag.name);if(tag.status==='active')member.tags.push({name:tag.name});}
   if(options.method==='PATCH')member.merge_fields={...member.merge_fields,...body.merge_fields};
   members.set(key,member);return Response.json(member);
  }
  if(path.endsWith('/inspections'))return Response.json({data:[{id:'inspection'}],next_cursor:null});
  if(path.includes('/contacts/'))return Response.json({tags:[{name:'Past Client'}]});
  return Response.json(inspection);
 };
 const engine=createEngine({store,fetcher,now:()=>clock,env:{HIVE_API_KEY:'mock-hive',MAILCHIMP_API_KEY:'mock-us5',REVIEW_ENABLED:'true',REVIEW_START_AFTER:'2026-10-12T00:00:00Z'}});
 return {engine,store,entries,members,calls,advance:days=>clock+=days*DAY};
}
test('unpaid, unsigned, unpublished, canceled, future and deleted inspections cannot enroll',()=>{
 assert.equal(eligibleRecipients(inspection,now).length,2);
 for(const change of [{deleted:true},{canceled_at:'2026-10-12'},{ends_at:'2099-01-01'},{price:{paid:false,amount_due:20}},{agreements:{all_signed:false}},{reports:{status:'pending'}}])assert.equal(eligibleRecipients({...inspection,...change},now).length,0);
});
test('a contact who is both a client and agent is treated only as an agent',()=>{
 const rows=eligibleRecipients({...inspection,contacts:[...inspection.contacts,{id:'dual',role:'Customer',first_name:'Dual',email:'AGENT@example.com'}]},now);
 assert.equal(rows.filter(r=>r.email==='agent@example.com').length,1);assert.equal(rows.find(r=>r.email==='agent@example.com').role,'Agent');
});
test('repeated inspection events cannot create duplicate requests or initial sends',async()=>{
 const {engine,entries,calls}=setup();await engine.enroll(inspection);await engine.enroll(inspection);
 const rows=[...entries].filter(([k])=>k.startsWith('requests/')).map(([,v])=>v.data);assert.equal(rows.length,2);
 await engine.process(rows[0].token);await engine.process(rows[0].token);
 assert.equal(calls.filter(c=>c.body?.tags?.some(t=>t.name==='REVIEW:PENDING'&&t.status==='active')).length,1);
});
test('feedback stops reminders, marks feedback rather than Google verification, and schedules client invitation',async()=>{
 const {engine,entries,calls,advance}=setup();await engine.enroll(inspection);
 const row=[...entries.values()].find(v=>v.data.role==='Customer').data;
 await engine.process(row.token);await engine.feedback(row.token,{rating:2,feedback:'Thank you'});advance(7);await engine.process(row.token);
 const tags=calls.flatMap(c=>c.body?.tags||[]);assert(tags.some(t=>t.name==='feedback received'&&t.status==='active'));assert(!tags.some(t=>t.name==='google reviewed'&&t.status==='active'));
 assert(calls.some(c=>c.body?.merge_fields?.REVREF2==='10/14/2026'));
 assert.equal(calls.filter(c=>c.body?.tags?.some(t=>t.name==='REVIEW:PENDING'&&t.status==='active')).length,1);
});
test('agent feedback never writes referral dates',async()=>{
 const {engine,entries,calls}=setup();await engine.enroll(inspection);const row=[...entries.values()].find(v=>v.data.role==='Agent').data;
 await engine.feedback(row.token,{rating:5,feedback:''});assert(!calls.some(c=>c.body?.merge_fields?.REVREF2));
});
test('unanswered requests expire and schedule client referral two days later',async()=>{
 const {engine,entries,calls,advance}=setup();await engine.enroll(inspection);const row=[...entries.values()].find(v=>v.data.role==='Customer').data;
 advance(15);await engine.process(row.token);assert(calls.some(c=>c.body?.merge_fields?.REVREF2==='10/28/2026'));assert((await engine.get(row.token)).finishSynced);
});
test('reminder due policy skips catch-up bursts and clamps six-month calendar dates',()=>{
 const row={createdAt:now,expiresAt:now+14*DAY,sentStages:[]};assert.equal(dueStage(row,now+8*DAY),2);assert.equal(dueStage({...row,sentStages:[0,1,2]},now+8*DAY),null);
 assert.deepEqual(referralDates(Date.parse('2026-08-29T18:00:00Z')),{REVREF2:'08/31/2026',REVREF6:'02/28/2027'});
});
test('paused engine cannot enroll existing clients',async()=>{
 const {store}=setup();const engine=createEngine({store,env:{REVIEW_ENABLED:'false'},fetcher:()=>{throw Error('Unexpected API call');}});
 assert.deepEqual(await engine.enroll(inspection),{paused:true});assert.deepEqual(await engine.run(),{paused:true});
});
test('confirmed Google review adds Hive tag without removing existing tags and prevents double attribution',async()=>{
 const {engine,entries,calls}=setup();await engine.enroll(inspection);const rows=[...entries.values()].filter(v=>v.data.role).map(v=>v.data);
 await engine.confirmGoogle(rows[0].token,{reviewId:'google-1',starRating:'FIVE'});
 const patch=calls.find(c=>c.path.includes('/contacts/')&&c.method==='PATCH');assert.deepEqual(patch.body.tags,['Past Client','Google Reviewed']);
 assert(calls.some(c=>c.body?.tags?.some(t=>t.name==='google reviewed'&&t.status==='active')));
 await assert.rejects(()=>engine.confirmGoogle(rows[1].token,{reviewId:'google-1'}),/already assigned/);
});
test('existing Mailchimp star URLs retain both token and selected rating',async()=>{
 const token='a'.repeat(48),result=await invitation(new Request('https://www.insites.services/review/r/'+token+'?rating=4'));
 const target=new URL(result.headers.get('location'),'https://www.insites.services');assert.equal(target.searchParams.get('token'),token);assert.equal(target.searchParams.get('rating'),'4');
 assert.equal((await invitation(new Request('https://www.insites.services/review/r/invalid?rating=5'))).status,400);
});
