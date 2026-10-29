import {assertSourceAuthority,contactIdsForEmail,normalizeSourceEmail} from './hive-source-cache.mjs';
export class HiveSourceDeferred extends Error {
 constructor(reason){super(reason);this.name='HiveSourceDeferred';this.code='HIVE_SOURCE_DEFERRED';this.status=503;}
}
const text=value=>typeof value==='string'&&value.trim()!=='';
const own=(map,id)=>map&&Object.hasOwn(map,id)?map[id]:null;
const defer=reason=>{throw new HiveSourceDeferred(reason);};
// Cache-only read boundary. Never falls back to Hive. All adapters retain full
// source records in row.data; absent fields are not filled with optimistic defaults.
export function createSourceView({cache,now=()=>Date.now(),maxAgeMs=86400000,invalidatedIds=new Set(),invalidatedInspectionIds=new Set()}){
 async function snapshot(kind,age=maxAgeMs,requireHistory=false){
  const {state}=await cache.read();
  try{assertSourceAuthority(state,kind,{now:now(),maxAgeMs:age,requireHistory});}catch{defer('Fresh complete '+kind+' source required');}
  return state;
 }
 async function barriers(){const ids=typeof invalidatedIds==='function'?await invalidatedIds():invalidatedIds;if(!(ids instanceof Set))defer('Role invalidation state unavailable');return ids;}
 function contact(state,id,invalid){
  const target=own(state.contacts,id);if(!target||target.deleted)defer('Contact missing or deleted');
  const related=new Set([id]),emails=new Set(target.emails);
  // Exact-email connections only; never names, spelling similarity or fuzzy matching.
  for(const email of emails)for(const match of contactIdsForEmail(state,email)){
   if(!related.has(match)){related.add(match);for(const nextEmail of state.contacts[match].emails)emails.add(nextEmail);}
  }
  const tags=new Map(),roles=new Set();
  for(const relatedId of related){
   if(invalid.has(relatedId))defer('Contact roles await inspection-link refresh');
   const row=own(state.contacts,relatedId),data=row?.data;
   if(row?.deleted||data?.id!==relatedId||!Array.isArray(data.tags)||!Array.isArray(data.roles)||data.roles.some(r=>!text(r))||data.tags.some(t=>!t||!text(t.name)))defer('Incomplete full contact source');
   for(const tag of data.tags){const key=tag.name.trim().toLowerCase();if(!tags.has(key))tags.set(key,structuredClone(tag));}
   for(const role of data.roles)roles.add(role);
  }
  return {...structuredClone(target.data),tags:[...tags.values()],roles:[...roles]};
 }
 async function contacts(age){const state=await snapshot('contacts',age),invalid=await barriers();return Object.values(state.contacts).filter(r=>!r.deleted).map(r=>contact(state,r.id,invalid));}
 return {
  authoritativeFreshContacts:contacts,
  listAllContacts:contacts,
  async getContact(id){const state=await snapshot('contacts');return contact(state,id,await barriers());},
  async getInspection(id){
   const invalid=typeof invalidatedInspectionIds==='function'?await invalidatedInspectionIds():invalidatedInspectionIds;
   if(!(invalid instanceof Set)||invalid.has(id))defer('Inspection awaits source refresh');
   const state=await snapshot('inspections'),row=own(state.inspections,id);
   if(!row||row.deleted||row.data?.id!==id)defer('Inspection missing or deleted');
   return structuredClone(row.data);
  },
  async fullHistoryForEmail(email){
   const invalid=typeof invalidatedInspectionIds==='function'?await invalidatedInspectionIds():invalidatedInspectionIds;
   if(!(invalid instanceof Set)||invalid.size)defer('Inspection history awaits source refresh');
   const normalized=normalizeSourceEmail(email);if(!/^\S+@\S+\.\S+$/.test(normalized))defer('Exact email required');
   // historyComplete is explicit verified migration evidence; API inspection seed
   // alone does not cover imported PastInspections and must never set it implicitly.
   const state=await snapshot('inspections',maxAgeMs,true),matches=[];
   for(const row of Object.values(state.inspections)){
    if(row.deleted)continue;
    if(row.data?.id!==row.id||!Array.isArray(row.data.contacts)||row.data.contacts.some(c=>!c||!text(c.email)))defer('Incomplete inspection identity history');
    if(row.data.contacts.some(c=>normalizeSourceEmail(c.email)===normalized))matches.push(structuredClone(row.data));
   }
   return matches;
  }
 };
}
