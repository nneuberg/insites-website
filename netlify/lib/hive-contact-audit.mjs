import {createHash} from 'node:crypto';

const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
 ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const sorted=rows=>[...rows].sort((a,b)=>a.id.localeCompare(b.id));
const resources=['contacts','agencies'];
const empty=()=>({cursor:null,total:null,seenCursors:[],rows:[],pages:0});

// Only GET to two fixed Hive resources; no arbitrary URL, role filter or mutations.
export function createHiveReader({env=process.env,fetcher=fetch}={}){
 return async(resource,cursor)=>{
  if(!resources.includes(resource))throw Error('Unsupported audit resource');
  if(!env.HIVE_API_KEY)throw Error('Hive credential unavailable');
  const url=new URL('/v1/'+resource,'https://api.hiveinspect.com');
  url.searchParams.set('limit','200');
  if(cursor!==null)url.searchParams.set('cursor',cursor);
  const response=await fetcher(url,{method:'GET',redirect:'error',headers:{Authorization:'Bearer '+env.HIVE_API_KEY},signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('Hive read failed');
  return response.json();
 };
}

// One page per invocation, with CAS on the entire private snapshot state.
// Concurrent readers may duplicate a GET but cannot advance the cursor twice.
export async function auditStep({store,read,env=process.env,context='local',now=()=>new Date().toISOString()}){
 if(context!=='production'||env.HIVE_CONTACT_AUDIT_ENABLED!=='true')return {status:'disabled'};
 const run=env.HIVE_CONTACT_AUDIT_RUN_ID;
 if(!/^[a-zA-Z0-9_-]{8,64}$/.test(run||''))return {status:'configuration_required'};
 const key='runs/'+run;
 const saved=await store.getWithMetadata(key,{type:'json'});
 const state=saved?structuredClone(saved.data):{schema:1,run,status:'reading',startedAt:now(),pass:0,resource:0,current:empty(),snapshots:[{},{}]};
 if(state.schema!==1||state.run!==run)return {status:'invalid_state_hold'};
 if(state.status!=='reading')return {status:state.status,counts:state.counts||null};
 const resource=resources[state.resource];
 let page;
 try{page=await read(resource,state.current.cursor);}catch{return {status:'read_failed_retry'};}
 try{
  const c=state.current;
  if(!page||!Array.isArray(page.data)||!Number.isSafeInteger(page.total)||page.total<0||!Object.hasOwn(page,'next_cursor'))throw Error('Invalid page');
  if(c.total!==null&&c.total!==page.total)throw Error('Changing total');
  if(page.data.length>200||c.pages>=1000)throw Error('Page bounds exceeded');
  const ids=new Set(c.rows.map(row=>row.id));
  for(const row of page.data){
   if(!row||typeof row.id!=='string'||!row.id.trim()||ids.has(row.id))throw Error('Duplicate or invalid ID');
   ids.add(row.id);
  }
  const next=page.next_cursor;
  if(next!==null&&(typeof next!=='string'||!next||c.seenCursors.includes(next)))throw Error('Invalid cursor');
  c.total=page.total;c.rows.push(...page.data);c.pages++;
  if(c.rows.length>c.total)throw Error('Count exceeds total');
  if(next!==null){c.seenCursors.push(next);c.cursor=next;}
  else{
   if(c.rows.length!==c.total)throw Error('Incomplete enumeration');
   state.snapshots[state.pass][resource]={rows:sorted(c.rows),total:c.total,pages:c.pages,hash:hash(sorted(c.rows)),completedAt:now()};
   state.current=empty();state.resource++;
   if(state.resource===resources.length){state.resource=0;state.pass++;}
   if(state.pass===2){
    state.counts=Object.fromEntries(resources.map(r=>[r,state.snapshots[1][r].total]));
    state.status=resources.every(r=>state.snapshots[0][r].hash===state.snapshots[1][r].hash)?'complete':'changed_between_passes_hold';
    state.completedAt=now();
    state.manifest={run,startedAt:state.startedAt,completedAt:state.completedAt,
     resources:Object.fromEntries(resources.map(r=>[r,{total:state.snapshots[1][r].total,sha256:state.snapshots[1][r].hash}]))};
   }
  }
 }catch{
  // No contact content or raw provider errors in returned status/logs.
  state.status='invalid_snapshot_hold';state.failedAt=now();
 }
 state.updatedAt=now();
 const savedResult=await store.setJSON(key,state,saved?{onlyIfMatch:saved.etag}:{onlyIfNew:true});
 if(!savedResult.modified)return {status:'concurrent_reader_retry'};
 return {status:state.status,counts:state.counts||null};
}
