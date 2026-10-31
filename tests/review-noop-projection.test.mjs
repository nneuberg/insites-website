import test from 'node:test';import assert from 'node:assert/strict';
import {setup,inspection} from './review-fields-cutover-harness.mjs';
test('HTTP200 unchanged fields verifies once, holds projection and never advances or replays',async()=>{
 const noopFields=new Set(['RVPEND']);let noopWrites=0,verifyReads=0;
 const s=setup({intercept:async(u,o,next)=>{
  if(u.includes('/lists/3ebb3017d4/'))return Response.json({}, {status:404});
  const fields=o.body&&JSON.parse(o.body).merge_fields;
  if(fields&&Object.keys(fields).some(k=>noopFields.has(k))){noopWrites++;return Response.json({status:'subscribed',merge_fields:{RVPEND:'',RVFEED:'',RVGDONE:''}});}
  if(o.method==='GET'&&noopWrites)verifyReads++;
  return next(u,o);
 }});
 await s.engine.enroll(inspection);let key=[...s.entries.keys()].find(k=>k.startsWith('requests/')),r=await s.engine.get(key.slice(9));
 await assert.rejects(()=>s.engine.process(r.token),/projection unverified/);
 r=await s.engine.get(r.token);assert.deepEqual(r.sentStages,[]);assert.equal(r.lastStageQueuedAt,undefined);assert.equal(r.stagePrepared,true);assert.ok(r.projectionHold);assert.equal(noopWrites,1);assert.equal(verifyReads,1);
 await s.engine.process(r.token);assert.equal(noopWrites,1);assert.equal(verifyReads,1);
 await s.engine.feedback(r.token,{rating:5,feedback:'Synthetic saved feedback'});r=await s.engine.get(r.token);assert.ok(r.ratedAt);assert.notEqual(r.finishSynced,true);assert.equal(noopWrites,1);
});
test('lost accepted stage at week boundary reconciles original signal without sending next stage',async()=>{
 let lost=true;const s=setup({intercept:async(u,o,next)=>{const r=await next(u,o);if(lost&&o.body&&JSON.parse(o.body).merge_fields?.RVPEND==='STAGE0'){lost=false;throw Error('Lost accepted response');}return r;}});
 await s.engine.enroll(inspection);const key=[...s.entries.keys()].find(k=>k.startsWith('requests/')),r=await s.engine.get(key.slice(9));s.advance(6.99);
 await assert.rejects(()=>s.engine.process(r.token),/Lost accepted/);s.advance(.02);await s.engine.run({discover:false});
 assert.deepEqual((await s.engine.get(r.token)).sentStages,[0]);assert.equal(s.calls.filter(c=>c.body?.merge_fields?.RVPEND==='STAGE0').length,1);assert.equal(s.calls.some(c=>c.body?.merge_fields?.RVPEND==='STAGE1'),false);
 s.advance(1);await s.engine.run({discover:false});assert.equal(s.calls.some(c=>c.body?.merge_fields?.RVPEND==='STAGE1'),false);
});
test('empty HTTP200 body enters one-read verification and persistent hold for terminal projection',async()=>{
 let writes=0,reads=0;const s=setup({intercept:async(u,o,next)=>{if(o.method==='PATCH'){writes++;return new Response('',{status:200});}if(o.method==='GET'&&writes)reads++;return next(u,o);}});
 await s.engine.enroll(inspection);const key=[...s.entries.keys()].find(k=>k.startsWith('requests/')),r=await s.engine.get(key.slice(9));
 await s.engine.feedback(r.token,{rating:5,feedback:'Synthetic terminal feedback'});let saved=await s.engine.get(r.token);assert.ok(saved.ratedAt);assert.ok(saved.projectionHold);assert.notEqual(saved.finishSynced,true);assert.equal(writes,1);assert.equal(reads,1);
 await s.engine.process(r.token);assert.equal(writes,1);assert.equal(reads,1);
});
