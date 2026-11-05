// Scheduling progress only. It grants no eligibility or send capability and never
// edits review rows. CAS prevents an overlapping invocation rewinding the cursor.
const KEY='review-followup-scan-v1';
const valid=x=>x===null||typeof x==='string'&&x.startsWith('requests/')&&x.length<=220;
async function read(store){
 const prior=await store.getWithMetadata(KEY,{type:'json'});
 if(prior&&(!prior.etag||prior.data?.schema!==1||!valid(prior.data.after)||prior.data.nextPhase!==undefined&&!['discovery','google'].includes(prior.data.nextPhase)))throw Error('Review scan progress unavailable');
 return prior;
}
export async function createReviewScanProgress(store){
 const prior=await read(store),after=prior?.data.after??null;let reached=after===null,last=after;
 return {
  includes(key){if(reached)return true;if(key===after)reached=true;return false;},
  visited(key){if(!valid(key)||key===null)throw Error('Review scan key invalid');last=key;},
  complete(){last=null;},
  async save(){
   if(last===after)return;
   // A removed cursor key causes a normal wrap after listing, not a row reset.
   const data={schema:1,after:last,...(prior?.data.nextPhase?{nextPhase:prior.data.nextPhase}:{})};
   const result=await store.setJSON(KEY,data,prior?{onlyIfMatch:prior.etag}:{onlyIfNew:true});
   if(typeof result?.modified!=='boolean')throw Error('Review scan progress uncertain');
  }
 };
}
// Rotate optional work on finite-backlog tail opportunities. This grants only
// an attempt, not phase completion. Google may still exceed one invocation.
export async function claimReviewOptionalPhase(store,{googleAvailable=false}={}){
 if(!googleAvailable)return 'discovery';
 const prior=await read(store),phase=prior?.data.nextPhase||'discovery';
 const data={schema:1,after:prior?.data.after??null,nextPhase:phase==='discovery'?'google':'discovery'};
 const result=await store.setJSON(KEY,data,prior?{onlyIfMatch:prior.etag}:{onlyIfNew:true});
 if(typeof result?.modified!=='boolean')throw Error('Review scan progress uncertain');
 return result.modified?phase:'deferred';
}
