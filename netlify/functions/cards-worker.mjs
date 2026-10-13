import {getStore} from '@netlify/blobs';
import {createHiveReader} from '../lib/cards-adapters.mjs';
import {workerStep,mappingFrom} from '../lib/cards-worker.mjs';
export default async(_request,context)=>{
 if(context?.deploy?.context!=='production'||process.env.HIVE_CARDS_ENABLED!=='true'||process.env.HIVE_CARDS_WORKER_ENABLED!=='true')return;
 try{
  mappingFrom(process.env); // fail before opening private store or reading Hive
  const result=await workerStep({store:getStore({name:'insites-agent-cards',consistency:'strong'}),read:createHiveReader(),env:process.env});
  console.log('Card draft worker',JSON.stringify({status:result.status}));
 }catch{console.error('Card draft worker held; review configuration/storage.');}
};
// No schedule is exported: even a disabled installation must not create recurring
// invocations/compute. Add a schedule only in a separately approved activation.
// Separate flags remain OFF, and this worker has no Cardly transport.
