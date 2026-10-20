import {getStore} from '@netlify/blobs';
import {openHarness} from '../lib/synthetic-agent/runtime.mjs';
import {SCOPE} from '../lib/synthetic-agent/harness.mjs';
import {operate} from '../lib/synthetic-agent/private-operator.mjs';
export const config={schedule:'0 0 1 1 *'};
export default async ()=>{
 try{
  const store=getStore({name:SCOPE.store,consistency:'strong'});
  const harness='cleanup'==='cleanup'?null:openHarness();
  const result=await operate('cleanup',{store,harness,env:process.env});
  console.log('SYNTHETIC_OPERATOR_RESULT',JSON.stringify({action:'cleanup',...result}));
 }catch(e){console.log('SYNTHETIC_OPERATOR_STOP',JSON.stringify({action:'cleanup',error:e.message}));}
};
