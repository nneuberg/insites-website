import {reviewEnvironment} from '../lib/review-launch.mjs';
import {runtime,response,reviewStore} from '../lib/review-runtime.mjs';
import {googleSync} from '../lib/review-google.mjs';
export default async(_request,context)=>{
 try{const engine=runtime(context),result=await engine.run();const google=await googleSync({store:reviewStore(context),engine,env:reviewEnvironment()}).run();console.log('Review campaign result',JSON.stringify({paused:result.paused===true,read:result.read||0,processed:result.processed||0,googlePaused:google.googlePaused===true,baselineCreated:google.baselineCreated===true,notified:google.notified||0}));return response({...result,...google});}catch{console.error('Review campaign run failed; pending records remain available for retry.');return response({error:'Review processing requires retry'},503);}
};
export const config={schedule:'*/15 * * * *'};
