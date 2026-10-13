import {runtime,response,reviewStore} from '../lib/review-runtime.mjs';
import {googleSync} from '../lib/review-google.mjs';
export default async(_request,context)=>{
 try{const engine=runtime(context),result=await engine.run();const google=await googleSync({store:reviewStore(context),engine}).run();return response({...result,...google});}catch{console.error('Review campaign run failed; pending records remain available for retry.');return response({error:'Review processing requires retry'},503);}
};
export const config={schedule:'*/15 * * * *'};
