import {getStore} from '@netlify/blobs';
import {createCardSheetClient,runCardHistory,CARD_HISTORY_PLAN} from '../lib/cards-sheet-runtime.mjs';
// Netlify config.schedule disables URL invocation at the platform boundary.
// Production context alone is NOT authentication; retain schedule and verify deployed 404.
// Scheduled invocation only. No HTTP write route and no Cardly dispatch capability.
export default async (_request,context)=>{
 if(!CARD_HISTORY_PLAN.enabled||context?.deploy?.context!=='production')return Response.json({status:'disabled',deliveryEnabled:false});
 try{const result=await runCardHistory({production:true,store:getStore({name:'insites-agent-cards',consistency:'strong'}),sheet:createCardSheetClient()});const proof={status:result.status,rowCount:Number.isSafeInteger(result.rowCount)?result.rowCount:null,projection:result.projection||null,deliveryEnabled:false};console.log('cards_history_sync',JSON.stringify(proof));return Response.json(proof);}
 catch{console.log('cards_history_sync',JSON.stringify({status:'history_sync_held',rowCount:null,projection:null,deliveryEnabled:false}));return Response.json({status:'history_sync_held',deliveryEnabled:false}, {status:503});}
};
export const config={schedule:'*/15 * * * *'};
