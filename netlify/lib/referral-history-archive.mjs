import {createHash} from 'node:crypto';
const norm=v=>typeof v==='string'?v.trim().toLowerCase():'';
const valid=v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
// Server-private, hash-bound historical evidence, not customer input. Positive
// history can disqualify automatically even when the archive cannot prove absence.
export function historicalClientLookup({readArchive}){
 return async({emails,before,currentInspectionId,sourceContactIds=[]})=>{
  const unknown=reason=>({complete:false,priorCustomer:null,reason});
  const at=Date.parse(before);if(!Array.isArray(emails)||!emails.length||emails.some(e=>!valid(e)||e!==norm(e))||!Number.isFinite(at))return unknown('Invalid exact-email history query');
  let archive;try{archive=await readArchive();}catch{return unknown('Historical archive unavailable');}
  if(archive?.version!==1||!Array.isArray(archive.records)||typeof archive.reference!=='string'||!archive.reference.trim()||archive.recordsSha256!==createHash('sha256').update(JSON.stringify(archive.records)).digest('hex'))return unknown('Historical archive integrity unverified');
  let unresolved=false,profileConflict=false;
  for(const row of archive.records){
   if(row.source_system!=='spectora'||row.role!=='Client')continue;
   const addresses=new Set([row.email_normalized_exact,...(Array.isArray(row.email_raw)?row.email_raw:[])].map(norm).filter(valid));
   const exactMatch=emails.some(e=>addresses.has(e));
   // Only an evidenced link to THIS source profile is a concrete conflict.
   // Names, addresses, candidate crosswalks and unknown legacy emails are not.
   const linked=Array.isArray(row.verified_profile_links)&&row.verified_profile_links.some(link=>link.verified===true&&typeof link.reference==='string'&&link.reference.trim()&&sourceContactIds.includes(link.sourceContactId));
   if(!exactMatch&&!linked)continue;
   if(currentInspectionId&&row.hive_inspection_candidates?.some(x=>x.id===currentInspectionId&&x.verified===true&&typeof x.reference==='string'&&x.reference.trim()))continue;
   if(row.source_current_status?.canceled===true)continue;
   if(!exactMatch){profileConflict=true;continue;}
   // A date-only historical export is never converted into a fabricated event
   // time. Require the WHOLE possible local day to predate this booking.
   const date=row.appointment_date_local;
   const end=typeof date==='string'&&/^\d{4}-\d\d-\d\d$/.test(date)?Date.parse(date+'T23:59:59.999-12:00'):NaN;
   if(row.source_current_status?.confirmed===true&&row.source_current_status?.canceled===false&&Number.isFinite(end)&&end<at)return {emails:[...emails],before,complete:false,priorCustomer:true,reference:archive.reference+':'+row.evidence_id};
   unresolved=true;
  }
  if(profileConflict)return unknown('Verified historical profile link requires review');
  if(unresolved)return unknown('Matching historical relationship date or status unresolved');
  const c=archive.coverage;
  // Coverage is a source-level certification, not per-referral manual approval.
  // This certifies all AVAILABLE exact emails, not every historical person.
  // Unknown emails/jobs are not conflicts with an unrelated email. They cannot
  // substitute for complete export/index ingestion or a verified source boundary.
  if(c?.verified!==true||c.scope!=='exact-email-index'||c.emailIndexComplete!==true||c.sourceBoundaryVerified!==true||!Number.isFinite(Date.parse(c.through))||Date.parse(c.through)<at||typeof c.reference!=='string'||!c.reference.trim())return unknown('Historical exact-email index coverage unverified');
  return {emails:[...emails],before,complete:true,coverageScope:'exact-email-index',globalPersonHistoryComplete:false,priorCustomer:false,reference:archive.reference+'; '+c.reference};
 };
}
