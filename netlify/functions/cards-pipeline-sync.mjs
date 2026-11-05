import {cardRuntime,CARD_PIPELINE_PLAN} from '../lib/cards-runtime.mjs';
import {runCachedCardWorker} from '../lib/cards-source.mjs';
import {readState} from '../lib/cards-core.mjs';
import {runCardReceiptWorker} from '../lib/cards-dispatch.mjs';
// Platform-scheduled only. Never places an order or approves generated copy.
export default async(_request,context)=>{
 if(context?.deploy?.context!=='production'||(CARD_PIPELINE_PLAN.sourceEnabled!==true&&CARD_PIPELINE_PLAN.receiptEnabled!==true))return Response.json({status:'disabled',deliveryEnabled:false});
 try{
  const runtime=cardRuntime(context);let receipt='idle',source='disabled';
  if(CARD_PIPELINE_PLAN.receiptEnabled===true){
   receipt=(await runCardReceiptWorker({store:runtime.store,provider:runtime.provider,enabled:true})).status;
  }
  // Existing Zapier ChatGPT connection supplies the draft later through a scoped
  // claim/complete exchange. Initial staging must never call a paid model or send.
  if(CARD_PIPELINE_PLAN.sourceEnabled===true){
   const state=await readState(runtime.store);
   source=(await runCachedCardWorker({cache:runtime.source.cache,view:runtime.view,store:runtime.store,history:runtime.history,organization:state.cardLaunch?.organizationId,startAfter:state.cardLaunch?.startAfter,enabled:true,limit:1,generateCandidates:async()=>[]})).status;
  }
  const proof={status:'checked',source,receipt,deliveryEnabled:false};console.log('cards_pipeline',JSON.stringify(proof));return Response.json(proof);
 }catch{console.log('cards_pipeline',JSON.stringify({status:'held',deliveryEnabled:false}));return Response.json({status:'held',deliveryEnabled:false},{status:503});}
};
export const config={schedule:'7,22,37,52 * * * *'};
