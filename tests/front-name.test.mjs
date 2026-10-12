import test from 'node:test';
import assert from 'node:assert/strict';
import {frontNameScore,namedFrontCover} from '../netlify/lib/gallery-drive.mjs';
test('recognizes front filename variants without ambiguous or hidden details',()=>{
  for(const name of ['Front.jpg','front-01.JPG','FrontOfHouse.jpg','123 Main - front exterior.png','front_view.webp','front2.jpg'])assert.ok(frontNameScore(name)>0,name);
  for(const name of ['waterfront.jpg','front door.jpg','front-yard.jpg','rear front.jpg','_front.jpg','interior.jpg'])assert.equal(frontNameScore(name),0,name);
});
test('searches later pages and prioritizes explicit front names',async()=>{
  const calls=[];const photo={id:'front-photo',name:'Front.jpg'};
  const result=await namedFrontCover(async(path,params)=>{calls.push(params);return params.pageToken?{files:[photo]}:{files:[{id:'first',name:'front view.jpg'}],nextPageToken:'next'};},'album-id');
  assert.equal(result.id,photo.id);assert.equal(calls.length,2);assert.equal(calls[1].pageToken,'next');assert.ok(calls.every(p=>p.q.includes("'album-id' in parents")));
});
test('no matching names preserves the fallback and incomplete searches fail',async()=>{
  assert.equal(await namedFrontCover(async()=>({files:[{name:'kitchen.jpg'}]}),'album'),undefined);
  await assert.rejects(namedFrontCover(async()=>({files:[],incompleteSearch:true}),'album'),{status:503});
});
