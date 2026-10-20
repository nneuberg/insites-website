import {createHmac,timingSafeEqual} from 'node:crypto';
export const INSPECTION_EVENTS=new Set(['inspection.confirmed','inspection.rescheduled','inspection.canceled','inspection.published']);
const idOK=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v);
const finite=v=>typeof v==='number'&&Number.isFinite(v);
export function verifyHive(raw,headers,secret,now=Date.now()){
 const signature=headers.get('x-hiveinspect-signature')||'';
 const match=/^t=(\d+),v1=([a-f0-9]{64})$/.exec(signature);
 if(!secret||!match||Math.abs(now/1000-Number(match[1]))>300)throw Error('Unauthorized');
 const headerTime=headers.get('x-hiveinspect-timestamp');
 if(headerTime&&headerTime!==match[1])throw Error('Unauthorized');
 const expected=createHmac('sha256',secret).update(match[1]+'.').update(raw).digest();
 if(!timingSafeEqual(expected,Buffer.from(match[2],'hex')))throw Error('Unauthorized');
}
export function hiveReader(env=process.env,fetcher=fetch){
 if(!env.HIVE_API_KEY)throw Error('Hive connection missing');
 return async(path)=>{
  if(!/^inspections(?:\?|\/|$)/.test(path))throw Error('Unsupported read');
  const r=await fetcher('https://api.hiveinspect.com/v1/'+path,{headers:{Authorization:'Bearer '+env.HIVE_API_KEY},signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw Error('Hive read failed ('+r.status+')');return r.json();
 };
}
// This adapter deliberately leaves facts absent from Hive's contract unknown.
// ends_at is a scheduled end, not proof of actual completion. paid is not refund/dispute clearance.
export function inspectionFacts(i,{serviceIds=[],now=Date.now()}={}){
 if(!i||!idOK(i.id))throw Error('Invalid inspection');
 const clients=(i.contacts||[]).filter(c=>c.role==='Customer');
 const client=clients.length===1?clients[0]:null;
 const price=i.price||{};
 const paid=price.paid===true&&price.payment_status==='paid'&&finite(price.amount_due)&&price.amount_due===0&&finite(price.amount_paid)&&price.amount_paid>0;
 const codes=[...new Set((i.discount_codes||[]).map(c=>c.code).filter(c=>typeof c==='string').map(c=>c.trim().toUpperCase()))];
 const active=i.status==='confirmed'&&i.confirmed===true&&i.canceled_at===null&&i.deleted===false;
 const fullInspection=serviceIds.length?Array.isArray(i.services)&&i.services.some(s=>serviceIds.includes(s.id)):null;
 const completionCandidate=active&&i.reports?.status==='published'&&Number.isFinite(Date.parse(i.ends_at))&&Date.parse(i.ends_at)<=now;
 return {id:i.id,codes,clientId:client?.id||null,clientEmail:client?.email||null,bookedAt:i.created_at||null,paid,fullInspection,
  completed:null,completedAt:null,newClient:null,refunded:null,disputed:null,canceled:active?false:(i.status==='canceled'||i.deleted===true?true:null),completionCandidate};
}
export function matchReferral(i,snapshot,options={}){
 const facts=inspectionFacts(i,options),rows=snapshot.codes||[];
 const matches=rows.filter(c=>facts.codes.includes(c.Code)&&c['Assignment State']==='ASSIGNED'&&c['Hive State']==='VERIFIED');
 const old=(snapshot.uses||[]).find(u=>u['Hive Inspection ID']===facts.id);
 if(matches.length!==1)return {matched:false,inspectionId:facts.id,hold:old?'Existing code removed or attribution ambiguous':matches.length?'Multiple assigned referral codes':null};
 const owner=matches[0],holds=[];
 if(!facts.clientId||!facts.clientEmail)holds.push('Exactly one identified customer required');
 if(String(facts.clientEmail||'').trim().toLowerCase()===String(owner['Referrer Email']).trim().toLowerCase())holds.push('Self referral');
 if(!Number.isFinite(Date.parse(facts.bookedAt))||!Number.isFinite(Date.parse(owner['Assigned At']))||Date.parse(facts.bookedAt)<=Date.parse(owner['Assigned At']))holds.push('Code must precede booking');
 if(facts.canceled!==false)holds.push('Inspection inactive or cancellation unknown');
 if(facts.fullInspection!==true)holds.push('Full inspection service not verified');
 if(!facts.paid)holds.push('Full payment not verified');
 holds.push('Actual completion not verified','New-client history not verified','Refund/dispute clearance unavailable');
 return {matched:true,inspectionId:facts.id,code:owner.Code,facts,holds,rewardReady:false};
}
export async function auditReferrals({read,snapshot,serviceIds=[],maxPages=5,pageSize=20,now=Date.now()}={}){
 const results=[],seen=new Set();let cursor=null,pages=0;
 do{
  const query=new URLSearchParams({limit:String(pageSize)});if(cursor)query.set('cursor',cursor);
  const page=await read('inspections?'+query);
  if(!Array.isArray(page.data))throw Error('Invalid Hive list response');
  for(const item of page.data){
   if(!idOK(item.id))throw Error('Invalid inspection ID');if(seen.has(item.id))continue;seen.add(item.id);
   const detail=await read('inspections/'+encodeURIComponent(item.id));
   const result=matchReferral(detail,snapshot,{serviceIds,now});
   if(result.matched||result.hold)results.push(result);
  }
  const next=page.next_cursor||null;if(next&&next===cursor)throw Error('Repeated Hive cursor');cursor=next;pages++;
 }while(cursor&&pages<maxPages);
 return {read:seen.size,pages,complete:!cursor,nextCursor:cursor,results};
}
