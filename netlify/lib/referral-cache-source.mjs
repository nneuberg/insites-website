import {createCachedHiveReader} from './hive-source-reader.mjs';
import {productionQualifiedCaseReader} from './referral-source-runtime.mjs';
import {referralSourceBarrier} from './referral-source-barrier.mjs';
import {sourceTimestampOK} from './referral-customer-history.mjs';

// A negative history result must come from one published cache generation.
// The strong store etag is checked after all pages and other source reads. Any
// concurrent publication holds this assessment; never infer an empty history.
// This adapter reads existing cache only and never calls the Hive transport.
export function cachedQualifiedCaseReader({services,readCaseFactory=productionQualifiedCaseReader,...options}){
 return async useId=>{
  if(!/^HIVE-[a-zA-Z0-9_-]{1,100}$/.test(useId))throw Error('Invalid case identifier');
  const before=await services.cache.read();
  if(typeof before?.etag!=='string'||!before.etag)throw Error('Source generation unavailable');
  const barrier=await referralSourceBarrier({store:services.store,inspectionId:useId.slice(5)});
  const readHive=createCachedHiveReader(services);
  const evidence=await readCaseFactory({...options,readHive})(useId);
  const currentBarrier=await referralSourceBarrier({store:services.store,inspectionId:useId.slice(5)});
  const after=await services.cache.read();
  if(after?.etag!==before.etag||currentBarrier!==barrier)throw Error('Source generation or barrier changed; qualification held');
  if(!sourceTimestampOK(evidence?.sourceValidUntil)||!Number.isFinite(Date.parse(evidence.sourceValidUntil))||Date.parse(evidence.sourceValidUntil)<=(options.now||Date.now)())throw Error('Source coverage expired during final barrier check');
  return evidence;
 };
}
