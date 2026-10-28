import {createHash} from 'node:crypto';
import {verifySvix} from './referral-transport.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
const states={'email.sent':'accepted','email.delivered':'delivered','email.bounced':'bounced','email.complained':'complained','email.failed':'failed','email.suppressed':'suppressed','email.delivery_delayed':'accepted'};
const rank={pending:0,sending:0,'review-required':0,sent:1,accepted:1,delivered:2,failed:3,suppressed:4,bounced:5,complained:6};
// No order or send transport is available to this component. Store retains receipts permanently.
export function resendReceipts({store,vault,secret,enabled=false,now=()=>Date.now()}){
 return async(raw,headers)=>{
  if(!enabled||!vault||!secret)throw Error('Receipt intake disabled');
  if(Buffer.byteLength(raw)>65536)throw Error('Receipt too large');
  const eventId=verifySvix(raw,headers,secret,now());
  const event=JSON.parse(raw),data=event.data,state=states[event.type];
  if(!state)return {ignored:true};
  const invitation=data?.tags?.invitation;
  // Workspace webhooks may include coupon/marketing mail. Never ingest unrelated messages.
  if(!invitation&&!data?.tags?.program)return {ignored:true};
  if(!/^[a-f0-9]{64}$/.test(invitation||'')||!['consumer-referral','realtor-tier'].includes(data.tags.program)||typeof data.email_id!=='string'||!data.email_id||!Number.isFinite(Date.parse(event.created_at)))throw Error('Unbound receipt');
  const k='invitations/'+invitation,receiptKey='resend-receipts/'+hash(eventId),digest=hash(raw);
  const existing=await store.getWithMetadata(receiptKey,{type:'json'});
  if(existing&&existing.data.digest!==digest)throw Error('Receipt replay mismatch');
  if(existing?.data.applied)return {duplicate:true};
  // Persist encrypted payload before applying; replay after a crash resumes the same effect.
  await store.setJSON(receiptKey,{digest,body:vault.seal(event,receiptKey),applied:false,receivedAt:now()},{onlyIfNew:true});
  for(let attempt=0;attempt<8;attempt++){
   const entry=await store.getWithMetadata(k,{type:'json'}),row=entry?.data;
   if(!row||row.attemptedAt===undefined)throw Error('No matching send attempt');
   if((row.program||'consumer-referral')!==data.tags.program)throw Error('Program mismatch');
   const message=vault.open(row.message,k);
   if(data.to?.length!==1||data.to[0].trim().toLowerCase()!==message.to[0].trim().toLowerCase()||data.from!==message.from||data.subject!==message.subject)throw Error('Receipt identity mismatch');
   if(row.emailId&&row.emailId!==data.email_id)throw Error('Conflicting provider receipt');
   if(['bounced','complained','suppressed'].includes(state))await store.setJSON('resend-suppression/'+hash(message.to[0].trim().toLowerCase()),{blocked:true,reason:state,observedAt:now()},{onlyIfNew:true});
   const next={...row,emailId:data.email_id,state:(rank[row.state]??0)>rank[state]?row.state:state,leaseUntil:0,lastReceiptAt:now(),receiptTypes:{...row.receiptTypes,[event.type]:true}};
   if(!(await store.setJSON(k,next,{onlyIfMatch:entry.etag})).modified)continue;
   const saved=await store.getWithMetadata(receiptKey,{type:'json'});
   await store.setJSON(receiptKey,{...saved.data,applied:true},{onlyIfMatch:saved.etag});
   return {recorded:true,state:next.state};
  }
  throw Error('Receipt contention; replay required');
 };
}
