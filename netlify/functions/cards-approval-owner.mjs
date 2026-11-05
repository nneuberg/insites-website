import {CARD_HISTORY_PLAN,createCardSheetClient,refreshSheetHistory} from '../lib/cards-sheet-runtime.mjs';
import {getStore} from '@netlify/blobs';
import {handleCardApproval} from '../lib/cards-approval-http.mjs';
import {sourceServices} from '../lib/hive-source-runtime.mjs';
export default (request,context)=>handleCardApproval({request,context,role:'owner',env:{CARDS_APPROVAL_OWNER_SHA256:Netlify.env.get('CARDS_APPROVAL_OWNER_SHA256'),CARDS_APPROVAL_BRIDGE_SHA256:Netlify.env.get('CARDS_APPROVAL_BRIDGE_SHA256')},openStore:()=>getStore({name:'insites-agent-cards',consistency:'strong'}),getSourceView:()=>sourceServices(context).view,refreshHistory:CARD_HISTORY_PLAN.enabled?(store=>refreshSheetHistory({store,sheet:createCardSheetClient()})):undefined});
