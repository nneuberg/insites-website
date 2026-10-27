import {createClaims} from './referral-claims.mjs';
import {claimVault} from './claim-vault.mjs';
import {invitations} from './referral-invitations.mjs';
import {qualifiedLedger} from './referral-qualification-integration.mjs';
import {RUN} from './referral-qualification-test-fixture.mjs';
// No provider transport or email transport imports. No production secret access.
export async function runSynthetic({store,ledger,fixture,now=()=>Date.now()}){
 if(fixture.run!==RUN||fixture.cases.length!==4||fixture.cases.some(c=>!c.useId.startsWith('HIVE-'+RUN+'-')||!c.identityInput.email.endsWith('@example.invalid')))throw Error('Synthetic fixture mismatch');
 const started=await store.setJSON('run-guard',{run:RUN,startedAt:now()},{onlyIfNew:true});
 if(!started.modified)return {run:RUN,blocked:'already-started; inspect existing evidence, do not retry'};
 let mockPurchases=0,mockEmails=0,ledgerCalls=0;const orders=new Map(),deadline=now()+50000;
 const boundedLedger=async(action,data)=>{if(now()>=deadline||++ledgerCalls>24)throw Error('Bounded test budget exhausted');return ledger(action,data);};
 const verified=qualifiedLedger({ledger:boundedLedger,launchCutoff:fixture.cutoff,now:()=>new Date(now()).toISOString(),readCase:async id=>fixture.cases.find(c=>c.useId===id)});
 const provider={purchaseIntent:{productId:'OKMHM2X2OHYV',product:'Amazon.com gift card',amount:25,currency:'USD',delivery:'LINK'},async create(i){if(i.email!=='owner@example.invalid')throw Error('Synthetic owner required');mockPurchases++;const o={id:RUN+'-order-'+mockPurchases,external_id:i.externalId,status:'EXECUTED',created_at:new Date(now()).toISOString(),rewards:[{id:RUN+'-reward-'+mockPurchases,recipient:{email:i.email},value:{denomination:25,currency_code:'USD'},delivery:{method:'LINK'}}]};orders.set(i.externalId,o);return o},async lookup(id){return orders.get(id)||null},async link(){return 'https://example.invalid/mock-reward'}};
 const vault=claimVault('c'.repeat(64)),claims=createClaims({store,ledger:verified.call,provider,vault,enabled:true,now}),messages=[];
 const mail=invitations({store,claims,vault,ledger:verified.call,enabled:true,now,suppression:async email=>email==='owner@example.invalid',send:async m=>{if(m.to.length!==1||m.to[0]!=='owner@example.invalid')throw Error('Synthetic owner required');mockEmails++;messages.push(m);return {id:RUN+'-mock-email-'+mockEmails}}});
 const result={run:RUN,passed:false,mockPurchases:0,mockEmails:0};
 try{
  const first=await verified.refresh(fixture.cases[3].useId);result.firstObservationHeld=first.ready===false;
  const tokens=[];const firstCase=fixture.cases[0];await mail.prepare(firstCase.useId);await mail.deliver(firstCase.useId);tokens.push(messages.at(-1).text.match(/claim\/#([a-f0-9]{64})/)[1]);
  for(const c of fixture.cases.slice(1,3))tokens.push((await claims.prepare(c.useId)).token);
  result.noPurchaseOnInvitation=mockPurchases===0;for(const token of tokens)await claims.details(token);result.noPurchaseOnStatus=mockPurchases===0;
  const same=await Promise.allSettled(tokens.slice(0,2).map(t=>claims.claim(t,true)));
  result.sameCustomerOne= same.filter(r=>r.status==='fulfilled'&&r.value.state==='issued').length===1&&mockPurchases===1;
  const winner=tokens[same.findIndex(r=>r.status==='fulfilled'&&r.value.state==='issued')];
  if(winner)await claims.claim(winner,true);result.replayOne=mockPurchases===1;
  result.distinctIssued=(await claims.claim(tokens[2],true)).state==='issued';
  result.mockPurchases=mockPurchases;result.mockEmails=mockEmails;
  result.passed=result.firstObservationHeld&&result.noPurchaseOnInvitation&&result.noPurchaseOnStatus&&result.sameCustomerOne&&result.replayOne&&result.distinctIssued&&mockPurchases===2&&mockEmails===1;
 }catch{result.failure='Synthetic integration stopped; inspect sanitized result and owned rows before any retry';result.mockPurchases=mockPurchases;result.mockEmails=mockEmails;}
 result.ledgerCalls=ledgerCalls;await store.setJSON('result',result);return result;
}
