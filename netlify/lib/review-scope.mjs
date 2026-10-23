// Retain the prelaunch record, but never process it or offer it as a match.
export const EXCLUDED_REQUEST='af5f27d00c687529de2a9de77009826f385c689bb01911da';
export const excludedRequest=key=>key===EXCLUDED_REQUEST||key==='requests/'+EXCLUDED_REQUEST;
export function roleCutoff(role,env){
 if(role==='Agent'&&env.REVIEW_AGENT_ENABLED!==undefined)return env.REVIEW_AGENT_ENABLED==='true'?Date.parse(env.REVIEW_AGENT_START_AFTER||''):NaN;
 return Date.parse(env.REVIEW_START_AFTER||'');
}
export function inReviewScope(row,env,key=row?.token){
 if(excludedRequest(key)||excludedRequest(row?.token)||!row)return false;
 if(env.REVIEW_CLIENT_ONLY!=='true'&&env.REVIEW_AGENT_ENABLED===undefined)return true;
 if(row.role==='Agent'&&env.REVIEW_BUYER_ONLY==='true'&&row.buyerAgentVerified!==true)return false;
 const cutoff=roleCutoff(row.role,env);
 return (row.role==='Customer'||(row.role==='Agent'&&env.REVIEW_CLIENT_ONLY!=='true'&&env.REVIEW_AGENT_ENABLED==='true'))&&Number.isFinite(cutoff)&&Number.isFinite(row.inspectionEndedAt)&&row.inspectionEndedAt>=cutoff&&Number.isFinite(row.createdAt)&&row.createdAt>=cutoff;
}
