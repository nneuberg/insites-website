// One scheduled-run work deadline below the repeatedly observed ~15s scheduler
// response wait, distinct from Netlify's documented 30s execution ceiling.
// Reserve about three seconds for owner-checked cleanup and the final response.
export const REVIEW_WORK_MS=12000;
export class ReviewWorkDeferred extends Error {
 constructor(){super('Review work deferred');this.code='REVIEW_WORK_DEFERRED';}
}
export const isReviewWorkDeferred=error=>error?.code==='REVIEW_WORK_DEFERRED';
export const isReviewDeadlineError=(error,work)=>isReviewWorkDeferred(error)||!!work&&(error?.message==='Ledger work expired'||work.remaining()===0&&['AbortError','TimeoutError'].includes(error?.name));
export function createReviewWorkBudget({now=()=>Date.now(),workMs=REVIEW_WORK_MS}={}){
 if(!Number.isSafeInteger(workMs)||workMs<1||workMs>REVIEW_WORK_MS)throw Error('Invalid review work budget');
 const started=now(),deadline=started+workMs;let phase='review';
 const remaining=()=>Math.max(0,deadline-now());
 const canStart=(minimumMs=1000)=>remaining()>=minimumMs;
 const check=(minimumMs=1000)=>{if(!canStart(minimumMs))throw new ReviewWorkDeferred();};
 const mark=value=>{if(!['review','discovery','followups','google'].includes(value))throw Error('Invalid review phase');phase=value;};
 const wrapFetch=(fetcher=fetch)=>async(url,options={})=>{
  check();const signal=AbortSignal.timeout(Math.max(1,remaining()));
  try{return await fetcher(url,{...options,signal:options.signal?AbortSignal.any([options.signal,signal]):signal});}
  catch(error){if(signal.aborted||remaining()===0)throw new ReviewWorkDeferred();throw error;}
 };
 return {deadline,remaining,elapsed:()=>Math.max(0,now()-started),canStart,check,mark,wrapFetch,get phase(){return phase;}};
}
export function reviewFailureCategory(error){
 if(isReviewWorkDeferred(error)||error?.message==='Ledger work expired')return 'work_deadline';
 if(error?.message==='Request busy; retry later')return 'row_busy';
 if(['AbortError','TimeoutError'].includes(error?.name))return 'upstream_timeout';
 if(['Ledger not connected','Invalid ledger URL','Existing ledger secret unavailable'].includes(error?.message))return 'ledger_configuration';
 if(error?.message==='Executor manifest change requires explicit migration')return 'manifest_mismatch';
 if(['Ledger operation failed','Ledger unavailable'].includes(error?.message))return 'ledger_unconfirmed';
 if(['Google authorization requires attention','Google reviews unavailable','Invalid Google location'].includes(error?.message))return 'google_unavailable';
 return 'unclassified_failure';
}
