// Scheduled functions have no public invocation URL. Dashboard invocation is read-only
// at the provider and writes only the private monitoring checkpoint.
export const config={schedule:'0 13 * * *'};
export default async(request,context)=>{
 if(context?.site?.id!=='a21b8d9c-9ce0-4114-985d-d77cabae32e9'||context?.deploy?.context!=='production')return new Response(null,{status:204});
 try{
  const [{getStore},{readProductionWallet},{checkWallet},{ledger}]=await Promise.all([import('@netlify/blobs'),import('../lib/reward-wallet-reader.mjs'),import('../lib/reward-wallet-check.mjs'),import('../lib/referral-transport.mjs')]);
  const env={REFERRAL_LEDGER_URL:Netlify.env.get('REFERRAL_LEDGER_URL'),REFERRAL_LEDGER_SECRET:Netlify.env.get('REFERRAL_LEDGER_SECRET')};
  const result=await checkWallet({store:getStore({name:'reward-wallet-monitor',consistency:'strong'}),readWallet:()=>readProductionWallet({key:Netlify.env.get('TREMENDOUS_API_KEY')}),record:data=>ledger('recordWalletObservation',data,env)});
  console.log(JSON.stringify(result));
 }catch{console.log(JSON.stringify({checked:false,mirrored:false,reason:'monitor-check-failed'}));}
 return new Response(null,{status:204});
};
