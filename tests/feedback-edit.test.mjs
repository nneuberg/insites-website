import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {setup,inspection,now} from './harness.mjs';
import {createEngine} from '../netlify/lib/review-engine.mjs';
import {testRuntime,TEST_TOKEN,TEST_EXPIRES_AT} from '../netlify/lib/review-test-fixture.mjs';
globalThis.fetch=()=>{throw Error('Real network prohibited');};
test('4/empty -> 5/comment -> same-rating edit persists without repeat provider effects or date changes',async()=>{
 const s=setup();await s.engine.enroll(inspection);
 const row=[...s.entries.values()].find(v=>v.data.role==='Customer').data;
 await s.engine.feedback(row.token,{rating:4,feedback:'',revision:0});
 const first=await s.engine.get(row.token),count=s.calls.length;s.advance(1);
 await s.engine.feedback(row.token,{rating:5,feedback:'neal was awesom',revision:1});
 let saved=await s.engine.get(row.token);assert.equal(saved.rating,5);assert.equal(saved.feedback,'neal was awesom');assert.equal(saved.feedbackRevision,2);
 await s.engine.feedback(row.token,{rating:5,feedback:'edited comment',revision:2});
 saved=await s.engine.get(row.token);assert.equal(saved.feedback,'edited comment');assert.equal(saved.feedbackRevision,3);assert.equal(saved.ratedAt,first.ratedAt);assert.equal(saved.endedAt,first.endedAt);assert.equal(saved.finishSynced,first.finishSynced);assert.equal(s.calls.length,count);
 await s.engine.feedback(row.token,{rating:5,feedback:'edited comment',revision:2});assert.deepEqual(await s.engine.get(row.token),saved);
 await assert.rejects(()=>s.engine.feedback(row.token,{rating:4,feedback:'',revision:0}),/Reload/);assert.deepEqual(await s.engine.get(row.token),saved);
});
test('test edits remain isolated; expired and paused real edits leave record unchanged',async()=>{
 const s=setup();let clock=TEST_EXPIRES_AT-10000;const engine=await testRuntime(TEST_TOKEN,()=>s.store,()=>clock);
 await engine.feedback(TEST_TOKEN,{rating:4,feedback:'',revision:0});
 await engine.feedback(TEST_TOKEN,{rating:5,feedback:'neal was awesom',revision:1});
 const saved=await engine.get(TEST_TOKEN);assert.equal(saved.feedback,'neal was awesom');assert.equal(saved.rating,5);assert.equal(s.calls.length,0);
 clock=TEST_EXPIRES_AT;await assert.rejects(()=>engine.feedback(TEST_TOKEN,{rating:5,feedback:'new',revision:2}),/expired/);assert.deepEqual(await engine.get(TEST_TOKEN),saved);
 const real={...saved,isTest:false};await engine.save(real);
 const paused=createEngine({store:s.store,env:{REVIEW_ENABLED:'false'},now:()=>now,fetcher:()=>{throw Error('Provider forbidden');}});
 await assert.rejects(()=>paused.feedback(TEST_TOKEN,{rating:5,feedback:'new',revision:2}),/paused/);assert.deepEqual(await engine.get(TEST_TOKEN),real);
});
async function formHarness(details={name:'Test',address:'Fake',rated:false,revision:0},postError=null){
 const elements=new Map(),calls=[],radios=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{hidden:false,value:'',textContent:'',disabled:false,events:{},addEventListener(type,fn){this.events[type]=fn;}});return elements.get(id);};
 const form=element('feedback-form');form.querySelector=q=>{const n=Number(q.match(/value="(\d)"/)[1]);if(!radios.has(n))radios.set(n,{checked:false});return radios.get(n);};
 const context={URLSearchParams,location:{search:'?token=fake&rating=4'},document:{getElementById:element},FormData:class{get(){return [...radios].find(([,r])=>r.checked)?.[0]??null;}},fetch:async(url,options)=>{calls.push({url,...options});return {ok:options.method!=='POST'||!postError,json:async()=>options.method==='POST'?(postError?{error:postError}:{saved:true}):details};}};
 vm.runInNewContext(readFileSync(new URL('../review/review.js',import.meta.url),'utf8'),context);await new Promise(resolve=>setImmediate(resolve));
 return {element,form,radios,calls,submit:()=>form.events.submit({preventDefault(){}})};
}
test('GET and star preselection do not submit; explicit submit includes rating and comment; edit persists revision',async()=>{
 const ui=await formHarness();assert.equal(ui.calls.length,1);assert.equal(ui.calls[0].method,undefined);assert(ui.radios.get(4).checked);
 ui.element('feedback').value='neal was awesom';await ui.submit();assert.deepEqual(JSON.parse(ui.calls[1].body),{rating:4,feedback:'neal was awesom',revision:0});
 ui.element('edit-feedback').events.click();assert.equal(ui.form.hidden,false);ui.radios.get(4).checked=false;ui.form.querySelector('input[value="5"]').checked=true;await ui.submit();assert.equal(JSON.parse(ui.calls[2].body).revision,1);
});
test('reload restores saved comment and rating; server error remains visible and editable',async()=>{
 const ui=await formHarness({name:'Test',address:'Fake',rated:true,rating:5,feedback:'saved',revision:2},'Feedback changed. Reload this page before editing.');
 assert.equal(ui.element('feedback').value,'saved');assert(ui.radios.get(5).checked);assert.equal(ui.calls.length,1);
 ui.element('edit-feedback').events.click();ui.element('feedback').value='edited';await ui.submit();assert.match(ui.element('status').textContent,/Reload/);assert.equal(ui.form.hidden,false);assert.equal(ui.element('submit').disabled,false);assert.equal(ui.element('feedback').value,'edited');
});
test('client validation prevents a missing rating POST',async()=>{const ui=await formHarness();ui.radios.get(4).checked=false;await ui.submit();assert.equal(ui.calls.length,1);assert.match(ui.element('status').textContent,/Select a rating/);});
test('HTTP GET is read-only; malformed submissions and stale edits return visible errors',async()=>{
 const s=setup();const engine=await testRuntime(TEST_TOKEN,()=>s.store,()=>TEST_EXPIRES_AT-1000);
 let source=readFileSync(new URL('../netlify/functions/review-feedback.mjs',import.meta.url),'utf8');
 source=source.replace(/^import .*;\n/gm,'').replace('export default','return').replace(/export const config=[\s\S]*/,'');
 const handler=new Function('getStore','testRuntime','runtime','response','validToken',source)(()=>s.store,async()=>engine,()=>{throw Error('Production runtime forbidden');},(body,status=200)=>Response.json(body,{status}),t=>t===TEST_TOKEN);
 const url='https://www.insites.services/api/review-feedback?token='+TEST_TOKEN;
 const before=structuredClone([...s.entries]);const get=await handler(new Request(url+'&rating=5'),{});assert.equal(get.status,200);assert.equal((await get.json()).rated,false);assert.deepEqual([...s.entries],before);
 const post=body=>handler(new Request(url,{method:'POST',headers:{origin:'https://www.insites.services'},body}),{});
 for(const body of ['{','null',JSON.stringify({rating:6,feedback:'',revision:0}),JSON.stringify({rating:4,feedback:7,revision:0})])assert.equal((await post(body)).status,400);
 assert.equal((await post(JSON.stringify({rating:4,feedback:'',revision:0}))).status,200);
 assert.equal((await post(JSON.stringify({rating:5,feedback:'neal was awesom',revision:1}))).status,200);
 const restored=await (await handler(new Request(url),{})).json();assert.equal(restored.rating,5);assert.equal(restored.feedback,'neal was awesom');assert.equal(restored.revision,2);
 const stale=await post(JSON.stringify({rating:4,feedback:'old',revision:0}));assert.equal(stale.status,409);assert.match((await stale.json()).error,/Reload/);
 assert.equal(s.calls.length,0);
});
