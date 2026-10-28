// Prepared only. No route activation until provider/domain/signing setup is approved.
export const RESEND_RECEIPTS_ENABLED=true;
export default async request=>{
 if(!RESEND_RECEIPTS_ENABLED)return new Response(null,{status:503});
 if(request.method!=='POST')return new Response(null,{status:405});
 const secret=Netlify.env.get('RESEND_REWARDS_WEBHOOK_SECRET'),key=Netlify.env.get('REFERRAL_CLAIM_ENCRYPTION_KEY');
 if(!secret||!key)return new Response(null,{status:503});
 // Bound streaming reads, including requests without Content-Length.
 const reader=request.body?.getReader();if(!reader)return new Response(null,{status:400});
 let size=0;const chunks=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();return new Response(null,{status:413});}chunks.push(value);}
 const raw=Buffer.concat(chunks).toString('utf8');
 const {verifySvix}=await import('../lib/referral-transport.mjs');
 try{verifySvix(raw,request.headers,secret);}catch{return new Response(null,{status:401});}
 try{
  const [{getStore},{claimVault},{resendReceipts}]=await Promise.all([import('@netlify/blobs'),import('../lib/claim-vault.mjs'),import('../lib/referral-resend-receipts.mjs')]);
  await resendReceipts({store:getStore({name:'insites-referral-claims',consistency:'strong'}),vault:claimVault(key),secret,enabled:true})(raw,request.headers);
  return new Response(null,{status:200});
 }catch{return new Response(null,{status:503});} // Provider replay; no body/token logs.
};
