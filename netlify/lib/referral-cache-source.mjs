import {createCachedHiveReader} from './hive-source-reader.mjs';
import {productionQualifiedCaseReader} from './referral-source-runtime.mjs';

// A negative history result must come from one published cache generation.
// The strong store etag is checked after all pages and other source reads. Any
// concurrent publication holds this assessment; never infer an empty history.
// This adapter reads existing cache only and never calls the Hive transport.
export function cachedQualifiedCaseReader({services,readCaseFactory=productionQualifiedCaseReader,...options}){
 return async useId=>{
  const before=await services.cache.read();
  if(typeof before?.etag!=='string'||!before.etag)throw Error('Source generation unavailable');
  const readHive=createCachedHiveReader(services);
  const evidence=await readCaseFactory({...options,readHive})(useId);
  const after=await services.cache.read();
  if(after?.etag!==before.etag)throw Error('Source generation changed; qualification held');
  return evidence;
 };
}
