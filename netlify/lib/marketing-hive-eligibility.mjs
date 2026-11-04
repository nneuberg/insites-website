import {assertSourceAuthority,contactIdsForEmail,normalizeSourceEmail} from './hive-source-cache.mjs';
// OFF integration adapter: cache/receipt reads only. Explicit native No Business
// is positive classification evidence, NOT proof inferred from absent history.
const AGE=86400000;
const businessTags=new Set(['1st time buying agent','absent buying agent','repeat buying agent','super buying agent','vip buying agent','new selling agent','absent selling agent','repeat selling agent','client']);
const businessRoles=new Set(['Customer','Buyer Agent','Listing Agent']);
const text=x=>typeof x==='string'&&x.trim().length>0;
const sourceId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(x)&&!['__proto__','constructor','prototype'].includes(x);
const sourceEmail=x=>/^\S+@\S+\.\S+$/.test(x)&&x.length<=254;
const linkRoles=new Set(['Customer','Buyer Agent','Seller Agent','Listing Agent','Agent']);
const held=()=>({eligible:false,stop:false,observedAt:null,contactIds:[]});
async function clearBarriers(store){
 const found=await store.getWithMetadata('hive-source-work/v1',{type:'json'}),w=found?.data;
 if(!found?.etag||w?.schema!==1||w.globalRoleDirty!==false||w.roleMappingUnknown!==false)return null;
 for(const k of ['refreshContactIds','invalidatedContactIds','invalidatedInspectionIds'])if(!Array.isArray(w[k])||w[k].length)return null;
 if(!Array.isArray(w.pendingInspectionIds)||w.pendingInspectionIds.some(id=>!sourceId(id))||new Set(w.pendingInspectionIds).size!==w.pendingInspectionIds.length)return null;
 // Even an unparsed pending receipt is uncertainty. Do not rely on the view's
 // once-per-invocation memoized barrier when checking again before admission.
 for await(const page of store.list({prefix:'hive-source-events/pending/',paginate:true})){
  if(!Array.isArray(page.blobs)||page.blobs.length)return null;
 }
 return {etag:found.etag,pendingInspectionIds:[...w.pendingInspectionIds]};
}
// Pending means continued lifecycle polling, not necessarily unknown source.
// Relax only for positively corroborated unrelated identities. Empty/unassigned
// links cannot prove non-association. Never remove or acknowledge polling work.
function pendingAssociation(state,pending,ids,email){
 const candidates=new Set(ids);let related=false;
 for(const id of pending){
  const row=Object.hasOwn(state.inspections,id)?state.inspections[id]:null,d=row?.data;
  if(!row||row.kind!=='inspections'||row.id!==id||!Number.isSafeInteger(row.revision)||row.revision<0||typeof row.deleted!=='boolean'||!d||d.id!==id||d.deleted!==undefined&&(typeof d.deleted!=='boolean'||d.deleted!==row.deleted)||!Array.isArray(d.contacts)||!d.contacts.length)return null;
  const seen=new Set();
  for(const link of d.contacts){
   const linkedEmail=normalizeSourceEmail(link?.email);
   if(!sourceId(link?.id)||seen.has(link.id)||!sourceEmail(linkedEmail)||!linkRoles.has(link.role))return null;
   seen.add(link.id);
   const contact=Object.hasOwn(state.contacts,link.id)?state.contacts[link.id]:null,c=contact?.data;
   if(!contact||contact.kind!=='contacts'||contact.id!==link.id||!Number.isSafeInteger(contact.revision)||contact.revision<0||contact.deleted!==false||!c||c.id!==link.id||c.deleted!==undefined&&c.deleted!==false||c.emailIdentityHeld||normalizeSourceEmail(c.email)!==linkedEmail||!Array.isArray(contact.emails)||contact.emails.length!==1||contact.emails[0]!==linkedEmail||!Array.isArray(c.roles)||c.roles.some(r=>!linkRoles.has(r))||!Array.isArray(c.tags)||c.tags.some(t=>!text(t?.name)))return null;
   if(candidates.has(link.id)||linkedEmail===email)related=true;
  }
 }
 return {related};
}
export function createMarketingHiveEligibility({services,now=()=>Date.now()}){
 return async email=>{
  try{
   const normalized=normalizeSourceEmail(email);
   if(!/^\S+@\S+\.\S+$/.test(normalized)||normalized.length>254)return held();
   const {store,cache}=await services(),before=now(),workTag=await clearBarriers(store);
   if(!workTag)return held();
   const snapshot=await cache.read(),s=snapshot.state;
   if(!snapshot.etag||s?.schema!==1)return held();
   for(const kind of ['contacts','inspections'])assertSourceAuthority(s,kind,{now:before,maxAgeMs:AGE});
   const ids=contactIdsForEmail(s,normalized);
   if(ids.length<1||ids.length>8)return held();
   let explicit=true,stop=false;
   for(const id of ids){
    const r=s.contacts[id],d=r?.data;
    if(r?.deleted||d?.deleted===true||r.id!==id||d?.id!==id||d.emailIdentityHeld||normalizeSourceEmail(d.email)!==normalized||!Array.isArray(r.emails)||r.emails.length!==1||r.emails[0]!==normalized||!Array.isArray(d.tags)||!Array.isArray(d.roles)||d.tags.some(t=>!text(t?.name))||d.roles.some(x=>!text(x)))return held();
    const tags=d.tags.map(t=>t.name.trim().toLowerCase());
    explicit&&=tags.includes('no business');
    stop||=tags.some(t=>businessTags.has(t))||d.roles.includes('Customer');
    // Unknown roles are not permission to enroll. Empty roles are explicitly OK.
    if(d.roles.some(r=>!businessRoles.has(r)))return held();
   }
   const idSet=new Set(ids);
   for(const r of Object.values(s.inspections)){
    const d=r?.data;
    if(r.deleted||d?.deleted===true)continue;
    if(!d||d.id!==r.id||!Array.isArray(d.contacts))return held();
    if(d.confirmed!==true||d.status!=='confirmed'||d.canceled_at!=null)continue;
    for(const link of d.contacts){
     if(!idSet.has(link?.id))continue;
     // Exact linked identity only; shared email on a different ID is not proof.
     if(normalizeSourceEmail(link.email)!==normalized||!businessRoles.has(link.role))return held();
     stop=true;
    }
   }
   const pending=pendingAssociation(s,workTag.pendingInspectionIds,ids,normalized);if(!pending)return held();
   const again=await cache.read(),workAgain=await clearBarriers(store),at=now();
   if(again.etag!==snapshot.etag||workAgain?.etag!==workTag.etag||at<before)return held();
   for(const kind of ['contacts','inspections'])assertSourceAuthority(s,kind,{now:at,maxAgeMs:AGE});
   // Positive exact-ID booking still stops NB; related polling never admits it.
   if(pending.related&&!stop)return held();
   return {eligible:explicit&&!stop&&!pending.related,stop,observedAt:at,contactIds:ids};
  }catch{return held();}
 };
}
// Positive source classifications only; this is invitation eligibility, never
// authorization for rewards, payments, or professional referral compensation.
export const REFERRAL_AGENT_TAGS=Object.freeze(['realtor','no business',...businessTags].filter(t=>t!=='client'));
export function createMarketingReferralHiveEligibility({services,now=()=>Date.now()}){
 return async email=>{try{
  const normalized=normalizeSourceEmail(email);if(!/^\S+@\S+\.\S+$/.test(normalized))return held();
  const {store,cache}=await services(),before=now(),barrier=await clearBarriers(store);if(!barrier)return held();
  const snapshot=await cache.read(),s=snapshot.state;if(!snapshot.etag||s?.schema!==1)return held();
  for(const kind of ['contacts','inspections'])assertSourceAuthority(s,kind,{now:before,maxAgeMs:AGE});
  const ids=contactIdsForEmail(s,normalized);if(ids.length<1||ids.length>8)return held();
  for(const id of ids){
   const r=s.contacts[id],d=r?.data;if(r?.deleted||d?.deleted===true||r.id!==id||d?.id!==id||d.emailIdentityHeld||normalizeSourceEmail(d.email)!==normalized||!Array.isArray(r.emails)||r.emails.length!==1||r.emails[0]!==normalized||!Array.isArray(d.tags)||!Array.isArray(d.roles)||d.tags.some(t=>!text(t?.name))||d.roles.some(x=>!businessRoles.has(x)))return held();
   const tags=d.tags.map(t=>t.name.trim().toLowerCase());
   if(d.roles.some(r=>r!=='Customer')||tags.some(t=>REFERRAL_AGENT_TAGS.includes(t))||(!d.roles.includes('Customer')&&!tags.includes('client')))return held();
  }
  const idSet=new Set(ids);
  for(const r of Object.values(s.inspections)){
   const d=r?.data;if(r.deleted||d?.deleted===true)continue;
   if(!d||d.id!==r.id||!Array.isArray(d.contacts))return held();
   for(const link of d.contacts)if(idSet.has(link?.id)){
    if(normalizeSourceEmail(link.email)!==normalized||link.role!=='Customer')return held();
   }
  }
  const pending=pendingAssociation(s,barrier.pendingInspectionIds,ids,normalized);if(!pending||pending.related)return held();
  const again=await cache.read(),barrierAgain=await clearBarriers(store),at=now();if(again.etag!==snapshot.etag||barrierAgain?.etag!==barrier.etag||at<before)return held();
  for(const kind of ['contacts','inspections'])assertSourceAuthority(s,kind,{now:at,maxAgeMs:AGE});
  return{eligible:true,stop:false,contactIds:ids,observedAt:at};
 }catch{return held();}};
}
