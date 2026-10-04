import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
import {validateShare} from '../netlify/lib/referral-sharing.mjs';
import {createShareHandler} from '../netlify/functions/referral-share.mjs';
const input={referrerName:'Past Client',referrerEmail:' Past@example.com ',eligibility:'confirmed',permissionAndTerms:'accepted',referralId:'10000000-0000-4000-8000-000000000000'};
function harness(){
 const tables={Codes:[{Code:'INS25ABCDEFG','Discount Amount':'25','Hive State':'VERIFIED','Assignment State':'AVAILABLE'}],Alerts:[],Shares:[],CodeUses:[],Referrals:[],Clients:[{Email:'past@example.com',Name:'Past Client','Past Client Verified':'YES'}],Exclusions:[]};
 const ctx=vm.createContext({Date,Number,String,Error,Array,JSON,Utilities:{getUuid:()=>crypto.randomUUID()}});
 vm.runInContext(fs.readFileSync(new URL('../operations/Code.gs',import.meta.url),'utf8')+'\n'+fs.readFileSync(new URL('../operations/CodeSharing.gs',import.meta.url),'utf8'),ctx);
 ctx.records=name=>structuredClone(tables[name]);ctx.writeRecord=(name,r,key)=>{const i=tables[name].findIndex(x=>x[key]===r[key]);if(i<0)tables[name].push(structuredClone(r));else tables[name][i]=structuredClone(r);};
 return {tables,call:(action,data)=>ctx.codeDispatch(action,data)};
}
test('returning referrer receives the same code despite email casing and another share request',()=>{const h=harness();const a=h.call('prepareShare',validateShare(input));const b=h.call('prepareShare',validateShare({...input,referrerEmail:'past@example.com',referralId:crypto.randomUUID()}));assert.equal(a.code,b.code);assert.equal(h.tables.Codes.length,1);assert.equal(h.tables.Shares.length,2);});
test('request retries are idempotent; changed details under the same ID are rejected',()=>{const h=harness();const data=validateShare(input);h.call('prepareShare',data);h.call('prepareShare',data);assert.equal(h.tables.Shares.length,1);assert.throws(()=>h.call('prepareShare',{...data,requestHash:'a'.repeat(64)}));});
test('uncreated Hive codes and unverified or excluded clients cannot receive codes',()=>{for(const mode of ['code','client','excluded']){const h=harness();if(mode==='code')h.tables.Codes[0]['Hive State']='PENDING CREATION';if(mode==='client')h.tables.Clients=[];if(mode==='excluded')h.tables.Exclusions=[{Email:'past@example.com'}];let result;try{result=h.call('prepareShare',validateShare(input));}catch{}assert.ok(!result?.code);assert.equal(h.tables.Codes[0]['Assignment State'],'AVAILABLE');}});
test('older active codes remain valid if owner gets an additional code',()=>{const h=harness();const first=h.call('prepareShare',validateShare(input));h.tables.Codes.push({...h.tables.Codes[0],Code:'INS25HJKLMNP','Assigned At':new Date(Date.now()+100).toISOString()});const again=h.call('prepareShare',validateShare({...input,referralId:crypto.randomUUID()}));assert.equal(again.code,first.code);assert.equal(h.tables.Codes[1]['Assignment State'],'ASSIGNED');});
test('friend details are rejected and only referrer fields survive validation',()=>{assert.throws(()=>validateShare({...input,friendEmail:'friend@example.com'}));const out=validateShare({...input,unknown:'not retained'});assert.equal(out.unknown,undefined);assert.equal(out.referrerEmail,'past@example.com');});
function use(h,id='one',clientId='client-one',clientEmail='friend@example.com'){
 const code=h.tables.Codes[0];code['Assigned At']=new Date(Date.now()-4*86400000).toISOString();
 return h.call('recordCodeUse',{inspection:{id,codes:[code.Code],clientId,clientEmail,bookedAt:new Date(Date.now()-3*86400000).toISOString(),completed:true,completedAt:new Date(Date.now()-2*86400000).toISOString(),paid:true,fullInspection:true,newClient:true,refunded:false,disputed:false,canceled:false},evidence:'TEST ONLY authoritative fixture'});
}
test('code attribution supports several clients and repeated events create one use',()=>{const h=harness();h.call('prepareShare',validateShare(input));use(h);use(h);use(h,'two','client-two','friend2@example.com');assert.equal(h.tables.CodeUses.length,2);assert.ok(h.tables.CodeUses.every(r=>r['Referrer Email']==='past@example.com'));});
test('payment starts a conservative 24h wait and duplicate clients cannot be paid twice',()=>{const h=harness();h.call('prepareShare',validateShare(input));use(h);assert.throws(()=>h.call('reserveCodeReward',{useId:'HIVE-one'}));let row=h.tables.CodeUses[0];row['Paid At']=new Date(Date.now()-2*86400000).toISOString();row['Reward Due At']=new Date(Date.now()-86400000).toISOString();h.call('reserveCodeReward',{useId:'HIVE-one'});assert.throws(()=>h.call('reserveCodeReward',{useId:'HIVE-one'}));use(h,'two');row=h.tables.CodeUses[1];row['Paid At']=new Date(Date.now()-2*86400000).toISOString();row['Reward Due At']=new Date(Date.now()-86400000).toISOString();assert.throws(()=>h.call('reserveCodeReward',{useId:'HIVE-two'}));});
test('origin rejection and disabled rollout do not mutate ledger',async()=>{let calls=0;const handler=createShareHandler({env:{},callLedger:async()=>{calls++;}});const request=origin=>new Request('https://www.insites.services/api/referral-share',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(input)});assert.equal((await handler(request('https://attacker.example'))).status,403);assert.equal((await handler(request('https://www.insites.services'))).status,503);assert.equal(calls,0);});

