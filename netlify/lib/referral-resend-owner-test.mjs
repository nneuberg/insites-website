import {createHash} from 'node:crypto';
import {invitations} from './referral-invitations.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
export const RUN='resend-owner-20261028-v1';
export const OWNER='neal@insites.services';
const sender={verified:true,from:'InSites Rewards <offers@insites.services>',replyTo:OWNER};
const ids=[1,2,3].map(n=>RUN+'-'+n);
export async function ownerResendTest({store,vault,send,now=()=>Date.now()}){
 const readback=async()=>({state:'readback',run:RUN,invitations:await Promise.all(ids.map(async useId=>{const row=(await store.getWithMetadata('invitations/'+hash(useId),{type:'json'}))?.data;return {useId,state:row?.state||'not-attempted',emailId:row?.emailId||null,receiptTypes:row?.receiptTypes||{}};})),retry:(await store.getWithMetadata(RUN+'/retry-result',{type:'json'}))?.data||null});
 if(!(await store.setJSON(RUN+'/batch',{startedAt:now(),maximumUnique:3,maximumRetry:1},{onlyIfNew:true})).modified)return readback();
 const messages=new Map();
 const guarded=async(message,id)=>{
  const useId=ids.find(x=>'referral-claim-'+hash(x)===id);
  if(!useId||message.to?.length!==1||message.to[0]!==OWNER||message.from!==sender.from||message.reply_to!==OWNER||message.subject!=='InSites Resend test '+useId||message.text!==`Owner-only test. No gift card or purchase. Inert link: https://example.com/referral/claim/#${hash(useId)}`||JSON.stringify(message.tags)!==JSON.stringify([{name:'invitation',value:hash(useId)},{name:'program',value:'consumer-referral'}]))throw Error('Test message guard');
  if(!(await store.setJSON(RUN+'/attempt/'+hash(useId),{attemptedAt:now()},{onlyIfNew:true})).modified)throw Error('Test slot consumed');
  messages.set(useId,{message,id});return send(message,id);
 };
 const app=invitations({store,vault,sender,enabled:true,now,suppression:async email=>email===OWNER,ledger:async()=>({ready:true,invitationAllowed:true,email:OWNER}),claims:{prepare:async useId=>({email:OWNER,name:'Neal',token:hash(useId)}),details:async token=>({state:ids.some(id=>hash(id)===token)?'available':'invalid'})},buildMessage:({claim})=>{const useId=ids.find(id=>hash(id)===claim.token);return {from:sender.from,reply_to:OWNER,to:[OWNER],subject:'InSites Resend test '+useId,text:`Owner-only test. No gift card or purchase. Inert link: https://example.com/referral/claim/#${claim.token}`};},send:guarded});
 for(const useId of ids){await app.prepare(useId);const result=await app.deliver(useId);if(!['accepted','delivered'].includes(result.state))return {...await readback(),state:'stopped-for-reconciliation'};}
 // One intentional provider idempotency replay only after all first sends succeeded.
 const original=messages.get(ids[0]),first=(await store.getWithMetadata('invitations/'+hash(ids[0]),{type:'json'})).data;
 if(!original||!first.emailId||!(await store.setJSON(RUN+'/retry',{attemptedAt:now()},{onlyIfNew:true})).modified)return readback();
 try{const receipt=await send(original.message,original.id);await store.setJSON(RUN+'/retry-result',{sameProviderId:receipt.id===first.emailId,checkedAt:now()},{onlyIfNew:true});}catch{await store.setJSON(RUN+'/retry-result',{uncertain:true,checkedAt:now()},{onlyIfNew:true});}
 return readback();
}
