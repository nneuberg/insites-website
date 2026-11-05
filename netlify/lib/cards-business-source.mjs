// Private card-only projection of already-authorized, validated GET pages. Never
// fetches Hive and never changes the shared normalized cache or other consumers.
import {normalizeListRecord} from './hive-source-sync.mjs';
import {assertSourceAuthority} from './hive-source-cache.mjs';
import {fingerprint} from './cards-core.mjs';
import {deriveCardOffice} from './cards-source.mjs';
export const CARD_BUSINESS_SOURCE_KEY='hive-card-business/v1';
const DAY=86400000,MAX_RECORDS=5000,MAX_BYTES=2000000;
const validId=v=>typeof v==='string'&&!['__proto__','constructor','prototype'].includes(v)&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const officeFields=['agency_id','agency_name','uses_agency_address','address','address_line2','city','state','zip','country','do_not_mail'];
const blocked=()=>{throw Error('card_business_source_unverified');};
function projection(raw,observedAt){
 const row=normalizeListRecord('contacts',raw);
 const record={id:row.id,revision:row.revision,baseFingerprint:fingerprint(row.data),observedAt,valid:false,reason:'office_source_unverified',fields:null};
 // Negative observations deliberately retain no address, name, email, or other
 // raw contact values, including a former office address after a link is lost.
 try{
  if(row.deleted||raw.do_not_mail!=null&&typeof raw.do_not_mail!=='boolean')throw Error('office_source_unverified');
  deriveCardOffice({contact:raw,now:observedAt});
  record.valid=true;record.reason=null;
  record.fields=Object.fromEntries(officeFields.filter(k=>Object.hasOwn(raw,k)).map(k=>[k,structuredClone(raw[k])]));
 }catch{/* A valid normalized contact with unusable office facts is a tombstone. */}
 return record;
}
export async function observeCardBusinessPage({store,rows,observedAt=Date.now()}){
 if(!Number.isSafeInteger(observedAt)||observedAt<0||!Array.isArray(rows)||rows.length>200||rows.some(r=>!validId(r?.id))||new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('card_business_page_invalid');
 // Validate the whole page before any write. The coordinator may isolate this
 // card-only observer failure; the view below checks the newer complete-contact
 // observation boundary so older business evidence cannot survive that failure.
 const incoming=rows.map(row=>projection(row,observedAt));
 for(let retry=0;retry<8;retry++){
  const previous=await store.getWithMetadata(CARD_BUSINESS_SOURCE_KEY,{type:'json'});
  const state=previous?structuredClone(previous.data):{schema:1,records:{},blocked:null};
  if(state.schema!==1||!state.records||typeof state.records!=='object'||Array.isArray(state.records)||state.blocked)throw Error('card_business_state_held');
  let changed=false;
  for(const next of incoming){
   const old=state.records[next.id];
   if(old&&(next.revision<old.revision||next.observedAt<old.observedAt))continue;
   if(old&&next.revision===old.revision&&next.observedAt===old.observedAt){
    if(fingerprint(old)===fingerprint(next))continue;
    // Conflicting observations with no temporal ordering cannot establish which
    // business address is current. A later actual GET may resolve the tombstone.
    state.records[next.id]={...next,valid:false,fields:null,reason:'office_observation_conflict'};changed=true;continue;
   }
   state.records[next.id]=next;changed=true;
  }
  if(!changed)return {status:'unchanged',observed:incoming.length};
  const capacity=Object.keys(state.records).length>MAX_RECORDS||Buffer.byteLength(JSON.stringify(state))>MAX_BYTES;
  const saved=capacity?{...(previous?.data||{schema:1,records:{}}),blocked:'capacity_hold'}:state;
  if((await store.setJSON(CARD_BUSINESS_SOURCE_KEY,saved,previous?{onlyIfMatch:previous.etag}:{onlyIfNew:true}))?.modified!==true)continue;
  if(capacity)throw Error('card_business_capacity_hold');
  return {status:'observed',observed:incoming.length,valid:incoming.filter(r=>r.valid).length};
 }
 throw Error('card_business_concurrent_retry');
}
export function createCardSourceView({view,cache,store,now=()=>Date.now()}){
 return {...view,
  async getContact(id){
   if(!validId(id))blocked();
   // Base view runs first: its global/contact pending-event and role barriers
   // remain authoritative, even if a business observation looks fresh.
   const base=await view.getContact(id),at=now(),{state}=await cache.read();
   assertSourceAuthority(state,'contacts',{now:at,maxAgeMs:DAY});
   const current=Object.hasOwn(state.contacts,id)?state.contacts[id]:null,accepted=state.contactObservations?.[id];
   const saved=(await store.getWithMetadata(CARD_BUSINESS_SOURCE_KEY,{type:'json'}))?.data;
   const office=saved?.schema===1&&!saved.blocked&&Object.hasOwn(saved.records||{},id)?saved.records[id]:null;
   if(!current||current.deleted||current.data?.id!==id||base?.id!==id||!accepted||!Number.isSafeInteger(accepted.observedAt)||accepted.observedAt<0||accepted.observedAt>at||accepted.revision!==current.revision||!Array.isArray(accepted.fields)||!accepted.fields.includes('complete-contact')||!office?.valid||!office.fields||!Number.isSafeInteger(office.observedAt)||office.observedAt>at||office.observedAt<accepted.observedAt||at-office.observedAt>DAY||office.id!==id||office.revision!==current.revision||office.baseFingerprint!==fingerprint(current.data)||office.baseFingerprint!==fingerprint(base))blocked();
   const contact={...structuredClone(base),...structuredClone(office.fields)};
   // Validate persisted projection again, not just a truthy marker in storage.
   deriveCardOffice({contact,now:at});
   return contact;
  }
 };
}
