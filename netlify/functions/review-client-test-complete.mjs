import {openHarness} from '../lib/client-test/runtime.mjs';
// Private dashboard invocation only; fixed expiry precedes next scheduled invocation.
export const config={schedule:'0 0 1 1 *'};
export default async()=>{try{console.log('CLIENT_TEST_RESULT',JSON.stringify(await openHarness().complete()))}catch(e){console.log('CLIENT_TEST_STOP',e.message)}};
