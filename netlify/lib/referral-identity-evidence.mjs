// Local-only assessment. Email is a practical identifier, not proof of global person uniqueness.
const normalize=v=>typeof v==='string'?v.trim().toLowerCase():'';
const valid=v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
export function assessReferralIdentity({email,sourceContactIds=[],verifiedAliases=[],sharedEmailEvidence=null,sourceConflictEvidence=null,lookalikes=[]}){
 const primaryEmail=normalize(email);
 if(!valid(primaryEmail)||!Array.isArray(sourceContactIds)||!sourceContactIds.length||sourceContactIds.some(id=>typeof id!=='string'||!id.trim()))return {status:'held',reason:'Exact email and source contact reference required'};
 const concrete=e=>e?.verified===true&&typeof e.reference==='string'&&!!e.reference.trim();
 if(concrete(sharedEmailEvidence)||concrete(sourceConflictEvidence))return {status:'held',reason:'Concrete shared-email or source-identity conflict requires review'};
 const emails=new Set([primaryEmail]),references=[];
 for(const a of verifiedAliases){
  // Proposed/fuzzy aliases never change identity, deduplication or eligibility.
  if(!concrete(a))continue;
  const address=normalize(a.email);
  if(!valid(address))return {status:'held',reason:'Verified alias evidence malformed'};
  emails.add(address);references.push(a.reference);
 }
 return {status:'usable-exact-identifier',primaryEmail,sourceContactIds:[...new Set(sourceContactIds)],dedupEmails:[...emails].sort(),aliasEvidenceReferences:references,globalPersonUniquenessProven:false,informationalLookalikeCount:Array.isArray(lookalikes)?lookalikes.length:0};
}
