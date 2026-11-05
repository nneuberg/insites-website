import {assertSourceAuthority,contactIdsForEmail,normalizeSourceEmail} from './hive-source-cache.mjs';
import {assessPhotoBooking} from './photo-customer.mjs';

// Cache-only preparation. No writes, Hive fallback, Mailchimp calls, scheduler,
// or activation. Caller must retain this private report, not log email addresses.
const id=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(x)&&!['__proto__','constructor','prototype'].includes(x);
const held=reason=>({status:'held',reason,positive:[],counts:null,absenceProven:false});

async function barriers(store){
 const r=await store.getWithMetadata('hive-source-work/v1',{type:'json'}),w=r?.data;
 if(!r?.etag||w?.schema!==1||w.globalRoleDirty!==false||w.roleMappingUnknown!==false)return null;
 for(const key of ['refreshContactIds','invalidatedContactIds','invalidatedInspectionIds'])if(!Array.isArray(w[key])||w[key].length)return null;
 if(!Array.isArray(w.pendingInspectionIds)||w.pendingInspectionIds.some(x=>!id(x))||new Set(w.pendingInspectionIds).size!==w.pendingInspectionIds.length)return null;
 // Even unparsed receipts invalidate a dry-run. No event is consumed or acked.
 let pages=0;
 for await(const page of store.list({prefix:'hive-source-events/pending/',paginate:true}))if(++pages>1||!Array.isArray(page?.blobs)||page.blobs.length)return null;
 return {etag:r.etag,pending:new Set(w.pendingInspectionIds)};
}

export async function auditPhotoSource({services,catalog,attributionPolicy,now=()=>Date.now(),maxAgeMs=86400000,maxRows=2500}={}){
 try{
  if(!Number.isSafeInteger(maxRows)||maxRows<1||maxRows>10000)return held('Invalid bounded audit');
  const {store,cache}=await services(),start=now(),before=await barriers(store);
  if(!before)return held('Source work or pending events not clear');
  const snapshot=await cache.read(),s=snapshot?.state;
  if(!snapshot?.etag||s?.schema!==1)return held('Source snapshot unavailable');
  for(const kind of ['contacts','inspections'])assertSourceAuthority(s,kind,{now:start,maxAgeMs});
  const rows=Object.values(s.inspections);
  if(rows.length>maxRows)return held('Source exceeds bounded audit');
  const positive=[],counts={orders:rows.length,positiveOrders:0,agents:0,excluded:0,held:0,pendingLifecycle:0};
  const reasons={};
  const hold=reason=>{counts.held++;reasons[reason]=(reasons[reason]||0)+1;};
  const observedAt=Math.min(s.coverage.contacts.watermark,s.coverage.inspections.watermark);
  for(const row of rows){
   if(!id(row?.id)||row.kind!=='inspections'||row.data?.id!==row.id||typeof row.deleted!=='boolean'||!Number.isSafeInteger(row.revision)||row.revision<0){hold('Invalid cached inspection');continue;}
   if(row.deleted){counts.excluded++;continue;}
   // Lifecycle polling is not the same as invalidation. An unpaid/future/media
   // booking may remain pending indefinitely. Fresh confirmed positive evidence
   // can still be audited; it never proves completion or absence, or admits mail.
   if(before.pending.has(row.id))counts.pendingLifecycle++;
   const result=assessPhotoBooking(row.data,{catalog,attributionPolicy,sourceObservedAt:observedAt,now:start,maxAgeMs});
   if(result.status==='excluded'){counts.excluded++;continue;}
   if(result.status!=='positive'){hold(result.reason);continue;}
   const ids=contactIdsForEmail(s,result.email),contact=s.contacts[result.contactId],d=contact?.data;
   if(ids.length!==1||ids[0]!==result.contactId||contact?.id!==result.contactId||contact.kind!=='contacts'||!Number.isSafeInteger(contact.revision)||contact.revision<0||contact.deleted!==false||d?.id!==result.contactId||d.deleted!==undefined&&d.deleted!==false||d.emailIdentityHeld||normalizeSourceEmail(d.email)!==result.email||!Array.isArray(contact.emails)||contact.emails.length!==1||contact.emails[0]!==result.email||!Array.isArray(d.roles)||!d.roles.some(r=>r==='Listing Agent'||r==='Seller Agent')){hold('Exact current listing-agent identity not verified');continue;}
   positive.push(result);counts.positiveOrders++;
  }
  const again=await cache.read(),after=await barriers(store),last=await cache.read(),end=now();
  // Final cache observation catches mutation during the ending barrier scan.
  // This is still an optimistic diagnostic, never atomic send eligibility.
  if(end<start||again?.etag!==snapshot.etag||last?.etag!==snapshot.etag||after?.etag!==before.etag)return held('Source or work changed during audit');
  for(const kind of ['contacts','inspections'])assertSourceAuthority(s,kind,{now:end,maxAgeMs});
  counts.agents=new Set(positive.map(p=>p.email)).size;
  return {status:'audited',observedAt:end,sourceWatermark:observedAt,cacheEtag:snapshot.etag,workEtag:before.etag,counts,reasons,positive,historyComplete:s.coverage.inspections.historyComplete===true,catalogComplete:catalog.complete===true,absenceProven:false};
 }catch{return held('Fresh complete source and configured catalogue required');}
}

// Both photography messages are independently evaluated. Skipping one does not
// cancel the person's remaining nurture sequence or change its cadence.
// A missing/false group is NEVER evidence of no past photography business.
export function photographyPitchDecision({stageDay,photoGroup,sourcePositive=false,absenceProof}={}){
 if(![42,49].includes(stageDay))return {action:'not_applicable'};
 if(photoGroup===true||sourcePositive===true)return {action:'skip',reason:'known_photography_customer',rejoinDay:63};
 // No live producer currently supplies this exhaustive proof. The explicit
 // contract prevents the additive flag alone from opening an email gate.
 if(photoGroup===false&&absenceProof?.verified===true&&absenceProof.historyComplete===true&&absenceProof.catalogComplete===true&&absenceProof.identityExact===true&&absenceProof.pendingClear===true&&absenceProof.sourceFresh===true)return {action:'eligible_for_other_guards'};
 return {action:'hold',reason:'photography_history_unknown'};
}

export function summarizePhotoAudit(report){
 return report.status==='audited'?{status:report.status,observedAt:report.observedAt,sourceWatermark:report.sourceWatermark,counts:report.counts,reasons:report.reasons,historyComplete:report.historyComplete,catalogComplete:report.catalogComplete,absenceProven:false}:{status:'held',reason:report.reason,absenceProven:false};
}
