import {createClaims} from './referral-claims.mjs';
import {claimVault} from './claim-vault.mjs';
import {createHash} from 'node:crypto';
const scenarios=['ordinary','timeout','intent-crash','receipt-crash','ledger-failure','stale-owner','runtime-termination'];
const hash=value=>createHash('sha256').update(value).digest('hex');
const fixtureKey='b'.repeat(64); // PUBLIC synthetic-only encryption fixture, not a credential.
export async function testHandler({policy,request,context,openStore,now=Date.now,wait=ms=>new Promise(r=>setTimeout(r,ms))}){
 const out=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'}});
 if(!policy.protectionVerified||now()>=policy.expiresAt||context.site?.id!==policy.siteId||context.deploy?.context!=='deploy-preview'||context.deploy?.published||!context.deploy?.id)return out({disabled:true},403);
 if(request.method!=='POST'||request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('content-type')!=='application/json')return out({error:'request-rejected'},403);
 const reader=request.body?.getReader();if(!reader)return out({error:'body-required'},400);
 let length=0;const chunks=[];for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>512){await reader.cancel();return out({error:'body-too-large'},413);}chunks.push(value);}
 let body;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{return out({error:'invalid-json'},400);}
 if(!['create','cas','prepare','claim','recover','summary','probe'].includes(body.op)||!Number.isInteger(body.slot)||body.slot<0||body.slot>=policy.maxRequests||
  (['prepare','claim','recover'].includes(body.op)&&!scenarios.includes(body.scenario)))return out({error:'invalid-operation'},400);
 const store=openStore();
 if(!(await store.setJSON(`budget/${body.slot}`,{requestId:context.requestId||'local',op:body.op},{onlyIfNew:true})).modified)return out({error:'slot-already-consumed'},409);
 const marker=async name=>(await store.setJSON(name,{seen:true},{onlyIfNew:true})).modified;
 if(body.op==='create')return out({modified:(await store.setJSON('primitive/create',{slot:body.slot},{onlyIfNew:true})).modified});
 if(body.op==='cas'){
  await store.setJSON('primitive/cas',{version:0},{onlyIfNew:true});
  const initial=await store.getWithMetadata('primitive/cas',{type:'json'});
  await store.setJSON('primitive/original-etag',{etag:initial.etag},{onlyIfNew:true});
  const original=await store.get('primitive/original-etag',{type:'json'});
  return out({modified:(await store.setJSON('primitive/cas',{version:1,slot:body.slot},{onlyIfMatch:original.etag})).modified});
 }
 if(body.op==='probe')return out({staleWaiting:!!await store.get('coord/stale-waiting'),terminationStarted:!!await store.get('coord/termination-started'),terminationReturned:!!await store.get('coord/termination-returned')});
 if(body.op==='summary'){
  const counts={posts:0,purchases:0,lookups:0,ledgerReceipts:0,requests:0};
  for(const [field,prefix] of [['posts','mock-posts/'],['purchases','mock-orders/'],['lookups','mock-lookups/'],['ledgerReceipts','mock-ledger/'],['requests','budget/']]){
   for await(const page of store.list({prefix,paginate:true}))counts[field]+=page.blobs.length;
  }
  const states={};for(const s of scenarios){const index=await store.get('claim-uses/'+hash(`synthetic-${s}`),{type:'json'});if(index){const row=await store.get(index.claimKey,{type:'json'});states[s]={state:row.state,attemptSaved:!!row.attemptedAt,receiptSaved:!!row.orderId,ledgerSynced:!!row.ledgerSynced};}}
  return out({mode:'mock-only',deployId:context.deploy.id,counts,states,staleOwnerPreserved:!!await store.get('coord/stale-owner-preserved'),terminationStarted:!!await store.get('coord/termination-started'),terminationReturned:!!await store.get('coord/termination-returned')});
 }
 const s=body.scenario,useId=`synthetic-${s}`,local={get:store.get.bind(store),getWithMetadata:store.getWithMetadata.bind(store)};
 local.setJSON=async(k,row,options)=>{
  const result=await store.setJSON(k,row,options);
  if(result.modified&&k.startsWith('claims/')&&s==='intent-crash'&&row.state==='processing'&&await marker(`fault/${s}`))throw Error('synthetic-intent-write-interruption');
  if(result.modified&&k.startsWith('claims/')&&s==='receipt-crash'&&row.state==='issued'&&await marker(`fault/${s}`))throw Error('synthetic-receipt-write-interruption');
  return result;
 };
 const ledger=async(action,args)=>{
  if(action==='claimCandidate')return {ready:true,email:`${s}@example.com`,name:'Synthetic owner'};
  if(action==='recordClaimIssued'){
   if(s==='ledger-failure'&&await marker(`fault/${s}`))throw Error('synthetic-ledger-interruption');
   await store.setJSON(`mock-ledger/${args.useId}`,{rewardId:args.rewardId},{onlyIfNew:true});
  }return {};
 };
 const provider={
  async create(input){
   if(s==='stale-owner'){
    await marker('coord/stale-waiting');let released=false;
    for(let i=0;i<30;i++){if(await store.get('coord/stale-release')){released=true;break;}await wait(500);}
    if(!released)throw Error('bounded-coordination-timeout');
   }
   await store.setJSON(`mock-posts/${body.slot}`,{externalId:input.externalId},{onlyIfNew:true});
   const order={id:`mock-${s}`,external_id:input.externalId,status:'EXECUTED',created_at:new Date(now()).toISOString(),rewards:[{id:`mock-reward-${s}`,value:{denomination:25,currency_code:'USD'},delivery:{method:'LINK'},recipient:{email:input.email}}]};
   await store.setJSON(`mock-orders/${input.externalId}`,order,{onlyIfNew:true});
   if(s==='runtime-termination'&&await marker('coord/termination-started')){
    // Deliberately exceed documented 60s sync limit in this synthetic function.
    // No process.exit, recursive invocation, external transport or real records.
    await wait(65000);await marker('coord/termination-returned');
    throw Error('platform-did-not-terminate-at-expected-limit');
   }
   if(s==='timeout'&&await marker(`fault/${s}`))throw Error('synthetic-timeout-after-purchase');
   return store.get(`mock-orders/${input.externalId}`,{type:'json'});
  },
  async lookup(id){await store.setJSON(`mock-lookups/${body.slot}`,{externalId:id},{onlyIfNew:true});
   const order=await store.get(`mock-orders/${id}`,{type:'json'});
   if(s==='stale-owner'&&body.op==='recover'&&await marker('coord/stale-takeover')){
    const lockKey='claim-locks/'+hash('use:'+useId),before=await store.get(lockKey,{type:'json'});
    await marker('coord/stale-release');await wait(3000);
    const after=await store.get(lockKey,{type:'json'});
    if(before?.owner===after?.owner&&before?.until===after?.until)await marker('coord/stale-owner-preserved');
   }return order;
  },
  async link(){return 'https://example.invalid/synthetic-link';}
 };
 const claims=createClaims({store:local,provider,ledger,vault:claimVault(fixtureKey),enabled:true,now:()=>now()+(s==='stale-owner'&&body.op==='recover'?121000:0)});
 try{
  const prepared=await claims.prepare(useId); // encrypted capability recovered internally; never returned
  if(body.op==='prepare')return out({prepared:true,scenario:s});
  const result=body.op==='recover'?await claims.reconcile(prepared.token):await claims.claim(prepared.token,true);
  return out({scenario:s,state:result.state}); // never return tokens, links or recipient details
 }catch{return out({scenario:s,state:'interrupted-or-contended'},409);}
}
