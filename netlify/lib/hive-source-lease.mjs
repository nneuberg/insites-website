import {createHash,randomUUID} from 'node:crypto';
export class HiveSourceLeaseError extends Error {
 constructor(reason){super('Hive source lease: '+reason);this.name='HiveSourceLeaseError';this.code='HIVE_SOURCE_LEASE';this.reason=reason;}
}
const fail=reason=>{throw new HiveSourceLeaseError(reason);};
// Requires a shared, strongly consistent store with atomic conditional writes.
// Read-scan coordination only: an expired lease may be reclaimed. Never use this
// to decide whether an uncertain external write can be retried.
export function createHiveSourceLease({store,now=()=>Date.now(),leaseMs=30000,workMs=10000}={}){
 if(!Number.isSafeInteger(workMs)||workMs<1||workMs>10000||!Number.isSafeInteger(leaseMs)||leaseMs<workMs+1000||leaseMs>120000)throw Error('Invalid source lease duration');
 async function withLease(name,fn){
  if(typeof name!=='string'||!name.trim()||typeof fn!=='function')throw Error('Invalid source lease');
  const key='hive-source/leases/'+createHash('sha256').update(name).digest('hex'),owner=randomUUID(),started=now();
  if(!Number.isSafeInteger(started)||started<0)fail('invalid-clock');
  const prior=await store.getWithMetadata(key,{type:'json'});
  if(prior&&(!prior.etag||!prior.data||typeof prior.data.owner!=='string'||!Number.isSafeInteger(prior.data.fence)||prior.data.fence<1||!Number.isSafeInteger(prior.data.until)||prior.data.until<0||!Number.isSafeInteger(prior.data.acquiredAt)||prior.data.acquiredAt<0))fail('invalid-checkpoint');
  if(prior?.data.acquiredAt>started)fail('clock-regressed');
  if(prior?.data.quarantined)fail('uncertain-work-quarantined');
  if(prior?.data.until>started)fail('busy');
  const fence=(prior?.data.fence||0)+1;
  if(!Number.isSafeInteger(fence))fail('fence-exhausted');
  const record={owner,fence,acquiredAt:started,until:started+leaseMs};
  if((await store.setJSON(key,record,prior?{onlyIfMatch:prior.etag}:{onlyIfNew:true}))?.modified!==true)fail('acquire-conflict');
  const controller=new AbortController(),deadline=started+workMs;let finished=false,timer,timedOut=false;
  async function assertHeld(){
   const t=now();
   if(finished||controller.signal.aborted||t>=deadline||t<started)fail('work-expired');
   const current=await store.getWithMetadata(key,{type:'json'});
   if(current?.data?.owner!==owner||current.data.fence!==fence||current.data.until<=now()||now()>=deadline||finished||controller.signal.aborted)fail('ownership-lost');
   return {owner,fence};
  }
  const lease=Object.freeze({owner,fence,deadline,signal:controller.signal,assertHeld});
  try{
   await assertHeld();
   const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{timedOut=true;controller.abort();reject(new HiveSourceLeaseError('work-timeout'));},workMs);});
   const result=await Promise.race([Promise.resolve().then(()=>fn(lease)),timeout]);
   await assertHeld();return result;
  }finally{
   finished=true;controller.abort();clearTimeout(timer);
   const current=await store.getWithMetadata(key,{type:'json'});
   // A timed-out callback may still have an external mutation in flight.
   // Permanently quarantine that owner until an operator reconciles the outcome;
   // neither lease expiry nor callback completion authorizes automatic replay.
   // Only release our own fence. A reclaimed lease always has another owner
   // and fence; an old callback cannot release its successor.
   if(current?.data?.owner===owner&&current.data.fence===fence){
    if(!current.etag||(await store.setJSON(key,{...current.data,until:timedOut?current.data.until:0,quarantined:timedOut},{onlyIfMatch:current.etag}))?.modified!==true)fail('release-unconfirmed');
   }
  }
 }
 return {withLease};
}
// Publication contract: call assertHeld immediately before publication, and CAS
// the destination against its previously read generation/fence. Lease checking
// and a different record's write are NOT one atomic operation. A consumer must
// also reject lower fencing tokens at its publication boundary. Abort/timeout
// cannot forcibly stop JS callbacks; callbacks must honor signal/assertHeld.
