import test from 'node:test';import assert from 'node:assert/strict';import {createHmac} from 'node:crypto';
import {inspectionFacts,matchReferral,auditReferrals,verifyHive,hiveReader} from '../netlify/lib/referral-hive.mjs';
import {createHiveWebhook} from '../netlify/functions/referral-hive-webhook.mjs';
const now=Date.parse('2026-10-19T20:00:00Z');
const base={id:'inspection-1',status:'confirmed',confirmed:true,canceled_at:null,deleted:false,created_at:'2026-10-05T20:00:00Z',ends_at:'2026-10-06T20:00:00Z',reports:{status:'published'},services:[{id:'full'}],contacts:[{id:'client-1',role:'Customer',email:'friend@example.com'}],price:{paid:true,payment_status:'paid',amount_due:0,amount_paid:400},discount_codes:[{code:'INS25ABCDEFG'}]};
const snapshot={codes:[{Code:'INS25ABCDEFG','Assignment State':'ASSIGNED','Hive State':'VERIFIED','Assigned At':'2026-10-04T20:00:00Z','Referrer Email':'owner@example.com'}],uses:[]};
test('matches exact owned code but missing history/refund evidence never authorizes reward',()=>{const r=matchReferral(base,snapshot,{now,serviceIds:['full']});assert(r.matched);assert.equal(r.rewardReady,false);assert.equal(r.facts.paid,true);assert.equal(r.facts.completed,true);assert.equal(r.facts.completedAt,new Date(now).toISOString());assert.equal(r.facts.refunded,null);assert.equal(r.facts.newClient,null);});
test('a 25 dollar discount alone cannot attribute an owner',()=>assert.equal(matchReferral({...base,discount_codes:[]},snapshot).matched,false));
test('ambiguous owners and removed code invalidate earlier attribution',()=>{const s=structuredClone(snapshot);s.uses=[{'Hive Inspection ID':base.id}];assert.match(matchReferral({...base,discount_codes:[]},s).hold,/removed/);s.codes.push({...s.codes[0]});assert.match(matchReferral(base,s).hold,/ambiguous/);});
for(const [label,patch] of [['partial',{amount_due:1}],['contradictory',{payment_status:'pending'}],['string amount',{amount_due:'0'}],['waived',{amount_paid:0}],['unknown',{paid:undefined}]])test(label+' payment is not cleared',()=>assert.equal(inspectionFacts({...base,price:{...base.price,...patch}}).paid,false));
test('unknown services, canceled jobs, multiple customers and self referrals stay held',()=>{assert.equal(inspectionFacts(base).fullInspection,null);assert.equal(inspectionFacts({...base,deleted:true}).canceled,true);assert.equal(inspectionFacts({...base,contacts:[...base.contacts,...base.contacts]}).clientId,null);assert(matchReferral({...base,contacts:[{...base.contacts[0],email:'OWNER@example.com'}]},snapshot).holds.includes('Self referral'));});
test('cursor pagination reads each inspection once and reports incomplete bounds',async()=>{const paths=[];const read=async p=>{paths.push(p);if(p.startsWith('inspections?'))return p.includes('cursor=next')?{data:[{id:'inspection-2'}],next_cursor:null}:{data:[{id:base.id}],next_cursor:'next'};return {...base,id:p.split('/')[1]};};const full=await auditReferrals({read,snapshot,maxPages:2});assert.equal(full.read,2);assert(full.complete);const limited=await auditReferrals({read,snapshot,maxPages:1});assert.equal(limited.complete,false);assert.equal(limited.nextCursor,'next');});
test('Hive errors and malformed lists fail rather than reporting no referrals',async()=>{await assert.rejects(auditReferrals({snapshot,read:async()=>({})}));await assert.rejects(hiveReader({HIVE_API_KEY:'synthetic'},async()=>new Response('',{status:401}))('inspections?limit=1'));});
const secret='synthetic-test-secret';const event={id:'evt_one',event:'inspection.published',api_version:'v1',organization:{id:'org-test'},data:{inspection:{id:base.id}}};
function signed(e=event,time=now/1000){const raw=JSON.stringify(e),signature=createHmac('sha256',secret).update(time+'.'+raw).digest('hex');return new Request('https://example.com/hook',{method:'POST',headers:{'x-hiveinspect-signature':`t=${time},v1=${signature}`},body:raw});}
function handler(overrides={}){const jobs=new Map();return {jobs,run:createHiveWebhook({env:{REFERRAL_HIVE_WEBHOOK_ENABLED:'true',REFERRAL_HIVE_WEBHOOK_SECRET:secret,HIVE_ORGANIZATION_ID:'org-test'},now:()=>now,enqueue:async(k,v)=>{if(!jobs.has(k))jobs.set(k,v);},...overrides})};}
test('valid duplicate webhooks queue one minimal event without customer data',async()=>{const h=handler();assert.equal((await h.run(signed())).status,202);assert.equal((await h.run(signed())).status,202);assert.equal(h.jobs.size,1);assert.deepEqual(Object.keys([...h.jobs.values()][0]).sort(),['event','eventId','inspectionId','receivedAt']);});
test('expired, future and tampered signatures never enqueue',async()=>{const h=handler();for(const t of [now/1000-301,now/1000+301])assert.equal((await h.run(signed(event,t))).status,401);assert.equal(h.jobs.size,0);const req=signed();const raw=await req.text();assert.throws(()=>verifyHive(raw+' ',req.headers,secret,now));});
test('foreign organization, test notifications and contact events cannot queue inspection rewards',async()=>{const h=handler();assert.equal((await h.run(signed({...event,organization:{id:'other'}}))).status,403);assert.equal((await h.run(signed({...event,test:true}))).status,204);assert.equal((await h.run(signed({...event,event:'contact.updated'}))).status,204);assert.equal(h.jobs.size,0);});
test('missing secret and disabled feature cannot process webhook',async()=>{const h=handler({env:{}});assert.equal((await h.run(signed())).status,503);assert.equal(h.jobs.size,0);});
test('queue failure asks Hive to retry and never acknowledges success',async()=>{const h=handler({enqueue:async()=>{throw Error('store unavailable');}});assert.equal((await h.run(signed())).status,503);});
test('existing attribution cannot silently move to a different client',()=>{const s={...snapshot,uses:[{'Hive Inspection ID':base.id,Code:'INS25ABCDEFG','Client ID':'original-client'}]};assert(matchReferral(base,s).holds.some(h=>h.includes('changed')));});

