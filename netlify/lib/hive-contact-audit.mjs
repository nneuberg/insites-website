import {createHash} from 'node:crypto';

const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
 ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const sorted=rows=>[...rows].sort((a,b)=>a.id.localeCompare(b.id));
const resources=['contacts','agencies'];
const empty=()=>({cursor:null,total:null,seenCursors:[],rows:[],pages:0});
const addressFields=['address','address_line2','city','state','zip','country'];
const agentTags=new Set(['broker','1st time buying agent','repeat buying agent','super buying agent',
 'vip buying agent','absent buying agent','absent selling agent','new selling agent','repeat selling agent']);
export function reconciliationRecord(resource,row){
 const fields=resource==='contacts'?['id','first_name','last_name','email','phone','agency_id','agency_name','business_name','updated_at',...addressFields]
  :['id','name','phone','updated_at',...addressFields];
 const result={};
 for(const key of fields)if(Object.hasOwn(row,key)){
  if(row[key]!==null&&typeof row[key]!=='string')throw Error('Invalid projection field');
  result[key]=row[key];
 }
 if(resource==='contacts'){
  if(Object.hasOwn(row,'uses_agency_address')){
   if(typeof row.uses_agency_address!=='boolean')throw Error('Invalid association flag');
   result.uses_agency_address=row.uses_agency_address;
  }
  if(!Object.hasOwn(result,'agency_id')&&row.agency&&typeof row.agency.id==='string')result.agency_id=row.agency.id;
  // Preserve role enum values verbatim; do not silently lose roles by guessing
  // their spelling/case. Missing roles stay absent, distinct from verified [].
  if(Object.hasOwn(row,'roles')){
   if(!Array.isArray(row.roles)||row.roles.some(r=>typeof r!=='string'||r.length>128))throw Error('Invalid roles');
   result.roles=[...new Set(row.roles)].sort();
  }
  // Tag names are unverified organization labels: review hints, never proof of
  // agent status or authorization to add a row. Exclude unrelated tag content.
  result.candidate_agent_tags=Array.isArray(row.tags)?[...new Set(row.tags.map(t=>typeof t==='string'?t:t?.name)
   .filter(t=>typeof t==='string').map(t=>t.trim().toLowerCase()).filter(t=>agentTags.has(t)))].sort():[];
 }
 return result;
}

export function auditWindow(env,now=()=>new Date().toISOString()){
 const start=Date.parse(env.HIVE_CONTACT_AUDIT_NOT_BEFORE||'');
 const end=Date.parse(env.HIVE_CONTACT_AUDIT_EXPIRES_AT||'');
 const current=Date.parse(now());
 return Number.isFinite(start)&&Number.isFinite(end)&&Number.isFinite(current)&&
  end>start&&end-start<=60*60*1000&&current>=start&&current<end;
}

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
 if(!auditWindow(env,now))return {status:'outside_audit_window'};
 const run=env.HIVE_CONTACT_AUDIT_RUN_ID;
 if(!/^[a-zA-Z0-9_-]{8,64}$/.test(run||''))return {status:'configuration_required'};
 const key='runs/'+run;
 const saved=await store.getWithMetadata(key,{type:'json'});
 const approvedWindow={notBefore:Date.parse(env.HIVE_CONTACT_AUDIT_NOT_BEFORE),expiresAt:Date.parse(env.HIVE_CONTACT_AUDIT_EXPIRES_AT)};
 const state=saved?structuredClone(saved.data):{schema:1,run,status:'reading',approvedWindow,startedAt:now(),attempts:0,pass:0,resource:0,current:empty(),snapshots:[{},{}]};
 if(state.schema!==1||state.run!==run)return {status:'invalid_state_hold'};
 if(!state.approvedWindow||state.approvedWindow.notBefore!==approvedWindow.notBefore||
    state.approvedWindow.expiresAt!==approvedWindow.expiresAt)return {status:'changed_window_hold'};
 if(state.status!=='reading')return {status:state.status,counts:state.counts||null};
 // Persist reservation BEFORE the GET. Crashes and failed reads consume budget.
 // CAS fences concurrent callers; only the successful claimant may fetch.
 if(!Number.isSafeInteger(state.attempts)||state.attempts<0)return {status:'invalid_state_hold'};
 if(state.attempts>=80)return {status:'attempt_budget_exhausted'};
 if(state.nextRetryAt&&Date.parse(state.nextRetryAt)>Date.parse(now()))return {status:'backoff_retry_later'};
 if(state.inflightUntil&&Date.parse(state.inflightUntil)>Date.parse(now()))return {status:'reader_busy_retry'};
 state.attempts++;
 state.inflightUntil=new Date(Date.parse(now())+30000).toISOString();
 const reservation=await store.setJSON(key,state,saved?{onlyIfMatch:saved.etag}:{onlyIfNew:true});
 if(!reservation.modified)return {status:'concurrent_reader_retry'};
 const owned=await store.getWithMetadata(key,{type:'json'});
 if(!owned||owned.data.attempts!==state.attempts||owned.data.inflightUntil!==state.inflightUntil)return {status:'concurrent_reader_retry'};
 // Storage may consume the remaining window. Never initiate a GET after expiry.
 if(!auditWindow(env,now)||Date.parse(now())>=state.approvedWindow.expiresAt)return {status:'outside_audit_window'};
 const resource=resources[state.resource];
 let page;
 try{page=await read(resource,state.current.cursor);}catch{
  delete state.inflightUntil;
  state.consecutiveFailures=(state.consecutiveFailures||0)+1;
  state.nextRetryAt=new Date(Date.parse(now())+Math.min(30000,5000*2**Math.min(state.consecutiveFailures-1,3))).toISOString();
  state.status=state.attempts>=80?'attempt_budget_exhausted':'reading';
  await store.setJSON(key,state,{onlyIfMatch:owned.etag});
  return {status:state.status==='reading'?'read_failed_retry':state.status};
 }
 state.consecutiveFailures=0;delete state.nextRetryAt;
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
  c.total=page.total;c.rows.push(...page.data.map(row=>reconciliationRecord(resource,row)));c.pages++;
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
 delete state.inflightUntil;
 const savedResult=await store.setJSON(key,state,{onlyIfMatch:owned.etag});
 if(!savedResult.modified)return {status:'concurrent_reader_retry'};
 return {status:state.status,counts:state.counts||null};
}
