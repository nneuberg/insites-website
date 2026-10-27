import {assessReferralIdentity} from './referral-identity-evidence.mjs';
const norm=v=>typeof v==='string'?v.trim().toLowerCase():'';
const idOK=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v);
// Bounded, read-only, fully paginated. Reaching a budget is unknown, never new.
export async function customerHistory({read,email,sourceContactIds,verifiedAliases=[],sharedEmailEvidence,sourceConflictEvidence,currentInspectionId,before,coverage={},legacyLookup=async()=>null,maxPages=20,maxContacts=50}){
 const unknown=reason=>({newClient:null,reason});
 const identity=assessReferralIdentity({email,sourceContactIds,verifiedAliases,sharedEmailEvidence,sourceConflictEvidence});
 if(identity.status!=='usable-exact-identifier')return unknown(identity.reason);
 const cutoff=Date.parse(before);if(!Number.isFinite(cutoff)||!idOK(currentInspectionId))return unknown('Booking cutoff or current inspection missing');
 let pages=0;const contactIds=new Set(identity.sourceContactIds);let unresolved=false;
 async function all(path,consume){let cursor=null;const seen=new Set();do{if(++pages>maxPages)throw Error('History page budget reached');const url=new URL(path,'https://local.invalid/');if(cursor)url.searchParams.set('cursor',cursor);const page=await read(url.pathname.slice(1)+url.search);if(!Array.isArray(page?.data))throw Error('Invalid history page');for(const row of page.data)await consume(row);const next=page.next_cursor;if(next!==null&&next!==undefined&&typeof next!=='string')throw Error('Invalid cursor');if(next&&seen.has(next))throw Error('Repeated cursor');if(next)seen.add(next);cursor=next||null;}while(cursor)}
 try{
  for(const address of identity.dedupEmails){await all('contacts?'+new URLSearchParams({email:address,limit:'200'}),row=>{if(!idOK(row.id)||norm(row.email)!==address)throw Error('Exact contact lookup mismatch');contactIds.add(row.id);if(contactIds.size>maxContacts)throw Error('Contact budget reached')})}
  const seenInspections=new Set();let prior=false;
  for(const id of contactIds){if(!idOK(id))throw Error('Invalid source contact');await all('inspections?'+new URLSearchParams({contact_id:id,include_canceled:'true',include_deleted:'true',limit:'200'}),row=>{
   if(!idOK(row.id)||!Array.isArray(row.contacts))throw Error('Incomplete inspection history');
   if(!row.contacts.some(c=>c.id===id&&c.role==='Customer'))throw Error('Client-role history mismatch');
   if(row.id===currentInspectionId||seenInspections.has(row.id))return;seenInspections.add(row.id);
   // Canceled/deleted records do not establish a completed customer relationship.
   // Their omission is separately a coverage issue; ambiguous lifecycle stays held.
   if(row.status==='canceled'||row.canceled_at||row.deleted===true)return;
   const starts=Date.parse(row.starts_at);if(!Number.isFinite(starts)){unresolved=true;return;}
   if(starts<cutoff){if(row.status==='confirmed'&&row.confirmed===true)prior=true;else unresolved=true;}
  })}
  if(prior)return {newClient:false,reason:'Prior confirmed client inspection',sourceContactIds:[...contactIds]};
  const legacy=await legacyLookup({emails:identity.dedupEmails,before:new Date(cutoff).toISOString()});
  const legacyBound=legacy?.before===new Date(cutoff).toISOString()&&Array.isArray(legacy.emails)&&JSON.stringify([...legacy.emails].sort())===JSON.stringify(identity.dedupEmails)&&typeof legacy.reference==='string'&&!!legacy.reference.trim();
  if(legacyBound&&legacy.priorCustomer===true)return {newClient:false,reason:'Prior verified legacy customer',evidenceReference:legacy.reference,sourceContactIds:[...contactIds]};
  if(unresolved)return unknown('Prior inspection lifecycle or date unresolved');
  if(coverage.exactEmailLookupVerified!==true||coverage.currentHistoryComplete!==true||coverage.deletedBehaviorVerified!==true||typeof coverage.reference!=='string'||!coverage.reference.trim())return unknown('Current source coverage unverified');
  if(!legacyBound||legacy.complete!==true||legacy.priorCustomer!==false)return unknown('Legacy source coverage unverified');
  return {newClient:true,reason:'No prior customer within verified exact-email and source history',sourceContactIds:[...contactIds],evidenceReference:coverage.reference+'; '+legacy.reference};
 }catch{return unknown('History lookup incomplete or unavailable');}
}
