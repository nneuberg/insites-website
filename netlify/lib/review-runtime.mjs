import {getStore} from '@netlify/blobs';
import {createEngine} from './review-engine.mjs';
export function reviewStore(){
 const context=process.env.CONTEXT||'local';
 // Preview and local runs never touch production feedback records.
 const name=context==='production'?'insites-review-campaign':'insites-review-campaign-'+(process.env.DEPLOY_ID||'local');
 return getStore({name,consistency:'strong'});
}
export function runtime(){return createEngine({store:reviewStore()});}
export const response=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'}});
