import {handleCardApproval} from '../lib/cards-approval-http.mjs';
import {cardRuntime,CARD_PIPELINE_PLAN} from '../lib/cards-runtime.mjs';
export default (request,context)=>{
 let runtime;const services=()=>runtime||=cardRuntime(context);
 return handleCardApproval({request,context,role:'owner',env:{CARDS_APPROVAL_OWNER_SHA256:Netlify.env.get('CARDS_APPROVAL_OWNER_SHA256'),CARDS_APPROVAL_BRIDGE_SHA256:Netlify.env.get('CARDS_APPROVAL_BRIDGE_SHA256')},openStore:()=>services().store,getSourceView:()=>services().view,refreshHistory:()=>services().refresh(),history:{readComplete:()=>services().history.readComplete()},provider:()=>services().provider(),pipeline:CARD_PIPELINE_PLAN});
};
