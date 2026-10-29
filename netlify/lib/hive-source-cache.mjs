// Internal normalized cache only. No Hive endpoint/envelope/signature assumptions.
// Adapters must prove revision ordering, complete pagination and source coverage.
const kinds=new Set(['contacts','inspections']);
const clone=x=>structuredClone(x);
const text=x=>typeof x==='string'&&x.trim()!=='';
const time=x=>Number.isSafeInteger(x)&&x>=0;
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export const normalizeSourceEmail=value=>typeof value==='string'?value.trim().toLowerCase():'';
export function emptySourceCache(){return {schema:1,contacts:{},inspections:{},coverage:{},conflicts:{}};}
function validate(row){
 if(!row||!kinds.has(row.kind)||!text(row.id)||!time(row.revision)||typeof row.deleted!=='boolean'||!row.data||typeof row.data!=='object'||Array.isArray(row.data))throw Error('Invalid normalized source record');
 if(row.kind==='contacts'&&(!Array.isArray(row.emails)||row.emails.some(e=>!text(e)||!/^\S+@\S+\.\S+$/.test(e.trim()))))throw Error('Invalid normalized email identities');
 return {...clone(row),emails:row.kind==='contacts'?[...new Set(row.emails.map(normalizeSourceEmail))].sort():[]};
}
export function applySourceRecords(state,rows){
 const next=clone(state);if(next.schema!==1)throw Error('Unsupported cache');
 for(const raw of rows){const row=validate(raw),old=Object.hasOwn(next[row.kind],row.id)?next[row.kind][row.id]:null,key=row.kind+':'+row.id;
  if(old&&row.revision<old.revision)continue;
  if(old&&row.revision===old.revision){if(!equal(old,row))next.conflicts[key]=row.revision;continue;}
  Object.defineProperty(next[row.kind],row.id,{value:row,writable:true,enumerable:true,configurable:true});delete next.conflicts[key];
 }
 return next;
}
export function contactIdsForEmail(state,email){
 const normalized=normalizeSourceEmail(email);
 return Object.values(state.contacts).filter(row=>!row.deleted&&row.emails.includes(normalized)).map(row=>row.id).sort();
}
export function assertSourceAuthority(state,kind,{now,maxAgeMs,requireHistory=false}={}){
 const c=state.coverage[kind];
 if(!kinds.has(kind)||!time(now)||!time(maxAgeMs)||!c?.complete||c.scope!=='all'||!time(c.watermark)||now<c.watermark||now-c.watermark>maxAgeMs||requireHistory&&c.historyComplete!==true||Object.keys(state.conflicts).some(k=>k.startsWith(kind+':')))throw Error('Source cache is not authoritative');
 return true;
}
export function beginSourceTraversal(state,{kind,mode='full',startedAt,overlapMs=300000,scope='all',historyComplete=false}={}){
 if(!kinds.has(kind)||!['full','delta'].includes(mode)||!time(startedAt)||!time(overlapMs)||!text(scope))throw Error('Invalid traversal');
 if(state.coverage[kind]?.watermark>startedAt)throw Error('Traversal watermark would regress');
 if(mode==='delta'&&(!state.coverage[kind]?.complete||state.coverage[kind].scope!==scope))throw Error('Delta requires complete matching baseline');
 return {kind,mode,startedAt,scope,historyComplete,base:clone(state),since:mode==='delta'?Math.max(0,state.coverage[kind].watermark-overlapMs):null,rows:[],ids:[],cursors:[],nextCursor:null,total:null,done:false,pages:0};
}
export function appendSourcePage(traversal,{cursor=null,rows,nextCursor,total}){
 const t=clone(traversal);
 if(t.done||cursor!==t.nextCursor||cursor!==null&&!text(cursor)||nextCursor!==null&&!text(nextCursor)||!Array.isArray(rows)||rows.length>200||!Number.isSafeInteger(total)||total<0||t.total!==null&&total!==t.total)throw Error('Incomplete or inconsistent pagination');
 const normalized=rows.map(validate);
 if(normalized.some(r=>r.kind!==t.kind)||normalized.some(r=>t.ids.includes(r.id))||new Set(normalized.map(r=>r.id)).size!==normalized.length)throw Error('Duplicate or wrong source identities');
 if(nextCursor!==null&&(nextCursor===cursor||t.cursors.includes(nextCursor)))throw Error('Pagination cycle');
 t.rows.push(...normalized);t.ids.push(...normalized.map(r=>r.id));t.cursors.push(cursor);t.pages++;t.total=total;t.nextCursor=nextCursor;
 if(t.rows.length>total||nextCursor===null&&t.rows.length!==total)throw Error('Incomplete coverage');
 t.done=nextCursor===null;return t;
}
export function finishSourceTraversal(t){
 if(!t.done||!t.pages)throw Error('Traversal unfinished');
 let state=clone(t.base);
 // An absent ID is not a versioned deletion. Retain evidence and hold authority
 // until a verified deletion event/row or a complete later scan resolves it.
 const missingIds=t.mode==='full'&&t.scope==='all'?Object.values(state[t.kind]).filter(row=>!row.deleted&&!t.ids.includes(row.id)).map(row=>row.id):[];
 state=applySourceRecords(state,t.rows);
 state.coverage[t.kind]={complete:missingIds.length===0,missingIds,scope:t.scope,watermark:t.startedAt,historyComplete:t.mode==='delta'?t.base.coverage[t.kind].historyComplete:t.historyComplete};
 return state;
}
export function createSourceCache({store,key='hive-source-cache/v1'}){
 const read=async()=>{const found=await store.getWithMetadata(key,{type:'json'});return {state:found?.data||emptySourceCache(),etag:found?.etag??null};};
 async function publish(snapshot,state){
  const result=await store.setJSON(key,state,snapshot.etag===null?{onlyIfNew:true}:{onlyIfMatch:snapshot.etag});
  if(result?.modified!==true)throw Error('Source cache changed; restart without advancing watermark');
  return state;
 }
 return {read,async apply(rows){const snapshot=await read();return publish(snapshot,applySourceRecords(snapshot.state,rows));},async publishTraversal(snapshot,traversal){
  if(!equal(snapshot.state,traversal.base))throw Error('Traversal snapshot mismatch');
  return publish(snapshot,finishSourceTraversal(traversal));
 }};
}
