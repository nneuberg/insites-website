// Import alone has no effects. Never expose this module through a public function route.
import {openHarness} from './runtime.mjs';
export async function runOperator(action,token){
 const h=openHarness();
 if(action==='begin')return h.begin();
 if(action==='notify'){await h.checkSuppression(token);return h.notify(token);}
 if(action==='stop')return h.stop();
 throw Error('Unsupported operator action');
}
