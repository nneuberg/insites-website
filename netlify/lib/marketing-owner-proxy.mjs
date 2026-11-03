import {createHmac,createHash,timingSafeEqual} from 'node:crypto';
const ACTIONS=new Set(['discover','preflight','receipt','classificationReceipt','trigger','installationProbe']);
export const signOwnerRequest=(secret,ts,body)=>createHmac('sha256',secret).update('marketing-owner-io-v1\0'+ts+'.'+body).digest('hex');
export async function ownerProxy(request,{config,secret,io,provider,claims,now=()=>Date.now(),production=false,loadServices}){
 const json=(x,status=200)=>Response.json(x,{status,headers:{'Cache-Control':'no-store'}});
 const ownerEnabled=config.appsScriptOwnerEnabled===true&&config.allMarketingWritersCovered===true&&config.cutover?.verified===true&&Number.isSafeInteger(config.cutover.at)&&config.cutover.at>0&&config.cutover.at<=now();
 // Real production requests authenticate before the OFF gate solely to admit the inert probe.
 if(!ownerEnabled&&production!==true)return json({off:true});
 if(request.method!=='POST'||!secret)return json({error:'unauthorized'},401);
 const raw=await request.text(),ts=request.headers.get('x-marketing-time'),signature=request.headers.get('x-marketing-signature');
 if(Buffer.byteLength(raw)>1100000||!/^\d{13}$/.test(ts||'')||Math.abs(Number(ts)-now())>300000||!/^[a-f0-9]{64}$/.test(signature||'')||!timingSafeEqual(Buffer.from(signature),Buffer.from(signOwnerRequest(secret,ts,raw))))return json({error:'unauthorized'},401);
 let body;try{body=JSON.parse(raw);}catch{return json({error:'invalid'},400);}if(!body||typeof body!=='object'||Array.isArray(body)||body.version!==1||!ACTIONS.has(body.action)||typeof body.data!=='object'||body.data===null||Array.isArray(body.data))return json({error:'invalid'},400);
 const d=body.data;
 if(body.action==='installationProbe'){
  if(production!==true)return json({error:'unauthorized'},401);
  if(Object.keys(body).length!==3||Object.keys(d).length!==1||!Object.hasOwn(d,'probeId')||typeof d.probeId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(d.probeId))return json({error:'invalid'},400);
  const flags=['enabled','appsScriptOwnerEnabled','terminalCallbackEnabled','producerEnabled','reviewOwnerEnabled','allMarketingWritersCovered'];
  if(flags.some(k=>config[k]!==false)||config.cutover?.verified!==false||config.cutover.at!==null)return json({error:'installation_not_off'},409);
  // No provider/cache/ledger work and no replay claims: an authenticated nonce echo is read-only.
  return json({version:1,action:'installationProbe',probeId:d.probeId,authenticated:true,off:true});
 }
 if(!ownerEnabled)return json({off:true});
 try{
  if(loadServices)({io,provider,claims}=await loadServices());
  if(body.action==='trigger'){
   if(!/^[a-f0-9]{64}$/.test(d.attemptId||'')||typeof d.email!=='string'||d.email!==d.email.trim().toLowerCase()||!/^\S+@\S+\.\S+$/.test(d.email)||d.email.length>254||!Number.isSafeInteger(d.issuedAt)||d.issuedAt>now()||now()-d.issuedAt>60000)throw Error('Invalid consumed capability');
   const e=d.executorKey==='classifier'?config.completionExecutor:config.executors[d.executorKey];if(!e||e.verified!==true||e.reentry!==false||![0,1].includes(e.emailCount)||e.noAutonomousTails!==true||d.binding!==JSON.stringify(e)||e.emailCount===0&&(d.executorKey!=='classifier'||!e.exclusiveInterestWriter))throw Error('Invalid immutable executor');
   // Immutable create-only replay fence, never a counter or proof of sent/no-send.
   const fingerprint=createHash('sha256').update(JSON.stringify(d)).digest('hex'),claim=await claims.setJSON('attempts/'+d.attemptId,{schema:1,fingerprint,claimedAt:now()},{onlyIfNew:true});
   if(claim?.modified!==true)return json({attempted:false,held:true});
   try{await provider.trigger(e,d.email);return json({attempted:true,accepted:true});}catch{return json({attempted:true,uncertain:true});}
  }
  if(body.action==='discover')return json(await io.discover(d.cursor));
  const s=d.state;if(!s||s.version!==1||!s.people||!s.permits||!s.intents)throw Error('Invalid snapshot');
  return json(await io[body.action](s,d.permitId));
 }catch{return json({held:true},409);}
}
