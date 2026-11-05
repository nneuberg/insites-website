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

// A turn is an attempt allocation, not proof of completion. The existing
// owner-checked lease serializes phase work while valid; CAS fences its pointer.
const TURN_KEY='review-work-turn-v1';
const PHASES=['followups','discovery','google'];
export async function runReviewScheduledTurn({store,engine,work,googleAvailable=false,onClaim=()=>{},run}){
 let entered=false;
 try{return await engine.locked('review-scheduled-work-v1',async()=>{
  entered=true;
  const prior=await store.getWithMetadata(TURN_KEY,{type:'json'});
  if(prior&&(!prior.etag||prior.data?.schema!==1||!PHASES.includes(prior.data.nextPhase)))throw Error('Review work turn unavailable');
  const legacy=prior?null:await read(store);
  let phase=prior?.data.nextPhase||legacy?.data.nextPhase||'followups';
  if(phase==='google'&&!googleAvailable)phase='followups';
  const nextPhase=phase==='followups'?'discovery':phase==='discovery'&&googleAvailable?'google':'followups';
  const saved=await store.setJSON(TURN_KEY,{schema:1,nextPhase},prior?{onlyIfMatch:prior.etag}:{onlyIfNew:true});
  if(typeof saved?.modified!=='boolean')throw Error('Review work turn uncertain');
  if(!saved.modified)return{processed:0,turnDeferred:true,followupsDeferred:true,sourceWorkDeferred:true,googleDeferred:true};
  onClaim(phase);work?.check();
  return{...await run(phase),scheduledPhase:phase,phaseStarted:true};
 });}catch(error){
  // Only a busy outer lease is a no-work deferral. Inner provider/notice errors
  // keep their ordinary classification; no foreign lease is cleared.
  if(!entered&&error?.message==='Request busy; retry later')return{processed:0,turnDeferred:true,schedulerBusy:true,followupsDeferred:true,sourceWorkDeferred:true,googleDeferred:true};
  throw error;
 }
}
