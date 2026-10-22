// Retain the prelaunch record, but never process it or offer it as a match.
export const EXCLUDED_REQUEST='af5f27d00c687529de2a9de77009826f385c689bb01911da';
export const excludedRequest=key=>key===EXCLUDED_REQUEST||key==='requests/'+EXCLUDED_REQUEST;
export function inReviewScope(row,env,key=row?.token){
 if(excludedRequest(key)||excludedRequest(row?.token)||!row)return false;
 if(env.REVIEW_CLIENT_ONLY!=='true')return true;
 const cutoff=Date.parse(env.REVIEW_START_AFTER||'');
 return row.role==='Customer'&&Number.isFinite(cutoff)&&Number.isFinite(row.inspectionEndedAt)&&row.inspectionEndedAt>=cutoff&&Number.isFinite(row.createdAt)&&row.createdAt>=cutoff;
}
