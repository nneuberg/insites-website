export const DAY=86400000;
export const REMINDER_DAYS=[0,3,7];
export const REVIEW_CADENCE_VERSION='review-037-referral-2-v1';
export const ORIGIN='https://www.insites.services';
export const GOOGLE_REVIEW='https://g.page/r/Cdo4F8EN0UmwEAE/review';
export const AUDIENCES={Customer:'8f8749ba24',Agent:'3ebb3017d4'};
export function eligibleRecipients(i,now=Date.now()){
 if(!i||i.deleted||i.canceled_at||i.status==='canceled'||i.confirmed!==true)return [];
 const end=Date.parse(i.ends_at||'');
 if(!Number.isFinite(end)||end>now||i.price?.paid!==true||i.price?.amount_due!==0||i.agreements?.all_signed!==true||i.reports?.status!=='published')return [];
 if(typeof i.id!=='string'||!i.address?.full||!Array.isArray(i.contacts))return [];
 const isAgent=c=>['Buyer Agent','Seller Agent','Listing Agent','Agent'].includes(c.role);
 const agents=new Set(i.contacts.filter(isAgent).map(c=>String(c.email||'').trim().toLowerCase())),seen=new Set();
 return i.contacts.flatMap(c=>{
  const email=String(c.email||'').trim().toLowerCase(),role=agents.has(email)?'Agent':c.role==='Customer'?'Customer':null;
  const name=[c.first_name,c.last_name].filter(Boolean).join(' ').trim();
  if(!role||!name||!c.id||!/^\S+@\S+\.\S+$/.test(email)||seen.has(email))return [];
  seen.add(email);return [{inspectionId:i.id,contactId:c.id,email,name,role,address:i.address.full,endedAt:end}];
 });
}
export function referralDates(endedAt){
 const p=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(endedAt));
 const n=k=>Number(p.find(x=>x.type===k).value),invite=new Date(Date.UTC(n('year'),n('month')-1,n('day')+2));
 const six=new Date(Date.UTC(invite.getUTCFullYear(),invite.getUTCMonth()+6,1));
 six.setUTCDate(Math.min(invite.getUTCDate(),new Date(Date.UTC(six.getUTCFullYear(),six.getUTCMonth()+1,0)).getUTCDate()));
 const fmt=d=>`${String(d.getUTCMonth()+1).padStart(2,'0')}/${String(d.getUTCDate()).padStart(2,'0')}/${d.getUTCFullYear()}`;
 return {REVREF2:fmt(invite),REVREF6:fmt(six)};
}
export function dueStage(row,now){
 if(row.cadenceVersion===REVIEW_CADENCE_VERSION){
  if(row.deliveryHold||row.ratedAt||row.googleReviewedAt||row.endedAt||now>=row.expiresAt)return null;
  if(row.preparingStage!==undefined)return [0,1,2].includes(row.preparingStage)?row.preparingStage:null;
  const done=row.sentStages||[],next=[0,1,2].find(n=>!done.includes(n));
  if(next===undefined||done.some(n=>n>next))return null;
  if(next===0)return now>=row.createdAt?0:null;
  const start=row.stageSentAt?.[0],previous=row.stageSentAt?.[next-1];
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(previous))return null;
  return now>=Math.max(start+REMINDER_DAYS[next]*DAY,previous+[0,3,4][next]*DAY)?next:null;
 }

 // Historical tag-stage records have no reliable field-enrollment timestamps.
 // Never replay them or guess timing during a projection migration.
 if(row.cadenceVersion!=='weekly-v1'||row.deliveryHold)return null;
 if(row.legacyNotBefore!==undefined&&(!Number.isSafeInteger(row.legacyNotBefore)||now<row.legacyNotBefore))return null;
 if((row.sentStages||[]).length){
  // One worker interval beyond 168h avoids the usual after-exit re-entry race;
  // this latency margin is not proof of Mailchimp exit or email delivery.
  if(row.lastStageQueuedAt!==undefined){if(!Number.isSafeInteger(row.lastStageQueuedAt)||now<row.lastStageQueuedAt||now-row.lastStageQueuedAt<7*DAY+15*60*1000)return null;}
  else if(row.legacyMigrationVersion!=='review-fields-v1'||!Number.isSafeInteger(row.legacyNotBefore))return null;
 }
 if(row.ratedAt||row.googleReviewedAt||row.endedAt||now>=row.expiresAt)return null;
 // Reconcile the exact in-flight signal before considering a later stage.
 if(row.preparingStage!==undefined)return Number.isInteger(row.preparingStage)&&row.preparingStage>=0&&row.preparingStage<=2?row.preparingStage:null;
 // Preserve legacy calendar eligibility, not its former send cadence. The
 // explicit cutover hold and dated handoff cooldown above still require 7 days.
 if(row.legacyMigrationVersion==='review-fields-v1'){
  const legacyDays=[0,3,7],next=legacyDays.findIndex((_,index)=>!(row.sentStages||[]).includes(index));
  return next>=0&&now>=row.createdAt+legacyDays[next]*DAY?next:null;
 }
 // After an outage send only the latest due request, not several catch-up emails.
 for(let index=2;index>=0;index--)if(now>=row.createdAt+[0,7,14][index]*DAY&&!(row.sentStages||[]).includes(index))return index;
 return null;
}
export const validToken=t=>typeof t==='string'&&/^[a-f0-9]{48}$/.test(t);
export const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function googleReviewTiming(row){
 const confirmedAt=row.googleReviewedAt,occurredAt=Date.parse(row.googleReview?.createTime||'');
 if(!Number.isSafeInteger(confirmedAt)||confirmedAt<=0)return null;
 const exact=Number.isSafeInteger(occurredAt)&&occurredAt>0&&occurredAt>=row.createdAt&&occurredAt<=confirmedAt;
 return{confirmedAt,occurredAt:exact?occurredAt:confirmedAt,timingSource:exact?'verified_google_create_time':'confirmation_fallback'};
}
