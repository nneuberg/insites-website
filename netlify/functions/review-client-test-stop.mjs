import {store} from '../lib/client-test/runtime.mjs';
export const config={schedule:'0 0 1 1 *'};
export default async()=>{await store().setJSON('safety/stopped',{at:Date.now()});console.log('CLIENT_TEST_STOPPED')};
