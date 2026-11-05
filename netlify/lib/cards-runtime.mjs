import {getStore} from '@netlify/blobs';
import {sourceServices} from './hive-source-runtime.mjs';
import {createCardSheetClient,refreshSheetHistory} from './cards-sheet-runtime.mjs';
import {createCardlyClient} from './cardly-provider.mjs';
import {readState} from './cards-core.mjs';
import {attachCardHistoryAudit} from './cards-history-audit.mjs';
import {auditAgentCardHistory} from './cards-history-bootstrap.mjs';
import {createCardSourceView} from './cards-business-source.mjs';
export const CARD_PIPELINE_PLAN=Object.freeze({sourceEnabled:false,draftBridgeEnabled:false,receiptEnabled:false,version:'owner-reviewed-card-pipeline-v1'});
export function cardRuntime(context){
 const store=getStore({name:context?.deploy?.context==='production'?'insites-agent-cards':'insites-agent-cards-disabled',consistency:'strong'});
 const source=sourceServices(context),sheet=createCardSheetClient();
 const provider=()=>createCardlyClient({mode:'live',apiKey:Netlify.env.get('CARDLY_LIVE_API_KEY')});
 const history={ensureAgent:(agentId,recipient)=>auditAgentCardHistory({store,sheet,provider:provider(),agentId,recipient}),async readComplete(){
  const snapshot=await sheet.readComplete(),state=await readState(store),now=Date.now();
  return attachCardHistoryAudit({snapshot,state,now});
 }};
 const view=createCardSourceView({view:source.view,cache:source.cache,store:source.store});
 return {store,source,view,sheet,history,refresh:()=>refreshSheetHistory({store,sheet,strictAudit:true}),provider};
}
