import {getStore} from '@netlify/blobs';
import {policy} from '../lib/preview-policy.mjs';
import {testHandler} from '../lib/test-handler.mjs';
export default (request,context)=>testHandler({policy,request,context,
 openStore:()=>getStore({name:`isolated-${policy.run}-${context.deploy.id}`,consistency:'strong'})});
export const config={rateLimit:{action:'rate_limit',aggregateBy:'domain',windowSize:60,windowLimit:100}};