for(const [label,patch] of [
 ['unpublished report',{reports:{status:'draft'}}],
 ['missing report',{reports:null}],
 ['future end',{ends_at:new Date(now+1).toISOString()}],
 ['invalid end',{ends_at:'not a date'}],
 ['missing end',{ends_at:null}],
 ['canceled inspection',{status:'canceled',canceled_at:new Date(now).toISOString()}],
 ['deleted inspection',{deleted:true}],
])test(label+' cannot count as completed',()=>{
 const facts=inspectionFacts({...base,...patch},{now});assert.equal(facts.completed,false);assert.equal(facts.completedAt,null);
});
test('completion starts when observed, survives repeat reads, and restarts after a later end time',()=>{
 const old={'Hive Inspection ID':base.id,'Client ID':'client-1',Code:'INS25ABCDEFG','Completed At':new Date(now).toISOString()};
 assert.equal(matchReferral(base,{...snapshot,uses:[old]},{now:now+3600000}).facts.completedAt,old['Completed At']);
 const moved={...base,ends_at:new Date(now+1800000).toISOString()};
 assert.equal(matchReferral(moved,{...snapshot,uses:[old]},{now:now+3600000}).facts.completedAt,new Date(now+3600000).toISOString());
 for(const patch of [{'Completed At':'invalid'},{'Completed At':new Date(now+7200000).toISOString()},{'Client ID':'different'}, {Code:'OTHER'}]){
  assert.equal(matchReferral(base,{...snapshot,uses:[{...old,...patch}]},{now:now+3600000}).facts.completedAt,new Date(now+3600000).toISOString());
 }
});

import vm from 'node:vm';import fs from 'node:fs';
function timingLedger(){
 let clock=now;
 class TestDate extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const tables={Codes:structuredClone(snapshot.codes),CodeUses:[]};
 const ctx=vm.createContext({Date:TestDate,Number,String,Error,Array,JSON});
 vm.runInContext(fs.readFileSync(new URL('../operations/Code.gs',import.meta.url),'utf8')+'\n'+fs.readFileSync(new URL('../operations/CodeSharing.gs',import.meta.url),'utf8'),ctx);
 ctx.records=name=>structuredClone(tables[name]);
 ctx.writeRecord=(name,row,key)=>{const at=tables[name].findIndex(r=>r[key]===row[key]);if(at<0)tables[name].push(structuredClone(row));else tables[name][at]=structuredClone(row);};
 return {observe(i,time){clock=time;const match=matchReferral(i,{codes:tables.Codes,uses:tables.CodeUses},{now:time,serviceIds:['full']});ctx.codeDispatch('recordCodeUse',{inspection:match.facts,evidence:'Synthetic timing test'});return tables.CodeUses[0];}};
}
for(const first of ['payment','completion'])test(first+' first still waits 24 hours after both are observed',()=>{
 const ledger=timingLedger(),hour=3600000;
 const incomplete={...base,reports:{status:'draft'}};
 const unpaid={...base,price:{...base.price,paid:false,payment_status:'pending',amount_due:400,amount_paid:0}};
 let row=ledger.observe(first==='payment'?incomplete:unpaid,now);
 assert.equal(row['Reward Due At'],'');
 row=ledger.observe(base,now+hour);const due=new Date(now+25*hour).toISOString();
 assert.equal(row['Reward Due At'],due);
 row=ledger.observe(base,now+2*hour);assert.equal(row['Reward Due At'],due);
 row=ledger.observe(incomplete,now+3*hour);assert.equal(row['Reward Due At'],'');assert.equal(row['Completed At'],'');
 row=ledger.observe(base,now+4*hour);assert.equal(row['Reward Due At'],new Date(now+28*hour).toISOString());
 row=ledger.observe(unpaid,now+5*hour);assert.equal(row['Reward Due At'],'');assert.equal(row['Paid At'],'');
 row=ledger.observe(base,now+6*hour);assert.equal(row['Reward Due At'],new Date(now+30*hour).toISOString());
 assert.ok(row['Hold Reason']);
});
