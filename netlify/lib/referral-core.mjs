export const TERMS_VERSION = '2026-09-30';
export const email = value => String(value ?? '').trim().toLowerCase();
export function validateSubmission(input) {
 const out = { ...input };
 for (const key of ['referrerName','friendName']) {
  if(typeof input[key] !== 'string' || !input[key].trim() || input[key].length > 100 || /[\r\n\x00-\x1f]/.test(input[key])) throw new Error('Invalid name');
  out[key] = input[key].trim();
 }
 for (const key of ['referrerEmail','friendEmail']) {
  out[key]=email(input[key]);
  if(out[key].length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out[key])) throw new Error('Invalid email');
 }
 if(out.referrerEmail===out.friendEmail) throw new Error('Self referral');
 for(const key of ['eligibility','permission','terms']) if(input[key] !== 'on' && input[key] !== true) throw new Error('Consent required');
 if(!/^[a-f0-9-]{36}$/i.test(input.idempotencyKey ?? '')) throw new Error('Request ID required');
 return {referrerName:out.referrerName,referrerEmail:out.referrerEmail,friendName:out.friendName,friendEmail:out.friendEmail,idempotencyKey:input.idempotencyKey,termsVersion:TERMS_VERSION};
}
export function plusMonths(iso, months) {
 const d = new Date(iso), day=d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth()+months);
 const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate(); d.setUTCDate(Math.min(day,last)); return d.toISOString();
}
export function eligible(referral, clients, exclusions) {
 const address=email(referral['Referrer Email']);
 if(exclusions.some(c=>email(c.Email)===address)) return {state:'INELIGIBLE',reason:'Excluded referrer'};
 const matches=clients.filter(c=>email(c.Email)===address && String(c['Past Client Verified']).toUpperCase()==='YES');
 if(matches.length!==1)return {state:'PENDING',reason:'Past-client verification required'};
 if(clients.some(c=>email(c.Email)===email(referral['Friend Email']) && String(c['Past Client Verified']).toUpperCase()==='YES'))return {state:'INELIGIBLE',reason:'Friend is an existing client'};
 return {state:'ELIGIBLE',reason:''};
}
export function applyInspection(referral, inspection, now = new Date().toISOString()) {
 const r={...referral};
 if(!inspection.emails.includes(email(r['Friend Email']))) return {...r,'Hold Reason':'Booking email mismatch'};
 if(r['Inspection ID'] && String(r['Inspection ID'])!==inspection.id) return {...r,'Hold Reason':'Multiple inspections require review'};
 r.Provider=inspection.provider;r['Inspection ID']=inspection.id;r['Last Verified At']=now;
 r['Booked At']=inspection.bookedAt;
 if(!inspection.bookedAt || new Date(inspection.bookedAt)<=new Date(r['Submitted At']))r['Hold Reason']='Referral must precede booking';
 else if(inspection.canceled) r['Hold Reason']='Inspection canceled or deleted';
 else if(!inspection.fullInspection)r['Hold Reason']='Full inspection service not verified';
 else if(r['New Client Verified']!=='YES')r['Hold Reason']='New-client check required';
 else if(!r['Completed At'] || !Number.isFinite(Date.parse(r['Completed At'])) || Date.parse(r['Completed At'])>Date.parse(now))r['Hold Reason']='Verify full inspection completion';
 else if(inspection.refunded || inspection.disputed)r['Hold Reason']='Refund or dispute detected';
 else if(r['Dispute Or Refund']!=='NO')r['Hold Reason']='Verify no refund or dispute';
 else r['Hold Reason']='';
 r['Service Verified']=inspection.fullInspection?'YES':'NO';
 // Use first observed paid time. It is conservative when no paid-at field exists.
 r['Paid At']=inspection.paid ? (r['Paid At'] || now) : '';
 r['Reward Due At']=r['Completed At'] && r['Paid At'] ? new Date(Math.max(Date.parse(r['Completed At']),Date.parse(r['Paid At']))+86400000).toISOString() : '';
 if(!['REWARD SENT','REDEEMED','EXPIRED'].includes(r.Status))r.Status=r['Completed At'] && r['Paid At']?'PAID':r['Completed At']?'COMPLETED':inspection.booked?'BOOKED':inspection.booked===false?'SUBMITTED':'BOOKED';
 return r;
}
export function rewardReady(r,now=Date.now()) {
 return r.Eligibility==='ELIGIBLE' && !r['Hold Reason'] && r['Service Verified']==='YES' && r['New Client Verified']==='YES' && r['Dispute Or Refund']==='NO' && !!r['Completed At'] && !!r['Paid At'] && !!r['Reward Due At'] && Date.parse(r['Reward Due At'])<=now && Date.parse(r['Last Verified At'])<=now && now-Date.parse(r['Last Verified At'])<300000 && !r['Reward ID'] && !r['Reward State'];
}
