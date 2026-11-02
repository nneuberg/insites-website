import {createHmac,createHash,timingSafeEqual} from 'node:crypto';
const ACTIONS=new Set(['discover','preflight','receipt','classificationReceipt','trigger']);
export const signOwnerRequest=(secret,ts,body)=>createHmac('sha256',secret).update('marketing-owner-io-v1\0'+ts+'.'+body).digest('hex');
export async function ownerProxy(request,{config,secret,io,provider,claims,now=()=>Date.now()}){
 const json=(x,status=200)=>Response.json(x,{status,headers:{'Cache-Control':'no-store'}});
 if(config.appsScriptOwnerEnabled!==true||config.allMarketingWritersCovered!==true||config.cutover?.verified!==true||!Number.isSafeInteger(config.cutover.at)||config.cutover.at<=0||config.cutover.at>now())return json({off:true});
 if(request.method!=='POST'||!secret)return json({error:'unauthorized'},401);
 const raw=await request.text(),ts=request.headers.get('x-marketing-time'),signature=request.headers.get('x-marketing-signature');
 if(Buffer.byteLength(raw)>1100000||!/^\d{13}$/.test(ts||'')||Math.abs(Number(ts)-now())>300000||!/^[a-f0-9]{64}$/.test(signature||'')||!timingSafeEqual(Buffer.from(signature),Buffer.from(signOwnerRequest(secret,ts,raw))))return json({error:'unauthorized'},401);
 let body;try{body=JSON.parse(raw);}catch{return json({error:'invalid'},400);}if(body.version!==1||!ACTIONS.has(body.action)||typeof body.data!=='object'||body.data===null||Array.isArray(body.data))return json({error:'invalid'},400);
 const d=body.data;
 try{
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
