import {createHash} from 'node:crypto';
import {verifyHive} from './referral-hive.mjs';

// API webhooks only. This must not replace the separate Automation receiver.
export const SOURCE_EVENTS=Object.freeze([
 'inspection.confirmed','inspection.rescheduled','inspection.canceled',
 'inspection.published','inspection.paid','inspection.agreements_signed',
 'inspection.completed','contact.created','contact.updated','contact.deleted'
]);
const allowed=new Set(SOURCE_EVENTS);
const idOK=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const timestamp=v=>typeof v==='string'&&/(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v));
// Names/email/identity/tags and inspection facts are needed by downstream rules.
// Exclude unrelated free text, media, phone and personal-profile fields.
const omitted=new Set(['notes','photo_url','phone','cc_email','birthday','social','website','license_number','credentials']);
const minimize=value=>Array.isArray(value)?value.map(minimize):object(value)?Object.fromEntries(Object.entries(value).filter(([key])=>!omitted.has(key)).map(([key,v])=>[key,minimize(v)])):value;
const hash=value=>createHash('sha256').update(value).digest('hex');
async function rawBody(request,maxBytes){
 const length=request.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>maxBytes))throw Error('size');
 const reader=request.body?.getReader();if(!reader)throw Error('body');
 let size=0;const parts=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw Error('size');}parts.push(value);}}
 finally{reader.releaseLock();}
 return Buffer.concat(parts);
}

// Caller must provide PRIVATE durable storage with conditional-create support.
// No eligibility, card issuance, emails or Hive requests occur in this receiver.
export function createHiveSourceWebhook({store,secret,organizationId,enabled=false,now=()=>Date.now(),maxBytes=262144}={}){
 return async request=>{
  if(request.method!=='POST')return new Response(null,{status:405});
  if(enabled!==true||!secret||!idOK(organizationId)||typeof store?.setJSON!=='function'||typeof store?.get!=='function')return new Response(null,{status:503});
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))return new Response(null,{status:415});
  let raw;try{raw=await rawBody(request,maxBytes);}catch(error){return new Response(null,{status:error.message==='size'?413:400});}
  try{
   if(!request.headers.get('x-hiveinspect-timestamp'))throw Error('timestamp');
   verifyHive(raw,request.headers,secret,now());
  }catch{return new Response(null,{status:401});}
  let event;try{event=JSON.parse(raw.toString('utf8'));}catch{return new Response(null,{status:400});}
  if(!object(event)||!idOK(event.id)||!allowed.has(event.event)||event.api_version!=='v1'||!idOK(event.organization?.id)||!timestamp(event.fired_at)||!object(event.data)||
    event.id!==request.headers.get('x-hiveinspect-event-id')||event.event!==request.headers.get('x-hiveinspect-event')||
    Object.hasOwn(event,'test')&&typeof event.test!=='boolean')return new Response(null,{status:400});
  if(event.organization.id!==organizationId)return new Response(null,{status:403});
  const kind=event.event.startsWith('contact.')?'contact':'inspection';
  if(!object(event.data[kind])||!idOK(event.data[kind].id))return new Response(null,{status:400});
  // Provider test delivery must never enter a production data/eligibility queue.
  if(event.test===true)return new Response(null,{status:204});
  const digest=hash(raw),identity=hash(organizationId+':'+event.id),key='hive-source-events/pending/'+identity,receiptKey='hive-source-event-receipts/'+identity;
  const row={schema:1,eventId:event.id,event:event.event,organizationId,apiVersion:event.api_version,firedAt:event.fired_at,
   receivedAt:now(),state:'pending',attempts:0,digest,data:minimize(event.data)};
  try{
   const receipt=await store.get(receiptKey,{type:'json'});
   if(receipt)return new Response(null,{status:receipt.schema===1&&receipt.eventId===event.id&&receipt.organizationId===organizationId&&receipt.digest===digest?200:409});
   const saved=await store.setJSON(key,row,{onlyIfNew:true});
   if(saved?.modified===true)return new Response(null,{status:202});
   // A failed conditional create is not itself proof of a durable duplicate.
   const old=await store.get(key,{type:'json'});
   if(old?.schema===1&&old.eventId===event.id&&old.organizationId===organizationId&&old.digest===digest)return new Response(null,{status:200});
   if(old)return new Response(null,{status:409});
   return new Response(null,{status:503});
  }catch{return new Response(null,{status:503});}
 };
}
