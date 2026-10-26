import {createClaims} from './referral-claims.mjs';
import {claimVault} from './claim-vault.mjs';
const scenarios=['ordinary','timeout','intent-crash','receipt-crash','ledger-failure'];
const fixtureKey='b'.repeat(64); // PUBLIC synthetic-only encryption fixture, not a credential.
export async function testHandler({policy,request,context,openStore,now=Date.now}){
 const out=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'}});
 if(!policy.protectionVerified||now()>=policy.expiresAt||context.site?.id!==policy.siteId||context.deploy?.context!=='deploy-preview'||context.deploy?.published||!context.deploy?.id)return out({disabled:true},403);
 if(request.method!=='POST'||request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('content-type')!=='application/json')return out({error:'request-rejected'},403);
 const reader=request.body?.getReader();if(!reader)return out({error:'body-required'},400);
 let length=0;const chunks=[];for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>512){await reader.cancel();return out({error:'body-too-large'},413);}chunks.push(value);}
 let body;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{return out({error:'invalid-json'},400);}
 if(!['create','cas','prepare','claim','recover','summary'].includes(body.op)||!Number.isInteger(body.slot)||body.slot<0||body.slot>=policy.maxRequests||
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
 if(body.op==='summary'){
  const counts={posts:0,purchases:0,lookups:0,ledgerReceipts:0,requests:0};
  for(const [field,prefix] of [['posts','mock-posts/'],['purchases','mock-orders/'],['lookups','mock-lookups/'],['ledgerReceipts','mock-ledger/'],['requests','budget/']]){
   for await(const page of store.list({prefix,paginate:true}))counts[field]+=page.blobs.length;
  }
  return out({mode:'mock-only',deployId:context.deploy.id,counts});
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
   await store.setJSON(`mock-posts/${body.slot}`,{externalId:input.externalId},{onlyIfNew:true});
   const order={id:`mock-${s}`,external_id:input.externalId,status:'EXECUTED',created_at:new Date(now()).toISOString(),rewards:[{id:`mock-reward-${s}`,value:{denomination:25,currency_code:'USD'},delivery:{method:'LINK'},recipient:{email:input.email}}]};
   await store.setJSON(`mock-orders/${input.externalId}`,order,{onlyIfNew:true});
   if(s==='timeout'&&await marker(`fault/${s}`))throw Error('synthetic-timeout-after-purchase');
   return store.get(`mock-orders/${input.externalId}`,{type:'json'});
  },
  async lookup(id){await store.setJSON(`mock-lookups/${body.slot}`,{externalId:id},{onlyIfNew:true});return store.get(`mock-orders/${id}`,{type:'json'});},
  async link(){return 'https://example.invalid/synthetic-link';}
 };
 const claims=createClaims({store:local,provider,ledger,vault:claimVault(fixtureKey),enabled:true,now});
 try{
  const prepared=await claims.prepare(useId); // encrypted capability recovered internally; never returned
  if(body.op==='prepare')return out({prepared:true,scenario:s});
  const result=body.op==='recover'?await claims.reconcile(prepared.token):await claims.claim(prepared.token,true);
  return out({scenario:s,state:result.state}); // never return tokens, links or recipient details
 }catch{return out({scenario:s,state:'interrupted-or-contended'},409);}
}
