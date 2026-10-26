import {createHash,randomBytes} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
const tokenOK=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function createClaims({store,provider,ledger,vault,enabled=false,now=()=>Date.now()}){
 const key=token=>'claims/'+hash(token),snapshots=new WeakMap();
 const get=async token=>{const entry=await store.getWithMetadata(key(token),{type:'json'});if(!entry)return null;const row=entry.data;snapshots.set(row,JSON.stringify(row));return row;};
 const save=async(token,row)=>{const current=await store.getWithMetadata(key(token),{type:'json'});if(!current||JSON.stringify(current.data)!==snapshots.get(row))throw Error('Claim changed; reload');const result=await store.setJSON(key(token),row,{onlyIfMatch:current.etag});if(!result.modified)throw Error('Claim changed; reload');snapshots.set(row,JSON.stringify(row));};
 async function locked(id,fn){const k='claim-locks/'+hash(id),owner=randomBytes(16).toString('hex'),old=await store.getWithMetadata(k,{type:'json'});if(old?.data.until>now())throw Error('Claim is processing');const held=await store.setJSON(k,{owner,until:now()+120000},old?{onlyIfMatch:old.etag}:{onlyIfNew:true});if(!held.modified)throw Error('Claim is processing');const guard=async()=>{const held=await store.getWithMetadata(k,{type:'json'});if(held?.data.owner!==owner||held.data.until<=now())throw Error('Claim lease expired');};try{return await fn(guard);}finally{const current=await store.getWithMetadata(k,{type:'json'});if(current?.data.owner===owner)await store.setJSON(k,{owner,until:0},{onlyIfMatch:current.etag});}}
 const requireRow=async token=>{if(!tokenOK(token))throw Error('Claim unavailable');const row=await get(token);if(!row)throw Error('Claim unavailable');return row;};
 async function receipt(row,order){
  const reward=order?.rewards?.[0];
  if(order?.external_id!==row.externalId||order?.status!=='EXECUTED'||order.rewards?.length!==1||!order.id||!reward?.id||reward.value?.denomination!==25||reward.value?.currency_code!=='USD'||reward.recipient?.email?.toLowerCase()!==row.email||reward.delivery?.method!=='LINK'||!Number.isFinite(Date.parse(order.created_at)))throw Error('Order not yet verified');
  return {orderId:order.id,rewardId:reward.id,issuedAt:order.created_at};
 }
 return {
  // Internal operator workflow only; no public issuance endpoint or sender.
  async prepare(useId){if(!enabled)throw Error('Claims disabled');return locked('use:'+useId,async()=>{
   if(!vault)throw Error('Claim recovery encryption required');
   const index='claim-uses/'+hash(useId);let existing=await store.get(index,{type:'json'});
   if(!existing){
    const eligible=await ledger('claimCandidate',{useId});if(!eligible.ready)throw Error('Referral not eligible');
    if(typeof eligible.name!=='string'||!eligible.name.trim()||typeof eligible.email!=='string'||!/^\S+@\S+\.\S+$/.test(eligible.email))throw Error('Invalid owner');
    const token=randomBytes(32).toString('hex'),externalId='insites-referral-'+hash(useId);
    const row={useId,externalId,email:eligible.email.trim().toLowerCase(),name:eligible.name.trim(),state:'available',createdAt:now()};
    const proposed={claimKey:key(token),initial:row,capability:vault.seal({token},index)};
    const written=await store.setJSON(index,proposed,{onlyIfNew:true});
    existing=written.modified?proposed:await store.get(index,{type:'json'});
   }
   const {token}=vault.open(existing.capability,index);
   if(existing.claimKey!==key(token)||existing.initial.useId!==useId)throw Error('Claim index mismatch');
   await store.setJSON(existing.claimKey,existing.initial,{onlyIfNew:true});
   return {token,externalId:existing.initial.externalId,email:existing.initial.email,name:existing.initial.name};
  });},
  async revoke(token){const first=await requireRow(token);return locked('use:'+first.useId,async()=>{const row=await requireRow(token);row.revokedAt=now();if(!row.attemptedAt)row.state='revoked';await save(token,row);return {revoked:true};});},
  async releaseHeld(token,evidence,commandId){if(!evidence?.providerConfirmedNeverSubmitted||typeof evidence.reference!=='string'||!evidence.reference.trim()||!/^[-a-zA-Z0-9_]{16,100}$/.test(commandId||'')||!evidence.expectedAttemptId)throw Error('Attempt-bound provider non-submission evidence required');const first=await requireRow(token);return locked('use:'+first.useId,async()=>{const row=await requireRow(token);if(row.consumedReleaseCommands?.includes(commandId))return {released:false,replayed:true};if(row.state!=='reconciling'||row.orderId||row.revokedAt||row.attemptId!==evidence.expectedAttemptId)throw Error('Not releasable');if(await provider.lookup(row.externalId))throw Error('Provider order exists');row.recoveryEvidence=evidence.reference;row.previousAttemptAt=row.attemptedAt;row.consumedReleaseCommands=[...(row.consumedReleaseCommands||[]),commandId];delete row.attemptedAt;row.state='available';await save(token,row);return {released:true};});},
  // Operator-only recovery: revocation blocks access, not accounting for an order already attempted.
  async reconcile(token){const first=await requireRow(token);return locked('use:'+first.useId,async()=>{const row=await requireRow(token);if(!row.attemptedAt)return {state:row.state};if(!row.orderId){const order=await provider.lookup(row.externalId);if(!order)return {state:'reconciling'};Object.assign(row,await receipt(row,order),{state:'issued'});await save(token,row);}if(!row.ledgerSynced){await ledger('recordClaimIssued',{useId:row.useId,externalId:row.externalId,rewardId:row.rewardId,issuedAt:row.issuedAt});row.ledgerSynced=true;await save(token,row);}return {state:row.state,revoked:!!row.revokedAt};});},
  async details(token){const row=await requireRow(token);return {state:row.revokedAt?'revoked':(!row.attemptedAt&&row.expiresAt&&now()>=row.expiresAt?'expired':row.state),amount:25,currency:'USD',product:'Amazon.com gift card',enabled};},
  async claim(token,affirmed){if(!enabled)throw Error('Claims disabled');if(affirmed!==true)throw Error('Affirmative claim required');const first=await requireRow(token);
   return locked('use:'+first.useId,async guard=>{
    const row=await requireRow(token);
    if(row.revokedAt)throw Error('Claim revoked');
    if(!row.attemptedAt&&(row.revokedAt||(row.expiresAt&&now()>=row.expiresAt)))throw Error('Claim unavailable');
    if(!row.attemptedAt){
     // Existing ledger atomically reserves one reward per inspection/new client.
     // A repeated reservation is allowed only for this stable external order ID.
     await guard();await ledger('reserveClaimReward',{useId:row.useId,externalId:row.externalId,email:row.email});
     row.attemptedAt=now();row.attemptId=randomBytes(16).toString('hex');row.state='processing';await save(token,row);
     try{await guard();const order=await provider.create({externalId:row.externalId,name:row.name,email:row.email});Object.assign(row,await receipt(row,order),{state:'issued'});await save(token,row);}catch(error){row.state='reconciling';row.attention=error.status===401?'authentication-rejected':error.status===403?'permission-rejected':[400,422].includes(error.status)?'validation-rejected':error.status===402?'insufficient-funds':error.status===409?'provider-conflict':error.status===429?'rate-limited':'outcome-unverified';if(Number.isInteger(error.status)&&error.status>=400&&error.status<=599)row.lastProviderHttpStatus=error.status;await save(token,row);return {state:row.state};}
    }else if(row.state!=='issued'){
     // Never blindly repeat an order POST, including timeout/404/409 outcomes.
     try{const order=await provider.lookup(row.externalId);if(!order)return {state:'reconciling'};Object.assign(row,await receipt(row,order),{state:'issued'});await save(token,row);}catch{return {state:'reconciling'};}
    }
    if(!row.ledgerSynced){await ledger('recordClaimIssued',{useId:row.useId,externalId:row.externalId,rewardId:row.rewardId,issuedAt:row.issuedAt});row.ledgerSynced=true;await save(token,row);}
    // Generate a link on an explicit POST only. Never persist bearer reward URLs.
    await guard();return {state:'issued',link:await provider.link(row.rewardId)};
   });
  }
 };
}
export function claimHandler({claims,origin='https://www.insites.services'}){return async request=>{
 const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'};
 const json=(body,status=200)=>Response.json(body,{status,headers});
 if(request.method==='GET'||request.method==='HEAD')return json({message:'Open the claim page and explicitly confirm your claim.'});
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 if(request.headers.get('origin')!==origin||new URL(request.url).origin!==origin)return json({error:'Forbidden'},403);
 if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSON required'},415);
 // Bound bytes while reading, not after allocating an untrusted request body.
 if(Number(request.headers.get('content-length'))>1024)return json({error:'Too large'},413);
 const reader=request.body?.getReader();if(!reader)return json({error:'JSON required'},400);
 const chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024){await reader.cancel();return json({error:'Too large'},413);}chunks.push(value);}}catch{return json({error:'Invalid request body'},400);}
 const raw=Buffer.concat(chunks).toString('utf8');
 try{const body=JSON.parse(raw);if(body.action==='status')return json(await claims.details(body.token));if(body.action!=='claim'||body.confirm!==true)return json({error:'Confirm your claim'},400);return json(await claims.claim(body.token,true));}
 catch{return json({error:'Your claim could not be completed. No second order will be placed while its outcome is checked.'},503);}
};}
