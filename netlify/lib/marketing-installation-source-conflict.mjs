// OFF-only, one-shot diagnostic. It never publishes to the source cache, work
// queue, consumer state, ledger, or marketing providers. The only provider read
// is the one exact inspection selected by private source conflict evidence.
import {createHash} from 'node:crypto';
import {normalizeListRecord,sourceRevision} from './hive-source-sync.mjs';
import {inspectionConflictDiagnostic,isInspectionPhotoAuthOnly} from './hive-source-conflict-diagnostics.mjs';

const CACHE='hive-source-cache/post-repair-20261031',WORK='hive-source-work/v1',COORD='hive-source-coordinator/v1';
const SCANS=['hive-source-scan/contacts','hive-source-scan/inspections'];
const AUDIT='hive-source-conflict-audit/inspection-v1/';
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const time=x=>Number.isSafeInteger(x)&&x>=0;
const id=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(x)&&!['__proto__','constructor','prototype'].includes(x);
const canonical=x=>Array.isArray(x)?x.map(canonical):obj(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const serialized=x=>JSON.stringify(canonical(x));
const hash=x=>createHash('sha256').update(serialized(x)).digest('hex');
const same=(a,b)=>serialized(a)===serialized(b);
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const fail=()=>{throw Error('Source diagnostic unavailable');};
const requireThat=ok=>{if(!ok)fail();};
const nullableText=x=>x===null||typeof x==='string';
const roles=['Customer','Buyer Agent','Seller Agent','Listing Agent','Agent'];
const revision=value=>{try{return sourceRevision(value);}catch{fail();}};

// Reject non-JSON, dangerous keys and excessive nesting before hashing or walking.
function boundedJSON(value){
 let nodes=0;
 function visit(x,depth){
  requireThat(++nodes<=100000&&depth<=20);
  if(x===null||typeof x==='boolean'||typeof x==='string')return;
  if(typeof x==='number'){requireThat(Number.isFinite(x));return;}
  requireThat(Array.isArray(x)||obj(x));
  if(Array.isArray(x))requireThat(x.length<=10000);
  for(const [k,v] of Object.entries(x)){requireThat(!['__proto__','constructor','prototype'].includes(k)&&k.length<=512);visit(v,depth+1);}
 }
 visit(value,0);requireThat(Buffer.byteLength(JSON.stringify(value))<=1000000);
}
function completeInspection(raw,expectedId,at){
 boundedJSON(raw);
 requireThat(obj(raw)&&raw.id===expectedId&&id(raw.id)&&['draft','waiting','review','confirmed','canceled'].includes(raw.status)&&typeof raw.confirmed==='boolean'&&typeof raw.deleted==='boolean');
 const created=revision(raw.created_at),updated=revision(raw.updated_at);
 requireThat(created<=updated&&updated<(at+1)*1000);
 for(const k of ['scheduled_for','ends_at','canceled_at','deleted_at'])requireThat(Object.hasOwn(raw,k)&&(raw[k]===null||typeof raw[k]==='string'&&time(revision(raw[k]))));
 requireThat(!raw.deleted||raw.deleted_at!==null&&revision(raw.deleted_at)>=(updated));
 requireThat(Object.hasOwn(raw,'cover_photo_url')&&nullableText(raw.cover_photo_url));
 requireThat(Array.isArray(raw.contacts)&&raw.contacts.length<=200&&new Set(raw.contacts.map(c=>c?.id)).size===raw.contacts.length);
 for(const c of raw.contacts){
  requireThat(obj(c)&&id(c.id)&&typeof c.role==='string'&&c.role.length>0&&c.role.length<=128);
  for(const k of ['first_name','last_name','email','phone','agency_id','agency_name'])requireThat(Object.hasOwn(c,k)&&nullableText(c[k]));
 }
 requireThat(obj(raw.price)&&typeof raw.price.paid==='boolean'&&typeof raw.price.payment_status==='string'&&raw.price.payment_status.length>0&&['amount_paid','amount_due'].every(k=>typeof raw.price[k]==='number'&&Number.isFinite(raw.price[k])&&raw.price[k]>=0));
 requireThat(obj(raw.agreements)&&typeof raw.agreements.present==='boolean'&&typeof raw.agreements.all_signed==='boolean'&&Array.isArray(raw.agreements.items));
 requireThat(obj(raw.reports)&&typeof raw.reports.status==='string'&&raw.reports.status.length>0&&Array.isArray(raw.reports.items));
 for(const k of ['services','inspectors','discount_codes'])requireThat(Array.isArray(raw[k]));
 const row={...normalizeListRecord('inspections',raw),emails:[]};
 requireThat(row.revision<(at+1)*1000);
 return row;
}
// An exact detail GET must retain every object field from the existing full
// record. Empty arrays/removals remain meaningful; never align entities by index.
function retainedFields(old,current){
 if(!obj(old))return;
 requireThat(obj(current));
 for(const [k,v] of Object.entries(old)){
  requireThat(Object.hasOwn(current,k));
  if(obj(v)&&current[k]!==null)retainedFields(v,current[k]);
 }
}
const safeRoot=new Set(['id','revision','deleted','emails','kind']);
const safeFields=new Set(['id','status','confirmed','scheduled_for','ends_at','created_at','updated_at','canceled_at','deleted','deleted_at','cover_photo_url','contacts','price','agreements','reports','services','inspectors','discount_codes','address']);
const safeContact=new Set(['id','role','first_name','last_name','email','phone','agency_id','agency_name']);
// Never echo arbitrary provider object keys (they can themselves contain PII).
function safePath(path){
 const p=path.split('/').slice(1);
 if(safeRoot.has(p[0]))return '/'+p[0];
 if(p[0]!=='data'||!safeFields.has(p[1]))return '/data/[other]';
 const root='/data/'+p[1];
 if(p[1]==='contacts'&&/^\d{1,3}$/.test(p[2]||''))return root+'/'+p[2]+(safeContact.has(p[3])?'/'+p[3]:p.length>3?'/[other]':'');
 return root;
}
function roleCounts(contacts){
 const out=Object.fromEntries([...roles,'Other'].map(r=>[r,0]));
 for(const c of contacts)out[roles.includes(c.role)?c.role:'Other']++;
 return out;
}
function comparison(old,current){
 const d=inspectionConflictDiagnostic(old,current),a=old.data.contacts,b=current.data.contacts;
 const before=new Map(a.map(c=>[c.id,c])),after=new Map(b.map(c=>[c.id,c]));
 const added=b.filter(c=>!before.has(c.id)).length,removed=a.filter(c=>!after.has(c.id)).length;
 const sorted=rows=>[...rows].sort((x,y)=>x.id.localeCompare(y.id));
 const sameContactsIgnoringOrder=same(sorted(a),sorted(b)),orderChanged=!same(a.map(c=>c.id),b.map(c=>c.id));
 const photoChanged=!same(old.data.cover_photo_url,current.data.cover_photo_url);
 const photoAuthChanged=photoChanged&&isInspectionPhotoAuthOnly(inspectionConflictDiagnostic(old,{...old,data:{...old.data,cover_photo_url:current.data.cover_photo_url}}),{requireExactSignatureExpiry:true});
 const adjusted=structuredClone(current);adjusted.data.contacts=structuredClone(a);if(photoAuthChanged)adjusted.data.cover_photo_url=old.data.cover_photo_url;
 const otherFieldsChanged=!same(old,adjusted);
 const identityFields=['first_name','last_name','email'];
 return {
  oldHash:d.oldHash,incomingHash:d.incomingHash,changedPaths:[...new Set(d.changedPaths.map(safePath))].sort(),pathsTruncated:d.pathsTruncated,
  currentlyMatchesCache:same(old,current),photoChanged,photoAuthChanged,photoAuthOnly:isInspectionPhotoAuthOnly(d,{requireExactSignatureExpiry:true}),
  contactOrderingChanged:orderChanged,contactsEqualIgnoringOrder:sameContactsIgnoringOrder,
  contactOrderOnly:orderChanged&&sameContactsIgnoringOrder&&!photoChanged&&!otherFieldsChanged,
  contactOrderAndPhotoAuthOnly:orderChanged&&sameContactsIgnoringOrder&&photoAuthChanged&&!otherFieldsChanged,
  contactMembershipChanged:added>0||removed>0,
  contactIdentityChanged:added>0||removed>0||b.some(c=>before.has(c.id)&&identityFields.some(k=>!same(before.get(c.id)[k],c[k]))),
  contactRoleChanged:b.some(c=>before.has(c.id)&&before.get(c.id).role!==c.role),
  contactDetailsChanged:!sameContactsIgnoringOrder,otherFieldsChanged,
  contacts:{oldCount:a.length,currentCount:b.length,addedCount:added,removedCount:removed,oldRoleCounts:roleCounts(a),currentRoleCounts:roleCounts(b)}
 };
}
async function queueEmpty(store){
 let pages=0;
 for await(const page of store.list({prefix:'hive-source-events/pending/',paginate:true})){
  requireThat(++pages<=100&&Array.isArray(page?.blobs)&&page.blobs.length===0);
 }
}
function trustedTarget(s,at){
 const c=s.cache.data,w=s.work.data,q=s.coordinator.data;
 requireThat(obj(c)&&c.schema===1&&obj(c.contacts)&&obj(c.inspections)&&obj(c.conflicts)&&obj(c.coverage)&&c.inspectionConflictDiagnosticsTruncated!==true);
 for(const k of ['contacts','inspections']){
  const cov=c.coverage[k];requireThat(obj(cov)&&cov.complete===true&&cov.scope==='all'&&time(cov.watermark)&&cov.watermark<=at&&Array.isArray(cov.missingIds)&&cov.missingIds.length===0);
 }
 const conflicts=Object.keys(c.conflicts);requireThat(conflicts.length===1&&conflicts[0].startsWith('inspections:'));
 const target=conflicts[0].slice(12);requireThat(id(target)&&Object.hasOwn(c.inspections,target)&&time(c.conflicts[conflicts[0]]));
 const old=c.inspections[target];requireThat(obj(old)&&old.kind==='inspections'&&old.id===target&&old.deleted===false&&old.revision===c.conflicts[conflicts[0]]&&same(old,completeInspection(old.data,target,at)));
 const prior=c.inspectionConflictDiagnostics?.[target];
 requireThat(obj(prior)&&prior.semanticConflictSeen===true);
 for(const d of [prior.first,prior.latest])requireThat(obj(d)&&d.schema===1&&d.revision===old.revision&&d.oldHash===hash(old)&&digest(d.incomingHash)&&Array.isArray(d.changedPaths)&&d.pathsTruncated===false&&d.changedPaths.length>0&&d.changedPaths.length<=100&&d.changedPaths.every(p=>typeof p==='string'&&p.length<=512));
 requireThat(obj(w)&&w.schema===1&&w.globalRoleDirty===false&&w.roleMappingUnknown===false);
 for(const k of ['pendingInspectionIds','refreshContactIds','invalidatedContactIds','invalidatedInspectionIds'])requireThat(Array.isArray(w[k])&&w[k].every(id)&&new Set(w[k]).size===w[k].length);
 requireThat(w.pendingInspectionIds.includes(target)&&w.refreshContactIds.length===0&&w.invalidatedContactIds.length===0&&w.invalidatedInspectionIds.length===0);
 requireThat(obj(q)&&q.schema===1&&q.generation==='post-repair-20261031'&&q.active===null&&(q.quarantined===undefined||q.quarantined===false)&&(q.resumeAfter===undefined||q.resumeAfter===null||q.resumeAfter===0)&&q.validationFailure==null);
 requireThat(s.scans.every(x=>x===null||x.data===null));
 return {target,old,prior,pendingInspectionCount:w.pendingInspectionIds.length};
}
async function snapshot(store,at){
 const [cache,work,coordinator,...scans]=await Promise.all([CACHE,WORK,COORD,...SCANS].map(k=>store.getWithMetadata(k,{type:'json'})));
 for(const row of [cache,work,coordinator])requireThat(obj(row)&&typeof row.etag==='string'&&row.etag.length>0&&obj(row.data));
 for(const row of scans)requireThat(row===null||obj(row)&&typeof row.etag==='string'&&row.etag.length>0);
 const s={cache,work,coordinator,scans};return {...s,...trustedTarget(s,at)};
}
const sourceIdentity=s=>({cache:s.cache.etag,work:s.work.etag,coordinator:s.coordinator.etag,scans:s.scans.map(x=>x?.etag??null)});
const sourceHash=s=>hash([s.cache.data,s.work.data,s.coordinator.data,s.scans.map(x=>x?.data??null)]);

export async function installationSourceConflictDiagnostic({store,transport,withLease,now=()=>Date.now()}={}){
 let attempted=false,complete=false;
 const held=()=>({schema:1,diagnosticComplete:false,held:true,providerReadAttempted:attempted,providerResponseComplete:complete,consumerPromotion:false,eligibilityAuthority:false,conflictCleared:false});
 try{
  requireThat(typeof store?.getWithMetadata==='function'&&typeof store?.setJSON==='function'&&typeof store?.list==='function'&&typeof transport?.request==='function'&&typeof withLease==='function');
  return await withLease('hive-source-coordinator',async lease=>{
   requireThat(typeof lease?.assertHeld==='function');await lease.assertHeld();
   const started=now();requireThat(time(started));
   const s=await snapshot(store,started);await queueEmpty(store);
   const identity=sourceIdentity(s),sourceDigest=sourceHash(s);
   const stable=async()=>{await lease.assertHeld();const at=now();requireThat(time(at)&&at>=started);const current=await snapshot(store,at);requireThat(same(identity,sourceIdentity(current))&&sourceDigest===sourceHash(current));await queueEmpty(store);await lease.assertHeld();};
   const binding={schema:1,kind:'inspection-conflict-v1',target:s.target,revision:s.old.revision,oldHash:hash(s.old),firstHash:hash(s.prior.first),latestHash:hash(s.prior.latest)};
   const key=AUDIT+hash(binding),prior=await store.getWithMetadata(key,{type:'json'});
   if(prior){
    requireThat(typeof prior.etag==='string'&&prior.etag&&obj(prior.data));
    const e=prior.data;requireThat(e.schema===1&&e.state==='observed'&&same(e.binding,binding)&&same(e.sourceEtags,identity)&&e.sourceHash===sourceDigest&&time(e.requestStartedAt)&&time(e.observedAt)&&e.requestStartedAt<=e.observedAt&&e.observedAt<=started);
    const row=completeInspection(e.record?.data,s.target,e.observedAt);requireThat(same(row,e.record)&&row.revision>=s.old.revision);
    retainedFields(s.old.data,row.data);const diagnostic=comparison(s.old,row);requireThat(same(e.diagnostic,diagnostic));
    await stable();const check=await store.getWithMetadata(key,{type:'json'});requireThat(check?.etag===prior.etag&&same(check.data,e));await lease.assertHeld();
    return {schema:1,diagnosticComplete:true,held:true,providerReadAttempted:false,providerResponseComplete:true,reusedObservation:true,historicalObservation:true,evidenceSaved:true,requestStartedAt:e.requestStartedAt,observedAt:e.observedAt,oldRevision:s.old.revision,currentRevision:row.revision,sameRevision:row.revision===s.old.revision,pendingInspectionCount:s.pendingInspectionCount,historicalSemanticConflict:true,sourceHash:sourceDigest,consumerPromotion:false,eligibilityAuthority:false,conflictCleared:false,diagnostic};
   }
   const reservation={schema:1,state:'reserved',binding,sourceEtags:identity,sourceHash:sourceDigest,requestStartedAt:started};
   await stable();
   requireThat((await store.setJSON(key,reservation,{onlyIfNew:true}))?.modified===true);
   const owned=await store.getWithMetadata(key,{type:'json'});requireThat(typeof owned?.etag==='string'&&owned.etag&&same(owned.data,reservation));
   await stable();attempted=true;
   // Optional include_deleted avoids silently losing a newly deleted record.
   const response=await transport.request('inspections/'+encodeURIComponent(s.target)+'?include_deleted=true',{method:'GET'});
   requireThat(response?.ok===true&&response.status===200);
   const body=await response.json(),observedAt=now();requireThat(time(observedAt)&&observedAt>=started);
   const row=completeInspection(body,s.target,observedAt);retainedFields(s.old.data,row.data);requireThat(row.revision>=s.old.revision);complete=true;
   const diagnostic=comparison(s.old,row);await stable();
   const evidence={...reservation,state:'observed',observedAt,record:row,diagnostic};
   await lease.assertHeld();requireThat((await store.setJSON(key,evidence,{onlyIfMatch:owned.etag}))?.modified===true);
   const saved=await store.getWithMetadata(key,{type:'json'});requireThat(typeof saved?.etag==='string'&&saved.etag&&saved.etag!==owned.etag&&same(saved.data,evidence));
   await stable();
   return {schema:1,diagnosticComplete:true,held:true,providerReadAttempted:true,providerResponseComplete:true,reusedObservation:false,historicalObservation:false,evidenceSaved:true,requestStartedAt:started,observedAt,oldRevision:s.old.revision,currentRevision:row.revision,sameRevision:row.revision===s.old.revision,pendingInspectionCount:s.pendingInspectionCount,historicalSemanticConflict:true,sourceHash:sourceDigest,consumerPromotion:false,eligibilityAuthority:false,conflictCleared:false,diagnostic};
  });
 }catch{return held();}
}
