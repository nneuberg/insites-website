import {getStore} from '@netlify/blobs';
import {run,STORE} from '../lib/admin-delivery-test.mjs';
// Private scheduled function: only dashboard Run now during the short fixed window.
// Its next scheduled invocation is after the immutable expiry.
export const config={schedule:'0 0 1 1 *'};
export default async()=>{
 try{const result=await run({store:getStore({name:STORE,consistency:'strong'}),env:process.env});console.log('ADMIN_DELIVERY_RESULT',JSON.stringify(result));}
 catch(e){console.log('ADMIN_DELIVERY_STOP',e.message);}
};
