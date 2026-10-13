import {runtime,reviewStore,response} from '../lib/review-runtime.mjs';
import {reconcileHiveTags} from '../lib/hive-tag-sync.mjs';
export default async(_request,context)=>{
 if(context?.deploy?.context!=='production')return response({skipped:true});
 try{const result=await reconcileHiveTags({engine:runtime(context),store:reviewStore(context),apply:false});console.log('Hive tag reconciliation',JSON.stringify(result));return response(result);}
 catch(error){console.error('Hive tag reconciliation needs attention:',error.message);return response({error:'Tag reconciliation requires retry'},503);}
};
export const config={schedule:'*/5 * * * *'};
