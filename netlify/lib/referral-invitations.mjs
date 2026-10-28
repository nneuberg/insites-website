import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
// Uses existing Resend route only after separate customer-send activation.
export function invitationDelivery({key,enabled=false,fetcher=fetch,timeoutMs=10000}){return async(message,id)=>{
 if(!enabled||!key)throw Error('Invitation delivery disabled');
 const response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Idempotency-Key':id},body:JSON.stringify(message),redirect:'error',signal:AbortSignal.timeout(Math.min(10000,Math.max(1000,timeoutMs)))});
 if(!response.ok)throw Error('Invitation outcome needs reconciliation');const result=await response.json();if(!result.id)throw Error('Invitation receipt missing');return {id:result.id};
};}
export function invitations({store,claims,vault,ledger,send,suppression=async()=>false,enabled=false,sender={verified:false},program='consumer-referral',buildMessage=null,now=()=>Date.now()}){
 if(!['consumer-referral','realtor-tier'].includes(program))throw Error('Unknown invitation program');
 const identity=useId=>hash(program==='consumer-referral'?useId:program+'\0'+useId);
 const path=useId=>'invitations/'+identity(useId);
 return {
  async prepare(useId){if(!enabled||!vault||sender.verified!==true||!sender.from||!sender.replyTo)throw Error('Invitations disabled');const candidate=await ledger('claimCandidate',{useId});if(!candidate.ready||candidate.invitationAllowed!==true)throw Error('Invitation not eligible');const claim=await claims.prepare(useId),k=path(useId);if(candidate.email?.toLowerCase()!==claim.email.toLowerCase())throw Error('Invitation owner changed');
   let message={from:sender.from,to:[claim.email],subject:'Your $25 InSites referral thank-you is ready',text:`Hi ${claim.name},\n\nYour qualifying referral earned a $25 USD Amazon.com gift card. Open your private InSites link and choose Claim my gift card when you are ready:\n\nhttps://www.insites.services/referral/claim/#${claim.token}\n\nOpening this link does not order a reward. No purchase occurs until you confirm your claim.\n\nQuestions? Reply to Neal at neal@insites.services.`,reply_to:sender.replyTo,tags:[{name:'invitation',value:identity(useId)},{name:'program',value:program}]};
   if(program!=='consumer-referral'||buildMessage){if(typeof buildMessage!=='function')throw Error('Program template not approved');message=buildMessage({candidate,claim,sender});message.tags=[{name:'invitation',value:identity(useId)},{name:'program',value:program}];}
   if(message.to?.length!==1||message.to[0]!==claim.email||message.from!==sender.from||message.reply_to!==sender.replyTo)throw Error('Invalid invitation binding');
   await store.setJSON(k,{state:'pending',program,useId,idempotencyKey:'referral-claim-'+identity(useId),message:vault.seal(message,k),createdAt:now()},{onlyIfNew:true});return {prepared:true};
  },
  async deliver(useId){if(!enabled)throw Error('Invitations disabled');const k=path(useId),entry=await store.getWithMetadata(k,{type:'json'});if(!entry)throw Error('Invitation missing');const row=entry.data;if(['sent','accepted','delivered','bounced','complained','failed','suppressed','review-required'].includes(row.state))return {state:row.state};
   if(row.attemptedAt!==undefined&&now()-row.attemptedAt>=23*3600000){const result=await store.setJSON(k,{...row,state:'review-required'},{onlyIfMatch:entry.etag});return {state:result.modified?'review-required':'busy'};}
   if(row.leaseUntil>now())return {state:'busy'};
   const candidate=await ledger('claimCandidate',{useId});if(!candidate.ready||candidate.invitationAllowed!==true)return {state:'held'};
   if(await store.getWithMetadata('resend-suppression/'+hash(candidate.email.trim().toLowerCase()),{type:'json'}))return {state:'held'};
   if(!await suppression(candidate.email))return {state:'held'};
   const message=vault.open(row.message,k);if(message.to?.length!==1||message.to[0].toLowerCase()!==candidate.email?.toLowerCase())return {state:'held'};const token=message.text.match(/claim\/#([a-f0-9]{64})/)?.[1];const detail=await claims.details(token);if(detail.state!=='available')return {state:'held'};
   const next={...row,attemptedAt:row.attemptedAt??now(),leaseUntil:now()+120000,state:'sending'};
   if(!(await store.setJSON(k,next,{onlyIfMatch:entry.etag})).modified)return {state:'busy'};
   const held=await store.getWithMetadata(k,{type:'json'});if(JSON.stringify(held.data)!==JSON.stringify(next))return {state:'busy'};
   try{const result=await send(message,next.idempotencyKey);const done=await store.setJSON(k,{...next,state:'accepted',emailId:result.id,acceptedAt:now(),leaseUntil:0},{onlyIfMatch:held.etag});return {state:done.modified?'accepted':'reconcile'};}
   catch{await store.setJSON(k,{...next,state:'pending',leaseUntil:0},{onlyIfMatch:held.etag});return {state:'pending'};}
  },
  async reconcileReceipt(useId,{id,evidence}={}){if(!id||!evidence)throw Error('Verified delivery evidence required');const k=path(useId),entry=await store.getWithMetadata(k,{type:'json'});if(!entry?.data.attemptedAt)throw Error('No send attempt');if(entry.data.emailId&&entry.data.emailId!==id)throw Error('Receipt mismatch');const result=await store.setJSON(k,{...entry.data,state:'sent',emailId:id,deliveryEvidence:evidence,leaseUntil:0},{onlyIfMatch:entry.etag});if(!result.modified)throw Error('Invitation changed');return {state:'sent'};}
 };
}
