import {createHmac,timingSafeEqual} from 'node:crypto';
import {operationId} from './marketing-admission-client.mjs';
// Dedicated credential gate; do not reuse or expose the ledger secret to Mailchimp.
export function terminalToken(secret,executor,outcome){if(typeof secret!=='string'||secret.length<43||secret.length>128)throw Error('Dedicated callback credential unavailable');return createHmac('sha256',secret).update(JSON.stringify(['marketing-terminal-v1',executor.audienceId,executor.journeyId,executor.graphVersion,outcome])).digest('hex');}
export async function handleTerminalCallback(request,{config,client,secret}){
 if(config.terminalCallbackEnabled!==true)return new Response(null,{status:503});
 if(request.method!=='POST')return new Response(null,{status:405});
 const url=new URL(request.url),key=url.searchParams.get('executor'),outcome=url.searchParams.get('outcome'),graph=url.searchParams.get('graph'),e=config.executors[key];
 if(!e||e.verified!==true||e.terminalMode!=='authenticated_callback'||e.terminalCallbackVerified!==true||e.reentry!==false||e.noAutonomousTails!==true||!['stop','skip'].includes(outcome)||graph!==e.graphVersion)return new Response(null,{status:403});
 const supplied=request.headers.get('x-insites-terminal-key');if(!/^[a-f0-9]{64}$/.test(supplied||''))return new Response(null,{status:401});
 let expected;try{expected=terminalToken(secret,e,outcome);}catch{return new Response(null,{status:503});}
 if(!timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))return new Response(null,{status:401});
 if(Number(request.headers.get('content-length')||0)>1024)return new Response(null,{status:413});
 const raw=await request.text();if(Buffer.byteLength(raw)>1024)return new Response(null,{status:413});let body;try{body=JSON.parse(raw);}catch{return new Response(null,{status:400});}
 if(!body||Object.keys(body).length!==1||typeof body.email!=='string'||body.email.length>254||!/^\S+@\S+\.\S+$/.test(body.email))return new Response(null,{status:400});
 const email=body.email.trim().toLowerCase();
 try{
  const personKey=client.identity(email),memberKey=client.memberKey(e.audienceId,email),{state}=await client.snapshot(personKey);
  const candidates=Object.values(state.permits).filter(p=>p.memberKey===memberKey&&p.executor.audienceId===e.audienceId&&p.executor.campaignId===e.campaignId&&p.executor.graphVersion===e.graphVersion&&Number.isSafeInteger(p.attemptedAt));
  if(candidates.length!==1)return new Response(null,{status:409});const p=candidates[0];
  const data={permitId:p.id,authenticated:true,audienceId:e.audienceId,campaignId:e.campaignId,graphVersion:e.graphVersion,memberKey,outcome};
  await client.command(personKey,'terminalCallback',data,operationId('terminal-callback-v1',p.id,outcome));
  return new Response(null,{status:204});
 }catch{return new Response(null,{status:503});}
}
