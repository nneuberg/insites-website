export {handle as default} from '../lib/synthetic-agent/runtime.mjs';
export const config={path:'/api/review-synthetic-agent/:action',rateLimit:{windowLimit:20,windowSize:60,aggregateBy:['ip','domain']}};
