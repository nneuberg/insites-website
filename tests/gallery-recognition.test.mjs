import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseFront,fingerprint,reserveCall,settleCall,scanTick} from '../netlify/lib/gallery-recognition.mjs';
import {ROOT} from '../netlify/lib/gallery-drive.mjs';
const album='abcdefghij123';
const photos=Array.from({length:14},(_,i)=>({id:'photo'+i,name:i+'.jpg',mimeType:'image/jpeg',modifiedTime:'2026-10-12T00:00:00Z'}));
class Store{
  constructor(){this.entries=new Map();this.counter=0;}
  async get(key){return this.entries.get(key)?.data||null;}
  async getWithMetadata(key){return this.entries.get(key)||null;}
  async setJSON(key,data,options={}){
    const old=this.entries.get(key);
    if(options.onlyIfNew&&old||options.onlyIfMatch&&old?.etag!==options.onlyIfMatch)return {modified:false};
    const etag=String(++this.counter);this.entries.set(key,{data,etag});return {modified:true,etag};
  }
}
const drive=async(path,p)=>path!=='files'?{id:album,name:'House',mimeType:'application/vnd.google-apps.folder'}:p.q.includes(ROOT)?{files:[{id:album,name:'House'}]}:{files:photos};
test('rejects rear, interior and low-confidence views',()=>{assert.equal(chooseFront(photos.slice(0,3),[{index:0,view:'rear',confidence:1,composition:1},{index:1,view:'interior',confidence:1,composition:1},{index:2,view:'front',confidence:.6,composition:1}]),null);});
test('selects confident well-composed front elevation',()=>{assert.equal(chooseFront(photos.slice(0,2),[{index:0,view:'front',confidence:.9,composition:.4},{index:1,view:'front',confidence:.97,composition:1}]).photoId,'photo1');});
test('rejects duplicate and out-of-range model indexes',()=>{for(const index of [0,99])assert.throws(()=>chooseFront(photos.slice(0,2),[{index:0,view:'front',confidence:1,composition:1},{index,view:'front',confidence:1,composition:1}]));});
test('fingerprint is order independent and changes when photo changes',()=>{assert.equal(fingerprint(photos),fingerprint([...photos].reverse()));assert.notEqual(fingerprint(photos),fingerprint(photos.map((x,i)=>i?x:{...x,modifiedTime:'changed'})));});
test('monthly cap holds under concurrent reservations',async()=>{const store=new Store();const results=await Promise.all([reserveCall(store,'2026-10',1),reserveCall(store,'2026-10',1)]);assert.equal(results.filter(Boolean).length,1);});
test('budget stops calls and settlement is idempotent',async()=>{const store=new Store();assert.equal(await reserveCall(store,'2026-10',1000,0),false);const reservation=await reserveCall(store,'2026-10',1000,.12);assert.equal(await reserveCall(store,'2026-10',1000,.12),false);await settleCall(store,'2026-10',reservation,{promptTokenCount:1000,candidatesTokenCount:100});const first=await store.get('usage/2026-10');assert.equal(first.reservedUSD,0);assert.ok(Math.abs(first.spentUSD-.00014)<1e-12);await settleCall(store,'2026-10',reservation,{promptTokenCount:1000,candidatesTokenCount:100});assert.equal((await store.get('usage/2026-10')).spentUSD,first.spentUSD);});
test('one batch per minute resumes to complete album, then skips unchanged images',async()=>{
  const store=new Store();let calls=0;const recognizer=async files=>{calls++;return {best:{photoId:files[0].id,score:.95}};};
  const now=Date.parse('2026-10-12T12:00:00Z');
  await scanTick({drive,store,key:'fixture',now,recognizer});
  assert.equal((await store.get('album/'+album)).offset,12);
  assert.equal((await scanTick({drive,store,key:'fixture',now,recognizer})).status,'already-running');
  await scanTick({drive,store,key:'fixture',now:now+60000,recognizer});
  assert.equal((await store.get('album/'+album)).complete,true);
  assert.equal((await scanTick({drive,store,key:'fixture',now:now+7*3600000,recognizer})).status,'unchanged');
  assert.equal(calls,2);
});
