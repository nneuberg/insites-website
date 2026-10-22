export {handle as default} from '../lib/client-test/runtime.mjs';
export const config={path:'/api/review-client-test/:action',rateLimit:{windowLimit:20,windowSize:60,aggregateBy:['ip','domain']}};
