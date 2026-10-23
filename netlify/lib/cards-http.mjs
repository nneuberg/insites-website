import {authenticate,receive,readState,importHistory,stage,review,acknowledge,dispatch,reevaluate,reviewFingerprint,resolveAgentConflict,claimProjection} from './cards-core.mjs';
import {claimDraft,submitDraft} from './cards-ai.mjs';
import {reconcileProjection} from './cards-sheets.mjs';
import {ownerPage,ownerScript} from './cards-ui.mjs';
import {mappingFrom,verifyOffice,officeFingerprint,retryEvent} from './cards-worker.mjs';
import {createHiveReader,resolveOffice,sheetProjection,sheetRow,verifySheetReadback} from './cards-adapters.mjs';
export const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'}});
export async function handle({request,context,env=process.env,openStore,kind,read}){
 // Exact bridge-only auth probe: no body, store, customer data or provider calls.
 // It remains usable while workflow activation is OFF; previews remain blocked.
 const url=new URL(request.url);
 if(kind==='bridge'&&url.pathname==='/.netlify/functions/cards-bridge'&&url.search==='?connection_check=1'){
  if(context?.deploy?.context!=='production')return reply({status:'disabled'},503);
  if(url.protocol!=='https:'||request.method!=='GET')return reply({status:'method_or_tls_rejected'},405);
  if(!/^[a-f0-9]{64}$/.test(env.HIVE_CARDS_OWNER_TOKEN_SHA256||'')||env.HIVE_CARDS_OWNER_TOKEN_SHA256===env.HIVE_CARDS_BRIDGE_TOKEN_SHA256)return reply({status:'role_configuration_rejected'},503);
  if(!authenticate(request.headers.get('authorization'),env.HIVE_CARDS_BRIDGE_TOKEN_SHA256))return reply({status:'unauthorized'},401);
  return reply({status:'connection_verified',scope:'cards_bridge',deliveryEnabled:false});
 }
 // All workflow operations gate before storage or provider calls. No live-send escape.
 if(context?.deploy?.context!=='production'||env.HIVE_CARDS_ENABLED!=='true')return reply({status:'disabled'},503);
 if(env.HIVE_CARDS_OWNER_TOKEN_SHA256&&env.HIVE_CARDS_OWNER_TOKEN_SHA256===env.HIVE_CARDS_BRIDGE_TOKEN_SHA256)return reply({status:'role_configuration_rejected'},503);
 if(kind==='control'&&request.method==='GET'&&new URL(request.url).protocol==='https:')return new URL(request.url).searchParams.get('asset')==='review'?ownerScript():ownerPage();
 if(new URL(request.url).protocol!=='https:'||request.method!=='POST')return reply({status:'method_or_tls_rejected'},405);
 const owner=kind==='control',bridge=kind==='bridge';
 if((owner||bridge)&&!authenticate(request.headers.get('authorization'),owner?env.HIVE_CARDS_OWNER_TOKEN_SHA256:env.HIVE_CARDS_BRIDGE_TOKEN_SHA256))return reply({status:'unauthorized'},401);
 try{
  const raw=Buffer.from(await request.arrayBuffer());if(raw.length>262144)return reply({status:'request_too_large'},413);
  const store=openStore();
  if(kind==='webhook'){const r=await receive({store,raw,signature:request.headers.get('X-HiveInspect-Signature'),instance:request.headers.get('X-Automation-Instance-Id'),env});return reply({status:r.status,eventId:r.eventId},r.code);}
  const body=JSON.parse(raw);
  if(bridge){
   if(body.action==='claimDraft')return reply(await claimDraft(store));
   if(body.action==='submitDraft')return reply(await submitDraft(store,body));
   if(body.action==='projections'){const r=await claimProjection(store);return reply({status:r.status,projectionToken:r.token,rows:r.job?[{...sheetProjection(r.job),rawRow:sheetRow(r.job)}]:[]});}
   if(body.action==='ack'){const j=(await readState(store)).jobs[body.jobId];if(!body.projectionToken||!j||!verifySheetReadback(j,body.headers,body.readback))throw Error('projection_readback_mismatch');return reply(await acknowledge(store,body));}
   // Bridge can never approve, import history or send cards.
   return reply({status:'action_forbidden'},403);
  }
  if(body.action==='queue'){const s=await readState(store);return reply({events:Object.values(s.events).filter(e=>e.status!=='DONE'),jobs:Object.values(s.jobs),projectionLease:s.projectionLease||null});}
  if(body.action==='history')return reply(await importHistory(store,body));
  if(body.action==='reconcileProjection')return reply(await reconcileProjection(store,body,env));
  // Staging is owner-only pending verified automatic completion/office mapping.
  if(body.action==='stage')return reply(await stage(store,{...body,organization:env.HIVE_CARD_ORGANIZATION_ID}));
  if(body.action==='resolveAgentConflict')return reply(await resolveAgentConflict(store,{...body,organization:env.HIVE_CARD_ORGANIZATION_ID}));
  if(body.action==='reevaluate')return reply(await reevaluate(store,{...body,organization:env.HIVE_CARD_ORGANIZATION_ID}));
  if(body.action==='retryEvent')return reply(await retryEvent(store,body.eventId));
  if(['officePreview','verifyOffice'].includes(body.action)){
   const office=await resolveOffice({read:read||createHiveReader({env}),agentId:body.agentId,mapping:mappingFrom(env)});
   if(body.action==='officePreview')return reply({office,reviewedOfficeHash:officeFingerprint(office)});
   return reply(await verifyOffice(store,{...body,office}));
  }
  if(body.action==='prepare'){
   const j=(await readState(store)).jobs[body.jobId];if(!j||j.revision!==body.revision||!['AWAITING_APPROVAL','APPROVED','MANUAL_REVIEW'].includes(j.status))throw Error('stale_review');
   return reply({jobId:j.id,revision:j.revision,text:body.text,artwork:body.artwork,reviewedFingerprint:reviewFingerprint(j,body.text,body.artwork)});
  }
  if(body.action==='review')return reply(await review(store,body));
  if(body.action==='dispatch')dispatch();
  return reply({status:'action_forbidden'},403);
 }catch{return reply({status:'held_for_review'},409);}
}
