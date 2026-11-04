import {authenticate,readState,review,reviewFingerprint,fingerprint} from './cards-core.mjs';
import {CARDLY_ASSETS} from './cardly-zap-mapping.mjs';
const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'}});
// Approval-only boundary. No send/order/grant/receipt/staging action exists.
// No input may create office evidence, import history or select source identities.
export async function handleCardApproval({request,context,role,env,openStore,getSourceView,now=Date.now()}){
 const url=new URL(request.url);
 if(url.protocol!=='https:'||context?.deploy?.context!=='production')return reply({status:'disabled',deliveryEnabled:false},503);
 if(!['owner','bridge'].includes(role)||!['CARDS_APPROVAL_OWNER_SHA256','CARDS_APPROVAL_BRIDGE_SHA256'].every(k=>/^[a-f0-9]{64}$/.test(env[k]||''))||env.CARDS_APPROVAL_OWNER_SHA256===env.CARDS_APPROVAL_BRIDGE_SHA256)return reply({status:'configuration_required',deliveryEnabled:false},503);
 if(!authenticate(request.headers.get('authorization'),env[role==='owner'?'CARDS_APPROVAL_OWNER_SHA256':'CARDS_APPROVAL_BRIDGE_SHA256']))return reply({status:'unauthorized'},401);
 if(request.method==='GET'&&url.search==='?connection_check=1')return reply({status:'connection_verified',scope:'cards_'+role,deliveryEnabled:false,version:'approval-only-v1'});
 if(request.method!=='POST'||url.search)return reply({status:'method_rejected'},405);
 if(request.headers.get('content-type')?.split(';')[0]!=='application/json')return reply({status:'json_required'},415);
 try{
  const reader=request.body?.getReader();let bytes=0,chunks=[];if(reader){while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>16384){await reader.cancel();return reply({status:'request_too_large'},413);}chunks.push(Buffer.from(value));}}const raw=Buffer.concat(chunks).toString('utf8');
  const body=JSON.parse(raw);
  if(role==='bridge'){
   // The bridge can inspect queue counts, never recipients, approval or dispatch.
   if(body.action!=='status')return reply({status:'action_forbidden'},403);
   const state=await readState(openStore());return reply({status:'approval_only',pending:Object.values(state.jobs).filter(j=>j.status==='AWAITING_APPROVAL').length,deliveryEnabled:false});
  }
  if(!['queue','prepare','review'].includes(body.action))return reply({status:'action_forbidden'},403);
  const store=openStore(),state=await readState(store);
  if(body.action==='queue')return reply({jobs:Object.values(state.jobs).map(j=>({id:j.id,revision:j.revision,status:j.status,text:j.approvedText||j.draftText||'',recipient:j.snapshot.recipient,inspectionId:j.snapshot.inspectionId})),deliveryEnabled:false});
  const j=state.jobs[body.jobId];if(!j||j.revision!==body.revision||j.orderAttempt||!['AWAITING_APPROVAL','APPROVED','MANUAL_REVIEW'].includes(j.status))throw Error('job_requires_review');
  // Source evidence must have been persisted by the trusted cache consumer.
  // No caller source fingerprint, mapping, address or identity is accepted.
  if(!j.snapshot.sourceRecords||!j.snapshot.officeHash)throw Error('source_verification_required');
  const view=getSourceView();const inspection=await view.getInspection(j.snapshot.inspectionId),contact=await view.getContact(j.snapshot.agentId);
  if(fingerprint({inspection,contact})!==j.snapshot.sourceRecords)throw Error('source_changed');
  const artwork={id:CARDLY_ASSETS.artworkId,templateId:CARDLY_ASSETS.templateId,messagePage:3,revision:'1'};
  if(typeof body.text!=='string'||!body.text.trim()||body.text.length>1000)throw Error('message_required');
  const reviewedFingerprint=reviewFingerprint(j,body.text,artwork);
  if(body.action==='prepare')return reply({jobId:j.id,revision:j.revision,text:body.text,artwork,reviewedFingerprint,deliveryEnabled:false});
  if(typeof body.approve!=='boolean'||body.reviewedFingerprint!==reviewedFingerprint)throw Error('review_changed');
  const result=await review(store,{jobId:j.id,revision:j.revision,text:body.text,artwork,reviewedFingerprint,approve:body.approve},now);
  return reply({...result,deliveryEnabled:false});
 }catch{return reply({status:'held_for_review',deliveryEnabled:false},409);}
}
