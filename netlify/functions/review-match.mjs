import {runtime,response,reviewStore} from '../lib/review-runtime.mjs';
import {createMatchHandler} from '../lib/review-match-handler.mjs';
export default (request,context)=>createMatchHandler({store:reviewStore(context),engine:runtime(context),response})(request);
export const config={path:'/api/review-match',rateLimit:{windowLimit:20,windowSize:60,aggregateBy:['ip','domain']}};
