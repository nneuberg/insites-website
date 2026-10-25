import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {reconcileHiveTags} from '../netlify/lib/hive-tag-sync.mjs';
import {createEngine} from '../netlify/lib/review-engine.mjs';
import {AUDIENCES} from '../netlify/lib/review-policy.mjs';

export const OWNED=[
 '1st time buying agent','new selling agent','repeat selling agent',
 'absent selling agent','absent buying agent','repeat buying agent',
 'super buying agent','vip buying agent','no business'
];
export const MANUAL=['google reviewed','REVIEW:PENDING','REVIEW:COMPLETE','REF:CODE-OWNER',
 'REF:QA','feedback received','photo client','PHOTO:DELIVERED','campaign october',
 'CAMPAIGN:PAUSED','SUPPRESS:EMAIL','do not email','manual VIP','Past Client',
 'first time buying agent','vip buying agents','no business:manual'];
const norm=s=>s.trim().toLowerCase();
export const tags=names=>names.map(name=>({name}));
export const contact=(names=[],extra={})=>({id:'fixture-one',email:'fixture@example.invalid',tags:tags(names),...extra});

export const page=data=>({data,next_cursor:null,total:data.length});
export const catalogPage=names=>page(names.map((name,i)=>({id:'tag-'+i,name})));

// No provider SDK or network is used. Even createEngine's HTTP calls terminate
// in this injected fetcher with fake credentials and reserved-domain contacts.
export function fixture(options={}){
 const entries=new Map(),members=new Map(),calls=[],writes=[];
 let sequence=0,clock=Date.parse('2026-10-25T12:00:00Z');
 const store={
  async get(key){return structuredClone(entries.get(key)?.data??null);},
  async getWithMetadata(key){return structuredClone(entries.get(key)??null);},
  async setJSON(key,data,condition={}){
   await options.beforeSave?.(key,data);
   const old=entries.get(key);
   if(condition.onlyIfNew&&old||condition.onlyIfMatch&&old?.etag!==condition.onlyIfMatch)return {modified:false};
   entries.set(key,{data:structuredClone(data),etag:String(++sequence)});return {modified:true};
  }
 };
 const keyFor=(role,email='fixture@example.invalid')=>`/3.0/lists/${AUDIENCES[role]}/members/${createHash('md5').update(email).digest('hex')}`;
 for(const role of ['Agent','Customer'])members.set(keyFor(role),{
  status:role==='Agent'?'unsubscribed':'transactional',email_address:'fixture@example.invalid',
  merge_fields:{FNAME:'Fixture',REVLINK:'',REFDATE:'',HISTORY:'retain'},
  tags:tags(options.memberTags??['no business',...MANUAL])
 });
 async function route(url,request){
  const u=new URL(url);
  if(u.hostname==='api.hiveinspect.com'){
   assert.equal(request.method,'GET','sync never writes Hive');
   if(u.pathname==='/v1/tags')return Response.json(options.catalog??catalogPage([...OWNED,...MANUAL]));
   assert.equal(u.pathname,'/v1/contacts');
   if(u.searchParams.has('email'))return Response.json(typeof options.matches==='function'?await options.matches(u.searchParams):options.matches??page([contact(options.hiveTags??['repeat buying agent'])]));
   return Response.json(options.page?await options.page(u.searchParams):{data:[contact()],next_cursor:null,total:1});
  }
  assert.equal(u.hostname,'us5.api.mailchimp.com','unexpected service');
  const key=u.pathname.replace(/\/tags$/,''),member=members.get(key);
  if(!member)return new Response(null,{status:404});
  if(request.method==='GET')return Response.json(member);
  assert.equal(request.method,'POST');assert.ok(u.pathname.endsWith('/tags'));
  const body=JSON.parse(request.body);assert.deepEqual(Object.keys(body),['tags']);
  writes.push({key,body:structuredClone(body)});
  for(const change of body.tags){
   assert.ok(['active','inactive'].includes(change.status));
   member.tags=member.tags.filter(t=>norm(t.name)!==norm(change.name));
   if(change.status==='active')member.tags.push({name:change.name});
  }
  return new Response(null,{status:204});
 }
 const engine=createEngine({store,now:()=>clock,env:{HIVE_API_KEY:'mock',MAILCHIMP_API_KEY:'mock-us5'},fetcher:async(url,request)=>{
  calls.push({url,method:request.method,body:request.body});
  return options.intercept?options.intercept(url,request,()=>route(url,request)):route(url,request);
 }});
 return {options,store,engine,entries,members,calls,writes,keyFor,now:()=>clock,advance:ms=>clock+=ms,
  run:(extra={})=>reconcileHiveTags({engine,store,now:()=>clock,apply:true,...extra})};
}

