import {assessReferralIdentity} from './referral-identity-evidence.mjs';
const norm=v=>typeof v==='string'?v.trim().toLowerCase():'';
const idOK=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v);
const contactRoles=new Set(['Customer','Buyer Agent','Listing Agent','Sub Contractor','Insurance Agent','Lender','Builder','Transaction Coordinator','Attorney','Title Company','Others']);
const referenceOK=v=>typeof v==='string'&&!!v.trim();
export function sourceTimestampOK(value){
 if(typeof value!=='string')return false;
 const m=/^(\d{4}-\d\d-\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.exec(value);
 if(!m||Number(m[2])>23||Number(m[3])>59||Number(m[4])>59)return false;
 const day=Date.parse(m[1]+'T00:00:00Z');
 return Number.isFinite(day)&&new Date(day).toISOString().slice(0,10)===m[1];
}
function scheduledTime(row,hiveMigrated){
 const scheduled=Date.parse(row.scheduled_for),legacy=Date.parse(row.starts_at);
 // Hive's documented date is scheduled_for. Do not manufacture a timestamp
 // from a date-only export or silently choose between conflicting source dates.
 if(hiveMigrated&&(!sourceTimestampOK(row.scheduled_for)||!Number.isFinite(scheduled)))return NaN;
 if(row.scheduled_for!=null&&!Number.isFinite(scheduled))return NaN;
 if(row.starts_at!=null&&!Number.isFinite(legacy))return NaN;
 if(Number.isFinite(scheduled)&&Number.isFinite(legacy)&&scheduled!==legacy)return NaN;
 return Number.isFinite(scheduled)?scheduled:legacy;
}
// Bounded, read-only, fully paginated. Reaching a budget is unknown, never new.
export async function customerHistory({read,email,sourceContactIds,verifiedAliases=[],sharedEmailEvidence,sourceConflictEvidence,currentInspectionId,before,coverage={},legacyLookup=async()=>null,maxPages=20,maxContacts=50}){
 const unknown=reason=>({newClient:null,reason});
 if(!coverage||typeof coverage!=='object'||Array.isArray(coverage))return unknown('Historical source mode unverified');
 const hiveMigrated=coverage.sourceMode==='hive-migrated';
 if(Object.hasOwn(coverage,'sourceMode')&&!hiveMigrated&&coverage.sourceMode!=='current-plus-legacy')return unknown('Historical source mode unverified');
 const identity=assessReferralIdentity({email,sourceContactIds,verifiedAliases,sharedEmailEvidence,sourceConflictEvidence});
 if(identity.status!=='usable-exact-identifier')return unknown(identity.reason);
 const cutoff=Date.parse(before);if(!Number.isFinite(cutoff)||(hiveMigrated&&!sourceTimestampOK(before))||!idOK(currentInspectionId))return unknown('Booking cutoff or current inspection missing');
 let pages=0;const contactIds=new Set(identity.sourceContactIds);let unresolved=false;
 if(!Number.isSafeInteger(maxContacts)||maxContacts<1||contactIds.size>maxContacts)return unknown('Contact budget reached');
 if(!Number.isSafeInteger(maxPages)||maxPages<1)return unknown('History page budget reached');
 async function all(path,consume){let cursor=null,total=null,count=0;const seen=new Set(),ids=new Set();do{
  if(++pages>maxPages)throw Error('History page budget reached');
  const url=new URL(path,'https://local.invalid/');if(cursor)url.searchParams.set('cursor',cursor);
  const page=await read(url.pathname.slice(1)+url.search);
  if(!Array.isArray(page?.data)||!Object.hasOwn(page,'next_cursor')||(page.next_cursor!==null&&(typeof page.next_cursor!=='string'||!page.next_cursor))||!Number.isSafeInteger(page.total)||page.total<0||(total!==null&&total!==page.total))throw Error('Invalid or changing history coverage');
  total=page.total;
  for(const row of page.data){if(!idOK(row?.id)||ids.has(row.id))throw Error('Duplicate history identity');ids.add(row.id);count++;await consume(row);}
  if(count>total)throw Error('History count exceeded');
  const next=page.next_cursor;if(next&&seen.has(next))throw Error('Repeated cursor');if(next)seen.add(next);cursor=next;
 }while(cursor);if(count!==total)throw Error('History count incomplete');}
 try{
  for(const address of identity.dedupEmails){await all('contacts?'+new URLSearchParams({email:address,limit:'200'}),row=>{if(!idOK(row.id)||norm(row.email)!==address)throw Error('Exact contact lookup mismatch');contactIds.add(row.id);if(contactIds.size>maxContacts)throw Error('Contact budget reached')})}
  const seenInspections=new Map();let prior=false;
  for(const id of contactIds){if(!idOK(id))throw Error('Invalid source contact');await all('inspections?'+new URLSearchParams({contact_id:id,include_canceled:'true',include_deleted:'true',limit:'200'}),row=>{
   if(!idOK(row.id)||!Array.isArray(row.contacts))throw Error('Incomplete inspection history');
   if(row.contacts.some(c=>!c||!idOK(c.id)||!contactRoles.has(c.role)))throw Error('Malformed inspection contact');
   const relationships=row.contacts.filter(c=>c?.id===id);
   if(relationships.length!==1||relationships.some(c=>!contactRoles.has(c.role)))throw Error('Client-role history mismatch');
   if(row.id===currentInspectionId)return;
   const fingerprint=JSON.stringify([row.status,row.confirmed,row.scheduled_for,row.starts_at,row.canceled_at,row.deleted,row.contacts.map(c=>[c.id,c.role,c.email??null]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]);
   if(seenInspections.has(row.id)){
    if(seenInspections.get(row.id)!==fingerprint)throw Error('Conflicting inspection history');
   }
   seenInspections.set(row.id,fingerprint);
   // contact_id returns every role. A verified non-Customer relationship is
   // not prior client business; do not treat a valid buyer-agent row as a lookup failure.
   if(!relationships.some(c=>c.role==='Customer'))return;
   // Canceled/deleted records do not establish a completed customer relationship.
   // Their omission is separately a coverage issue; ambiguous lifecycle stays held.
   if(hiveMigrated&&row.canceled_at!=null&&(!sourceTimestampOK(row.canceled_at)||!Number.isFinite(Date.parse(row.canceled_at)))){unresolved=true;return;}
   if(row.status==='canceled'||row.canceled_at||row.deleted===true)return;
   const starts=scheduledTime(row,hiveMigrated);if(!Number.isFinite(starts)){unresolved=true;return;}
   if(starts<cutoff){if(row.status==='confirmed'&&row.confirmed===true)prior=true;else unresolved=true;}
  })}
  if(prior)return {newClient:false,reason:'Prior confirmed client inspection',sourceContactIds:[...contactIds]};
  if(hiveMigrated){
   if(unresolved)return unknown('Prior inspection lifecycle or date unresolved');
   if(coverage.exactEmailLookupVerified!==true||coverage.currentHistoryComplete!==true||coverage.scope!=='exact-email-index'||!sourceTimestampOK(coverage.through)||!Number.isFinite(Date.parse(coverage.through))||Date.parse(coverage.through)<cutoff||coverage.deletedBehaviorVerified!==true||!referenceOK(coverage.reference))return unknown('Current source coverage unverified');
   // Source-level migration evidence, not a manual approval for each referral.
   // A successful bounded lookup does not itself certify migration completeness.
   if(coverage.historicalMigrationVerified!==true||!referenceOK(coverage.migrationReference))return unknown('Hive historical migration coverage unverified');
   return {newClient:true,coverageScope:'exact-email-index',globalPersonHistoryComplete:false,reason:'No prior customer within verified migrated Hive exact-email history',sourceContactIds:[...contactIds],evidenceReference:coverage.reference+'; '+coverage.migrationReference};
  }
  const legacy=await legacyLookup({emails:identity.dedupEmails,before:new Date(cutoff).toISOString(),currentInspectionId,sourceContactIds:[...contactIds]});
  const legacyBound=legacy?.before===new Date(cutoff).toISOString()&&Array.isArray(legacy.emails)&&JSON.stringify([...legacy.emails].sort())===JSON.stringify(identity.dedupEmails)&&typeof legacy.reference==='string'&&!!legacy.reference.trim();
  if(legacyBound&&legacy.priorCustomer===true)return {newClient:false,reason:'Prior verified legacy customer',evidenceReference:legacy.reference,sourceContactIds:[...contactIds]};
  if(unresolved)return unknown('Prior inspection lifecycle or date unresolved');
  if(coverage.exactEmailLookupVerified!==true||coverage.currentHistoryComplete!==true||coverage.scope!=='exact-email-index'||!Number.isFinite(Date.parse(coverage.through))||Date.parse(coverage.through)<cutoff||coverage.deletedBehaviorVerified!==true||typeof coverage.reference!=='string'||!coverage.reference.trim())return unknown('Current source coverage unverified');
  if(!legacyBound||legacy.complete!==true||legacy.coverageScope!=='exact-email-index'||legacy.priorCustomer!==false)return unknown('Legacy source coverage unverified');
  return {newClient:true,coverageScope:'exact-email-index',globalPersonHistoryComplete:false,reason:'No prior customer within verified exact-email and source history',sourceContactIds:[...contactIds],evidenceReference:coverage.reference+'; '+legacy.reference};
 }catch{return unknown('History lookup incomplete or unavailable');}
}
