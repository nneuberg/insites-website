import {getStore} from '@netlify/blobs';
import {auditStep,createHiveReader,auditWindow} from '../lib/hive-contact-audit.mjs';

export default async(_request,context)=>{
 // Gate before opening any store or obtaining the existing Hive environment key.
 if(context?.deploy?.context!=='production'||process.env.HIVE_CONTACT_AUDIT_ENABLED!=='true')return;
 if(!auditWindow(process.env))return;
 try{
  const result=await auditStep({store:getStore({name:'insites-hive-contact-audit',consistency:'strong'}),
   read:createHiveReader(),context:'production'});
  console.log('Hive contact audit',JSON.stringify(result));
 }catch{console.error('Hive contact audit storage unavailable; retry requires review.');}
};
// Netlify Run now requires a scheduled function. There is no minute polling.
// Annual scheduler ticks do zero storage/API work outside the <=1h audit window.
// Owner manually uses Run now per page, then disables the flag/removes function.
// This is not advertised as a true one-time infrastructure schedule.
export const config={schedule:'@yearly'};
