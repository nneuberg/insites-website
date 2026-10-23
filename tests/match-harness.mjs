import {createEngine} from '../netlify/lib/review-engine.mjs';
import {DAY} from '../netlify/lib/review-policy.mjs';
const now=Date.parse('2026-10-12T18:00:00Z');
const inspection={id:'inspection',confirmed:true,ends_at:'2026-10-12T12:00:00Z',price:{paid:true,amount_due:0},agreements:{all_signed:true},reports:{status:'published'},address:{full:'Test address'},contacts:[{id:'client',role:'Customer',first_name:'Alex',email:'alex@example.com'},{id:'agent',role:'Buyer Agent',first_name:'Agent',email:'agent@example.com'}]};
function setup({contactTags=[{name:'Past Client'}],contactRoles=[],intercept=null,envOverrides={}}={}){
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
  if(path.includes('/contacts/'))return Response.json({tags:contactTags,roles:contactRoles});
  return Response.json(inspection);
 };
 const engine=createEngine({store,fetcher:intercept?((url,options)=>intercept(url,options,fetcher)):fetcher,now:()=>clock,env:{HIVE_API_KEY:'mock-hive',MAILCHIMP_API_KEY:'mock-us5',REVIEW_ENABLED:'true',REVIEW_START_AFTER:'2026-10-12T00:00:00Z',...envOverrides}});
 return {engine,store,entries,members,calls,advance:days=>clock+=days*DAY};
}
export {setup,inspection,now};