import {checkStock} from '../netlify/lib/referral-stock.mjs';
test('low-stock counts only verified unassigned codes and alerts once; replenishment rearms it',async()=>{
 const h=harness();h.tables.Codes=Array.from({length:6},(_,i)=>({...h.tables.Codes[0],Code:'CODE'+i}));
 let sends=0;const options={callLedger:async(a,d)=>h.call(a,d),sendEmail:async()=>`receipt-${++sends}`};
 assert.equal((await checkStock(options)).sent,false);
 h.tables.Codes[0]['Assignment State']='ASSIGNED';
 assert.equal((await checkStock(options)).remaining,5);assert.equal(sends,1);
 await checkStock(options);assert.equal(sends,1);
 h.tables.Codes.push({...h.tables.Codes[1],Code:'PENDING','Hive State':'PENDING CREATION'});await checkStock(options);assert.equal(sends,1);
 h.tables.Codes[6]['Hive State']='VERIFIED';await checkStock(options);
 h.tables.Codes[1]['Assignment State']='ASSIGNED';await checkStock(options);assert.equal(sends,2);
});
test('ambiguous sends reuse the alert ID and stop retrying before provider idempotency expires',()=>{const h=harness();const a=h.call('prepareLowCodeAlert',{}),b=h.call('prepareLowCodeAlert',{});assert.equal(a.alertId,b.alertId);h.tables.Alerts[0]['Reserved At']=new Date(Date.now()-24*3600000).toISOString();assert.equal(h.call('prepareLowCodeAlert',{}).review,true);});
test('referrer form returns a code without sending or storing friend data',async()=>{const h=harness();const handler=createShareHandler({env:{REFERRAL_CODES_ENABLED:'true'},callLedger:async(a,d)=>h.call(a,d)});const req=new Request('https://www.insites.services/api/referral-share',{method:'POST',headers:{origin:'https://www.insites.services','content-type':'application/json'},body:JSON.stringify(input)});const response=await handler(req);assert.equal(response.status,200);assert.equal((await response.json()).code,'INS25ABCDEFG');assert.equal(h.tables.Shares[0]['Friend Email'],undefined);});
