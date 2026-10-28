import {walletMonitor} from './reward-wallet-monitor.mjs';
// The ledger mirror contains monitoring metadata only, never credentials or clients.
export async function checkWallet({store,readWallet,record,source='daily',now=()=>Date.now()}){
 const observedAt=now();
 let wallet;try{wallet=await readWallet();}catch{wallet={verified:false};}
 let data={id:'production-usd-v1',observedAt:new Date(observedAt).toISOString(),source,status:'unavailable',currency:'USD',balanceCents:null,thresholdCents:5000,low:null,alertSequence:null};
 if(wallet?.verified===true&&wallet.currency==='USD'&&Number.isSafeInteger(wallet.availableCents)&&wallet.availableCents>=0){
  const observer=walletMonitor({store,readBalance:async()=>wallet.availableCents,now:()=>observedAt});
  const result=await observer.check(source);
  const snapshot=await observer.snapshot();
  data={...data,status:'verified',balanceCents:result.balanceCents,low:result.low,alertSequence:snapshot.sequence};
 }
 const receipt=await record(data);
 if(receipt?.recorded!==true&&receipt?.unchanged!==true)throw Error('Wallet checkpoint not acknowledged');
 return {checked:data.status==='verified',mirrored:true,status:data.status,balanceCents:data.balanceCents,alertSequence:data.alertSequence};
}
