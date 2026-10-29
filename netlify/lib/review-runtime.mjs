import {HIVE_INCIDENT} from './hive-incident.mjs';
import {reviewEnvironment} from './review-launch.mjs';
import {getStore} from '@netlify/blobs';
import {createEngine} from './review-engine.mjs';
export function reviewStore(functionContext){
 const context=functionContext?.deploy?.context||process.env.CONTEXT||'local';
 // Preview and local runs never touch production feedback records.
 const name=context==='production'?'insites-review-campaign':'insites-review-campaign-'+(functionContext?.deploy?.id||process.env.DEPLOY_ID||'local');
 return getStore({name,consistency:'strong'});
}
export function runtime(functionContext){return createEngine({store:reviewStore(functionContext),env:reviewEnvironment(),hivePaused:HIVE_INCIDENT.paused});}
export const response=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'}});
