import {getStore} from '@netlify/blobs';
import {auditStep,createHiveReader} from '../lib/hive-contact-audit.mjs';

export default async(_request,context)=>{
 // Gate before opening any store or obtaining the existing Hive environment key.
 if(context?.deploy?.context!=='production'||process.env.HIVE_CONTACT_AUDIT_ENABLED!=='true')return;
 try{
  const result=await auditStep({store:getStore({name:'insites-hive-contact-audit',consistency:'strong'}),
   read:createHiveReader(),context:'production'});
  console.log('Hive contact audit',JSON.stringify(result));
 }catch{console.error('Hive contact audit storage unavailable; retry requires review.');}
};
// Scheduled functions have no publicly callable production URL. This function
// does nothing until its nonsecret audit flag and run ID are explicitly set.
export const config={schedule:'* * * * *'};
