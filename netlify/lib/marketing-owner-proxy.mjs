import {marketingExecutorEnabled} from './marketing-program-gates.mjs';
import {createHmac,createHash,timingSafeEqual} from 'node:crypto';
const ACTIONS=new Set(['discover','preflight','receipt','classificationReceipt','trigger','installationProbe','referralRatingMetadata','installationReadiness','installationSourceConflict','photographyReadiness']);
export const signOwnerRequest=(secret,ts,body)=>createHmac('sha256',secret).update('marketing-owner-io-v1\0'+ts+'.'+body).digest('hex');
export async function ownerProxy(request,{config,secret,io,provider,claims,now=()=>Date.now(),production=false,loadServices,loadMetadata,loadReadiness,loadSourceConflict,loadPhotographyReadiness,referralLastMile=async()=>null}){
 const json=(x,status=200)=>Response.json(x,{status,headers:{'Cache-Control':'no-store'}});
 const ownerEnabled=config.enabled===true&&config.appsScriptOwnerEnabled===true&&config.allMarketingWritersCovered===true&&config.cutover?.verified===true&&Number.isSafeInteger(config.cutover.at)&&config.cutover.at>0&&config.cutover.at<=now();
 // Real production requests authenticate before the OFF gate solely to admit the inert probe.
 if(!ownerEnabled&&production!==true)return json({off:true});
 if(request.method!=='POST'||!secret)return json({error:'unauthorized'},401);
 const raw=await request.text(),ts=request.headers.get('x-marketing-time'),signature=request.headers.get('x-marketing-signature');
 if(Buffer.byteLength(raw)>1100000||!/^\d{13}$/.test(ts||'')||Math.abs(Number(ts)-now())>300000||!/^[a-f0-9]{64}$/.test(signature||'')||!timingSafeEqual(Buffer.from(signature),Buffer.from(signOwnerRequest(secret,ts,raw))))return json({error:'unauthorized'},401);
 let body;try{body=JSON.parse(raw);}catch{return json({error:'invalid'},400);}if(!body||typeof body!=='object'||Array.isArray(body)||body.version!==1||!ACTIONS.has(body.action)||typeof body.data!=='object'||body.data===null||Array.isArray(body.data))return json({error:'invalid'},400);
 const d=body.data;
 // Separately authenticated, fixed read-only diagnostic. It never loads send
 // services and is safe while live review owners remain enabled.
 if(body.action==='photographyReadiness'){
  if(production!==true||!ownerEnabled)return json({error:'unauthorized'},401);
  if(Object.keys(body).length!==3||Object.keys(d).length!==1||!Object.hasOwn(d,'probeId')||typeof d.probeId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(d.probeId))return json({error:'invalid'},400);
  if(typeof loadPhotographyReadiness!=='function')return json({error:'photography_readiness_unavailable'},409);
  try{return json({version:1,action:body.action,probeId:d.probeId,authenticated:true,readOnly:true,readiness:await loadPhotographyReadiness()});}catch{return json({error:'photography_readiness_unavailable'},409);}
 }
 if(['installationProbe','referralRatingMetadata','installationReadiness','installationSourceConflict'].includes(body.action)){
  if(production!==true)return json({error:'unauthorized'},401);
  if(Object.keys(body).length!==3||Object.keys(d).length!==1||!Object.hasOwn(d,'probeId')||typeof d.probeId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(d.probeId))return json({error:'invalid'},400);
  const flags=['enabled','appsScriptOwnerEnabled','terminalCallbackEnabled','producerEnabled','reviewOwnerEnabled','allMarketingWritersCovered'];
  if(flags.some(k=>config[k]!==false)||config.noBusinessOwnerEnabled===true||config.referralOwnerEnabled===true||config.referralRatingProjection?.enabled===true||config.reviewReferralPolicy?.enabled===true||config.cutover?.verified!==false||config.cutover.at!==null)return json({error:'installation_not_off'},409);
  if(body.action==='installationSourceConflict'){
   // One private conflict GET through shared quota/lease; never load send services.
   if(config.referralOwnerEnabled!==false||config.referralRatingProjection?.enabled!==false||config.reviewReferralPolicy?.enabled!==false||typeof loadSourceConflict!=='function')return json({error:'installation_not_off'},409);
   try{return json({version:1,action:body.action,probeId:d.probeId,authenticated:true,off:true,source:await loadSourceConflict()});}catch{return json({error:'source_diagnostic_unavailable'},409);}
  }
  if(body.action==='installationReadiness'){
   if(config.referralOwnerEnabled!==false||config.referralRatingProjection?.enabled!==false||config.reviewReferralPolicy?.enabled!==false||typeof loadReadiness!=='function')return json({error:'installation_not_off'},409);
   try{return json({version:1,action:body.action,probeId:d.probeId,authenticated:true,off:true,source:await loadReadiness()});}catch{return json({error:'readiness_unavailable'},409);}
  }
  if(body.action==='referralRatingMetadata'){
   // This separate loader is fixed to two metadata GETs; never load send services.
   if(config.referralOwnerEnabled!==false||config.referralRatingProjection?.enabled!==false||config.reviewReferralPolicy?.enabled!==false||typeof loadMetadata!=='function')return json({error:'installation_not_off'},409);
   try{return json({version:1,action:body.action,probeId:d.probeId,authenticated:true,off:true,mapping:await loadMetadata()});}catch{return json({error:'metadata_unavailable'},409);}
  }
  // No provider/cache/ledger work and no replay claims: an authenticated nonce echo is read-only.
  return json({version:1,action:'installationProbe',probeId:d.probeId,authenticated:true,off:true});
 }
 if(!ownerEnabled)return json({off:true});
 if(body.action==='trigger'&&!marketingExecutorEnabled(config,d.executorKey))return json({off:true});
 try{
  if(loadServices)({io,provider,claims,referralLastMile=async()=>null}=await loadServices());
  if(body.action==='trigger'){
   if(!/^[a-f0-9]{64}$/.test(d.attemptId||'')||typeof d.email!=='string'||d.email!==d.email.trim().toLowerCase()||!/^\S+@\S+\.\S+$/.test(d.email)||d.email.length>254||!Number.isSafeInteger(d.issuedAt)||d.issuedAt>now()||now()-d.issuedAt>60000)throw Error('Invalid consumed capability');
   const e=d.executorKey==='classifier'?config.completionExecutor:config.executors[d.executorKey];if(!e||e.verified!==true||e.reentry!==false||![0,1].includes(e.emailCount)||e.noAutonomousTails!==true||d.binding!==JSON.stringify(e)||e.emailCount===0&&(d.executorKey!=='classifier'||!e.exclusiveInterestWriter))throw Error('Invalid immutable executor');
   // Immutable create-only replay fence, never a counter or proof of sent/no-send.
   const fingerprint=createHash('sha256').update(JSON.stringify(d)).digest('hex'),claim=await claims.setJSON('attempts/'+d.attemptId,{schema:1,fingerprint,claimedAt:now()},{onlyIfNew:true});
   if(claim?.modified!==true)return json({attempted:false,held:true});
   // A positive interest alone can never authorize referral dispatch. Run the
   // exact consumed-attempt check AFTER the replay fence, immediately before I/O.
   if(d.executorKey.startsWith('referral-customer-v1:')){
    let result=null,consumed=false;
    const consume=async proof=>{
     if(consumed)return;consumed=true;
     if(e.nativePositiveRatingGuardVerified!==true||typeof e.positiveRatingInterest!=='string'||!e.positiveRatingInterest||proof?.verified!==true||proof.attemptId!==d.attemptId||proof.email!==d.email||proof.executorBinding!==d.binding||!Number.isSafeInteger(proof.observedAt)||proof.observedAt>now()||now()-proof.observedAt>60000||!Number.isSafeInteger(proof.expiresAt)||proof.expiresAt<=now()||now()-d.issuedAt>60000)return;
     try{await provider.trigger(e,d.email);result={attempted:true,accepted:true};}catch{result={attempted:true,uncertain:true};}
    };
    // The production hook holds the same lock as private feedback through this
    // one-shot continuation. No provider call escapes the validated lock scope.
    try{await referralLastMile({...d},consume);}catch{/* Preserve any uncertain provider result. */}
    return json(result||{attempted:true,accepted:false,held:true,gateDenied:true,reason:'referral_rating_last_mile_hold'});
   }
   try{await provider.trigger(e,d.email);return json({attempted:true,accepted:true});}catch{return json({attempted:true,uncertain:true});}
  }
  if(body.action==='discover')return json(await io.discover(d.cursor));
  const s=d.state;if(!s||s.version!==1||!s.people||!s.permits||!s.intents)throw Error('Invalid snapshot');
  return json(await io[body.action](s,d.permitId));
 }catch{return json({held:true},409);}
}
