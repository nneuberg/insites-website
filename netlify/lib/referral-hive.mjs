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
export function hiveReader(env=process.env,fetcher=fetch,transport=null){
 if(!env.HIVE_API_KEY)throw Error('Hive connection missing');
 return async(path)=>{
  if(!/^inspections(?:\?|\/|$)/.test(path)&&!/^contacts\/stats\?/.test(path)&&!/^contacts\?/.test(path))throw Error('Unsupported read');
  const r=transport?await transport.request(path):await fetcher('https://api.hiveinspect.com/v1/'+path,{headers:{Authorization:'Bearer '+env.HIVE_API_KEY},signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw Error('Hive read failed ('+r.status+')');return r.json();
 };
}
// This adapter deliberately leaves facts absent from Hive's contract unknown.
// Legacy discovery inference only; NOT trusted claim completion evidence.
// Claim qualification requires the signed completion record or operator evidence.
// Record first observation rather than backdating publication to the scheduled end.
// paid is not refund/dispute clearance.
export function inspectionFacts(i,{serviceIds=[],now=Date.now(),previousUse=null}={}){
 if(!i||!idOK(i.id))throw Error('Invalid inspection');
 const clients=(i.contacts||[]).filter(c=>c.role==='Customer');
 const client=clients.length===1?clients[0]:null;
 const price=i.price||{};
 const paid=price.paid===true&&price.payment_status==='paid'&&finite(price.amount_due)&&price.amount_due===0&&finite(price.amount_paid)&&price.amount_paid>0;
 const codes=[...new Set((i.discount_codes||[]).map(c=>c.code).filter(c=>typeof c==='string').map(c=>c.trim().toUpperCase()))];
 const active=i.status==='confirmed'&&i.confirmed===true&&i.canceled_at===null&&i.deleted===false;
 const fullInspection=serviceIds.length?Array.isArray(i.services)&&i.services.some(s=>serviceIds.includes(s.id)):null;
 const completed=active&&i.reports?.status==='published'&&Number.isFinite(Date.parse(i.ends_at))&&Date.parse(i.ends_at)<=now;
 const previousMatches=previousUse?.['Hive Inspection ID']===i.id&&previousUse?.['Client ID']===client?.id&&codes.includes(previousUse?.Code);
 const priorCompletion=previousMatches?Date.parse(previousUse['Completed At']):NaN;
 const completedAt=completed?new Date(Number.isFinite(priorCompletion)&&priorCompletion>=Date.parse(i.ends_at)&&priorCompletion<=now?priorCompletion:now).toISOString():null;
 return {id:i.id,codes,serviceIds:Array.isArray(i.services)?i.services.map(s=>s.id).filter(idOK):[],clientId:client?.id||null,clientEmail:client?.email||null,bookedAt:i.created_at||null,endsAt:i.ends_at||null,paid,fullInspection,
  completed,completedAt,newClient:null,refunded:null,disputed:null,canceled:active?false:(i.status==='canceled'||i.deleted===true?true:null)};
}
export function matchReferral(i,snapshot,options={}){
 const old=(snapshot.uses||[]).find(u=>u['Hive Inspection ID']===i?.id);
 const facts=inspectionFacts(i,{...options,previousUse:old}),rows=snapshot.codes||[];
 const matches=rows.filter(c=>facts.codes.includes(c.Code)&&c['Assignment State']==='ASSIGNED'&&c['Hive State']==='VERIFIED');
 if(matches.length!==1)return {matched:false,inspectionId:facts.id,hold:old?'Existing code removed or attribution ambiguous':matches.length?'Multiple assigned referral codes':null};
 const owner=matches[0],holds=[];
 if(old&&(old.Code!==owner.Code||String(old['Client ID'])!==String(facts.clientId)))holds.push('Existing code or customer changed; review attribution');
 if(!facts.clientId||!facts.clientEmail)holds.push('Exactly one identified customer required');
 if(String(facts.clientEmail||'').trim().toLowerCase()===String(owner['Referrer Email']).trim().toLowerCase())holds.push('Self referral');
 if(!Number.isFinite(Date.parse(facts.bookedAt))||!Number.isFinite(Date.parse(owner['Assigned At']))||Date.parse(facts.bookedAt)<=Date.parse(owner['Assigned At']))holds.push('Code must precede booking');
 if(facts.canceled!==false)holds.push('Inspection inactive or cancellation unknown');
 if(facts.fullInspection!==true)holds.push('Full inspection service not verified');
 if(!facts.paid)holds.push('Full payment not verified');
 if(!facts.completed)holds.push('Published report and elapsed inspection end required');
 holds.push('New-client history not verified'); // Owner accepts Hive fully paid + 24h despite unavailable refund data.
 return {matched:true,inspectionId:facts.id,code:owner.Code,facts,holds,rewardReady:false};
}
export async function auditReferrals({read,snapshot,serviceIds=[],maxPages=5,pageSize=20,now=Date.now()}={}){
 const results=[],seen=new Set(),services=new Map();let cursor=null,pages=0;
 do{
  const query=new URLSearchParams({limit:String(pageSize)});if(cursor)query.set('cursor',cursor);
  const page=await read('inspections?'+query);
  if(!Array.isArray(page.data))throw Error('Invalid Hive list response');
  for(const item of page.data){
   if(!idOK(item.id))throw Error('Invalid inspection ID');if(seen.has(item.id))continue;seen.add(item.id);
   const detail=await read('inspections/'+encodeURIComponent(item.id));
   for(const service of detail.services||[])if(service.id&&service.name)services.set(service.id,service.name);
   const result=matchReferral(detail,snapshot,{serviceIds,now});
   if(result.matched||result.hold)results.push(result);
  }
  const next=page.next_cursor||null;if(next&&next===cursor)throw Error('Repeated Hive cursor');cursor=next;pages++;
 }while(cursor&&pages<maxPages);
 return {read:seen.size,pages,complete:!cursor,nextCursor:cursor,results,observedServices:[...services].map(([id,name])=>({id,name}))};
}
