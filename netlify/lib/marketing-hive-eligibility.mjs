import {assertSourceAuthority,contactIdsForEmail,normalizeSourceEmail} from './hive-source-cache.mjs';
// OFF integration adapter: cache/receipt reads only. Explicit native No Business
// is positive classification evidence, NOT proof inferred from absent history.
const AGE=86400000;
const businessTags=new Set(['1st time buying agent','absent buying agent','repeat buying agent','super buying agent','vip buying agent','new selling agent','absent selling agent','repeat selling agent','client']);
const businessRoles=new Set(['Customer','Buyer Agent','Listing Agent']);
const text=x=>typeof x==='string'&&x.trim().length>0;
const held=()=>({eligible:false,stop:false,observedAt:null,contactIds:[]});
async function clearBarriers(store){
 const found=await store.getWithMetadata('hive-source-work/v1',{type:'json'}),w=found?.data;
 if(!found?.etag||w?.schema!==1||w.globalRoleDirty!==false||w.roleMappingUnknown!==false)return null;
 for(const k of ['pendingInspectionIds','refreshContactIds','invalidatedContactIds','invalidatedInspectionIds'])if(!Array.isArray(w[k])||w[k].length)return null;
 // Even an unparsed pending receipt is uncertainty. Do not rely on the view's
 // once-per-invocation memoized barrier when checking again before admission.
 for await(const page of store.list({prefix:'hive-source-events/pending/',paginate:true})){
  if(!Array.isArray(page.blobs)||page.blobs.length)return null;
 }
 return found.etag;
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
   const again=await cache.read(),workAgain=await clearBarriers(store),at=now();
   if(again.etag!==snapshot.etag||workAgain!==workTag||at<before)return held();
   for(const kind of ['contacts','inspections'])assertSourceAuthority(s,kind,{now:at,maxAgeMs:AGE});
   return {eligible:explicit&&!stop,stop,observedAt:at,contactIds:ids};
  }catch{return held();}
 };
}
