import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngine} from '../netlify/lib/review-engine.mjs';
import {reviewEnvironment} from '../netlify/lib/review-launch.mjs';
import {inReviewScope} from '../netlify/lib/review-scope.mjs';
import {REVIEW_INTAKE_START_AFTER,allowsReviewIntake} from '../netlify/lib/review-intake.mjs';
import {runCachedReviewWorker} from '../netlify/lib/hive-source-review.mjs';

test('future-only admission excludes old inspections without changing existing review scope or receipts',async()=>{
 const cutoff=Date.parse(REVIEW_INTAKE_START_AFTER),now=cutoff+60000,entries=new Map(),calls=[];let seq=0;
 const store={async *list({prefix}){yield {blobs:[...entries.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key}))};},async get(k){return structuredClone(entries.get(k)?.data??null);},async getWithMetadata(k){return structuredClone(entries.get(k)??null);},async setJSON(k,data,o={}){const old=entries.get(k);if(o.onlyIfNew&&old||o.onlyIfMatch&&old?.etag!==o.onlyIfMatch)return {modified:false};entries.set(k,{data:structuredClone(data),etag:String(++seq)});return {modified:true};}};
 const env=reviewEnvironment({MAILCHIMP_API_KEY:'mock-us5'});
 const engine=createEngine({store,env,now:()=>now,sourceContact:async()=>{calls.push('contact');return {roles:[],tags:[]};},fetcher:async()=>{calls.push('mailchimp');return Response.json({status:'subscribed',merge_fields:{},tags:[]});}});
 const base={id:'future-job',confirmed:true,ends_at:new Date(cutoff).toISOString(),price:{paid:true,amount_due:0},agreements:{all_signed:true},reports:{status:'published'},address:{full:'Synthetic address'},contacts:[{id:'person',role:'Customer',first_name:'Test',email:'test@example.com'}]};
 const old={...base,id:'old-job',ends_at:new Date(cutoff-1).toISOString()};
 assert.equal(allowsReviewIntake(base,REVIEW_INTAKE_START_AFTER),true);assert.equal(allowsReviewIntake(base,'invalid'),false);
 assert.deepEqual(await engine.enroll(old),{added:0,intakeHeld:true});assert.equal(calls.length,0);assert.equal(entries.size,0);
 assert.equal((await engine.enroll(base)).added,1);assert.equal((await engine.enroll(base)).added,0);
 const legacy={role:'Customer',inspectionEndedAt:Date.parse('2026-10-28T12:00:00Z'),createdAt:Date.parse('2026-10-28T13:00:00Z'),token:'a'.repeat(48),sentStages:[0]};
 assert.equal(inReviewScope(legacy,env),true);assert.deepEqual(legacy.sentStages,[0]);assert.equal(env.REVIEW_HIVE_TAG_WRITES_ENABLED,'false');
 const considered=[];let followups=0;
 const state={coverage:{inspections:{complete:true,scope:'all',watermark:now}},conflicts:{},inspections:{a:{id:'a',data:old,revision:1},b:{id:'b',data:base,revision:2}}};
 const result=await runCachedReviewWorker({cache:{read:async()=>({state})},view:{getInspection:async()=>base},engine:{enroll:async i=>{considered.push(i.id);return {added:1};},run:async options=>{assert.deepEqual(options,{discover:false});followups++;return {processed:0};}},store,now:()=>now,enabled:true,limit:1});
 assert.deepEqual(considered,['future-job']);assert.equal(result.sourceConsidered,1);assert.equal(followups,1);
 entries.clear();calls.length=0;
 for(let i=0;i<21;i++)await engine.save({...legacy,token:i.toString(16).padStart(48,'0'),endedAt:now-1,finishSynced:true,googleReviewedAt:now-1,hiveTagSynced:false});
 const active={...legacy,token:'f'.repeat(48),expiresAt:now+86400000};await engine.save(active);
 const follow=await engine.run({discover:false});assert.equal(follow.processed,1);assert.equal(follow.hiveDeferred,21);assert.equal(calls.length,0);assert.equal((await engine.get(active.token)).legacyNotBefore,now+7*86400000);
});
