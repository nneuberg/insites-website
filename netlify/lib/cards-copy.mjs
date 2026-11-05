// Source-grounded context only. This module never invents an interaction or drafts
// a rotating template; generation/review must use the verified source record.
export function copyGroundingIssue(snapshot,text){
 const p=snapshot?.personalization;
 if(p?.verified!==true||typeof p.evidence!=='string'||!p.evidence.trim()||p.inspectionId!==snapshot.inspectionId||p.agentId!==snapshot.agentId)return 'personalization_source_required';
 if(typeof text!=='string'||!text.trim())return 'message_required';
 if(/\binsites\b/i.test(text))return 'personal_first_person_required';
 if(!/\b(i|me|my)\b/i.test(text))return 'personal_first_person_required';
 const normalize=t=>t.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 const words=' '+normalize(text)+' ';
 if(![p.streetName,p.clientName].some(v=>typeof v==='string'&&v.trim()&&words.includes(' '+normalize(v)+' ')))return 'personal_reference_required';
 return null;
}
// Mask conventional references to catch a reused sentence with only the address
// or client swapped. This is a conservative guard, not a semantic originality claim.
export function copySkeleton(normalized){
 return normalized.replace(/\b(on|at) .+?(?=\b(?:i|it|thank|and|your|you|we)\b|$)/g,'$1 reference ').replace(/\b(helping|helped|help|working with) .+?(?=\b(?:and|i|it|your|you|we|with)\b|$)/g,'$1 person ').trim();
}
