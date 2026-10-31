import {beginSourceTraversal,appendSourcePage} from './hive-source-cache.mjs';
// Shared data-plane preparation. Not wired into production while containment is on.
export const SOURCE_PLAN=Object.freeze({enabled:false,seedOnly:true,receive:true,reviewEnrollmentEnabled:false,referralReconciliationEnabled:false,tagReconciliationEnabled:false,ledgerFencingVerified:false,automaticTagUpdatesVerified:false,contactDeletionRecoveryVerified:false,pageSize:200,hourlyMs:3600000,dailyMs:86400000,overlapMs:300000});
const kinds=new Set(['contacts','inspections']);
const idOK=x=>typeof x==='string'&&!['__proto__','constructor','prototype'].includes(x)&&/^[a-zA-Z0-9_-]{1,100}$/.test(x);
const stamp=x=>{if(!Number.isSafeInteger(x)||x<0)throw Error('Invalid source time');return new Date(x).toISOString();};
export function sourceListPath(kind,{cursor=null,since=null,eligibleAfter=null,ids=null}={}){
 if(!kinds.has(kind)||cursor!==null&&(typeof cursor!=='string'||!cursor))throw Error('Invalid source list');
 if(ids!==null&&(!Array.isArray(ids)||!ids.length||ids.length>200||ids.some(x=>!idOK(x))||new Set(ids).size!==ids.length))throw Error('Invalid ID batch');
 if(ids!==null&&(since!==null||eligibleAfter!==null))throw Error('ID rechecks must not hide older or inactive records');
 if(eligibleAfter!==null&&(kind!=='inspections'||since!==null))throw Error('Invalid eligibility scan');
 const q=new URLSearchParams({limit:'200'});
 if(cursor!==null)q.set('cursor',cursor);
 if(ids!==null)q.set('ids',ids.join(','));
 if(since!==null)q.set('updated_since',stamp(since));
 if(eligibleAfter!==null){q.set('status','confirmed');q.set('paid','true');q.set('agreements_signed','true');q.set('published','true');q.set('scheduled_after',stamp(eligibleAfter));}
 else if(kind==='inspections'){q.set('include_canceled','true');q.set('include_deleted','true');}
 return kind+'?'+q;
}
export function sourceIdBatches(ids){
 if(!Array.isArray(ids)||ids.some(x=>!idOK(x)))throw Error('Invalid pending IDs');
 const unique=[...new Set(ids)].sort(),out=[];for(let i=0;i<unique.length;i+=200)out.push(unique.slice(i,i+200));return out;
}
// Exact microseconds avoid collapsing distinct versions within one millisecond.
export function sourceRevision(value){
 const m=typeof value==='string'&&/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d:\d\d)$/.exec(value);
 if(!m)throw Error('Missing source revision');
 const calendar=new Date(m[1]+'Z');
 if(!Number.isFinite(calendar.getTime())||calendar.toISOString().slice(0,19)!==m[1])throw Error('Invalid source calendar time');
 const base=Date.parse(m[1]+m[3]),us=base*1000+Number((m[2]||'').padEnd(6,'0'));
 if(!Number.isSafeInteger(us)||us<0)throw Error('Invalid source revision');return us;
}
export function normalizeListRecord(kind,row){
 if(!kinds.has(kind)||!idOK(row?.id)||typeof row.updated_at!=='string')throw Error('Incomplete source record');
 const deleted=row.deleted===true;
 // Do not synthesize complete contact roles/tags from embedded inspection contacts.
 if(kind==='contacts'&&(!Array.isArray(row.roles)||!Array.isArray(row.tags)))throw Error('Incomplete contact authority');
 const sourceEmail=kind==='contacts'&&typeof row.email==='string'?row.email.trim().toLowerCase():null;
 const usableEmail=sourceEmail&&/^\S+@\S+\.\S+$/.test(sourceEmail)?sourceEmail:null;
 const invalidEmail=kind==='contacts'&&row.email!=null&&row.email!==''&&!usableEmail;
 const emails=kind==='contacts'&&usableEmail?[usableEmail]:[];
 let data=structuredClone(row);
 if(kind==='contacts'){
  if(row.roles.some(r=>typeof r!=='string')||row.tags.some(t=>typeof t?.name!=='string'||!t.name.trim()))throw Error('Incomplete contact tags or roles');
  data={id:row.id,first_name:row.first_name??null,last_name:row.last_name??null,email:usableEmail,...(invalidEmail?{sourceEmail:row.email,emailIdentityHeld:true}:{}),
   roles:[...new Set(row.roles)].sort(),tags:[...new Set(row.tags.map(t=>t.name))].sort().map(name=>({name}))};
 }
 return {kind,id:row.id,revision:sourceRevision(deleted?row.deleted_at:row.updated_at),deleted,data,...(kind==='contacts'?{emails}:{})};
}
// Call once per tick under ONE cross-consumer coordinator lease. At most one page
// is fetched. Durable traversal state permits resumption without restarting scans.
export async function sourceScanStep({cache,checkpointStore,read,kind,now=()=>Date.now(),mode='delta',enabled=false,historyComplete=false,assertHeld}){
 if(!enabled)return {deferred:true,requests:0};
 if(typeof assertHeld!=='function')throw Error('Shared coordinator lease assertion required');
 await assertHeld();
 if(!kinds.has(kind))throw Error('Invalid scan kind');
 const key='hive-source-scan/'+kind;
 const checkpoint=await checkpointStore.getWithMetadata(key,{type:'json'});
 let pending=checkpoint?.data;
 const publishCheckpoint=async value=>{await assertHeld();const result=await checkpointStore.setJSON(key,value,checkpoint?{onlyIfMatch:checkpoint.etag}:{onlyIfNew:true});if(result?.modified!==true)throw Error('Source checkpoint conflict');return result;};
 if(!pending){
  const snapshot=await cache.read();
  const coverage=snapshot.state.coverage[kind];
  if(coverage?.complete&&now()-coverage.watermark<SOURCE_PLAN.dailyMs)return {deferred:true,requests:0};
  const traversal=beginSourceTraversal(snapshot.state,{kind,mode:coverage?.complete?mode:'full',startedAt:now(),scope:'all',historyComplete,overlapMs:SOURCE_PLAN.overlapMs});
  pending={snapshot,traversal};
 }
 const t=pending.traversal,path=sourceListPath(kind,{cursor:t.nextCursor,since:t.since});
 const page=await read(path); // Shared quota transport, never a raw independent fetch.
 if(!page||!Array.isArray(page.data))throw Error('Invalid source page');
 const next=appendSourcePage(t,{cursor:t.nextCursor,rows:page.data.map(row=>normalizeListRecord(kind,row)),nextCursor:page.next_cursor,total:page.total});
 if(!next.done){
  const saved=await publishCheckpoint({...pending,traversal:next});
  if(saved?.modified!==true)throw Error('Source scan checkpoint not durable');
  return {complete:false,requests:1};
 }
 // A CAS conflict leaves the cache unchanged. Clear stale scan to allow restart;
 // never advance a cursor/watermark on failed durable publication.
 await assertHeld();
 try{await cache.publishTraversal(pending.snapshot,next);}catch(error){await publishCheckpoint(null);throw error;}
 const cleared=await publishCheckpoint(null);
 if(cleared?.modified!==true)throw Error('Source scan final checkpoint uncertain');
 return {complete:true,requests:1};
}
export function estimateSourceBudget({hourlyPages=1,contactDeltaPages=14,inspectionDeltaPages=1,pendingBatchPages=1,eventBatchPages=20,tagWritePairs=10,bootstrapContacts=0}={}){
 const n=[hourlyPages,contactDeltaPages,inspectionDeltaPages,pendingBatchPages,eventBatchPages,tagWritePairs,bootstrapContacts];
 if(n.some(x=>!Number.isSafeInteger(x)||x<0))throw Error('Invalid budget inputs');
 // Pending older jobs rechecked once daily; paid/signed events trigger faster work.
 const daily=24*hourlyPages+contactDeltaPages+inspectionDeltaPages+pendingBatchPages+eventBatchPages+1+2*tagWritePairs;
 return {daily,days31:31*daily,bootstrap:Math.ceil(bootstrapContacts/200),ceilingDaily:100,ceilingRolling31Days:3000};
}
