import {createHash} from 'node:crypto';
const normalize=name=>name.trim().toLowerCase();
// Only these automatic agent-status tags are owned for removal. A current or
// historical Hive catalog entry is NOT evidence of removal ownership.
export const REMOVABLE_HIVE_TAGS=Object.freeze([
 '1st time buying agent','new selling agent','repeat selling agent',
 'absent selling agent','absent buying agent','repeat buying agent',
 'super buying agent','vip buying agent','no business'
]);
const removableTags=new Set(REMOVABLE_HIVE_TAGS.map(normalize));
// Preserve the existing addition boundary; review workflow tags have other owners.
const protectedTag=name=>normalize(name).startsWith('review:')||normalize(name)==='feedback received';
// Defense in depth if the removal allowlist is edited in the future.
const operationalTag=name=>protectedTag(name)||normalize(name).startsWith('ref:')||normalize(name)==='google reviewed';
export function tagChanges(hiveNames,mailchimpNames,knownHiveNames){
 if(![hiveNames,mailchimpNames,knownHiveNames].every(a=>Array.isArray(a)&&a.every(n=>typeof n==='string'&&n.trim())))throw Error('Incomplete tag data');
 const current=new Map(hiveNames.filter(n=>!protectedTag(n)).map(n=>[normalize(n),n]));
 const existing=new Set(mailchimpNames.map(normalize));
 return [
  ...[...current].filter(([key])=>!existing.has(key)).map(([,name])=>({name,status:'active'})),
  ...mailchimpNames.filter(name=>!operationalTag(name)&&removableTags.has(normalize(name))&&!current.has(normalize(name))).map(name=>({name,status:'inactive'}))
 ];
}
const text=value=>typeof value==='string'&&value.trim().length>0;
const cursor=value=>value===null||text(value);
const validEmail=value=>typeof value==='string'&&/^\S+@\S+\.\S+$/.test(value.trim());
class RecordHold extends Error {}
class TickBudget extends Error {}
// Hive documents total across ALL matching pages, and explicit null at the end.
// Presence/identity checks are stricter destructive-sync safety preconditions;
// OpenAPI does not declare these properties required. Short pages are valid.
function listPage(value,label,{limit=Infinity,complete=false}={}){
 if(!value||!Array.isArray(value.data)||!Object.hasOwn(value,'next_cursor')||!cursor(value.next_cursor)||
    !Number.isSafeInteger(value.total)||value.total<0||value.data.length>limit||value.data.length>value.total||
    complete&&(value.next_cursor!==null||value.total!==value.data.length))throw Error('Incomplete '+label);
 const ids=value.data.map(row=>row?.id);
 if(ids.some(id=>!text(id))||new Set(ids).size!==ids.length)throw Error('Invalid identities in '+label);
 return value;
}
const emptyCoverage=()=>({version:1,verified:true,ids:[],cursors:[],total:null});
const backoff=attempts=>Math.min(60,5*2**Math.min(attempts-1,4))*60000;
const roles=['Agent','Customer'];
const emptyProgress=()=>({version:1,nextRole:'Agent',sourceKey:null,completed:[]});
const validProgress=p=>p?.version===1&&roles.includes(p.nextRole)&&Array.isArray(p.completed)&&
 p.completed.every(role=>roles.includes(role))&&new Set(p.completed).size===p.completed.length&&
 (p.sourceKey===null?p.completed.length===0:typeof p.sourceKey==='string'&&/^[a-f0-9]{64}$/.test(p.sourceKey));
const sourceKey=names=>createHash('sha256').update(JSON.stringify([...new Set(names.map(normalize))].sort())).digest('hex');
export async function reconcileHiveTags({engine,store,apply=false,now=()=>Date.now()}){
 return engine.locked('hive-tag-reconciliation',async()=>{
  const started=now(),mode=apply?'live':'audit';
  const save=async(key,value)=>{if((await store.setJSON(key,value))?.modified===false)throw Error('Sync checkpoint was not saved');};
  const checkBudget=deadline=>{if(now()-started>=deadline)throw new TickBudget();};
  let known;const reconciledEmails=new Set();
  async function refreshCatalog(){
   const catalog=listPage(await engine.hive('tags'),'Hive tag catalog',{complete:true});
   const names=catalog.data.map(t=>t.name);
   if(names.some(n=>!text(n)))throw Error('Invalid Hive tag catalog');
   const previous=await store.get('tag-sync/catalog',{type:'json'})||[];
   if(!Array.isArray(previous)||previous.some(n=>!text(n)))throw Error('Invalid saved Hive tag catalog');
   known=[...new Set([...previous,...names])];await save('tag-sync/catalog',known);
  }
  const holdKey='tag-sync/holds-'+mode,holds=await store.get(holdKey,{type:'json'})||{version:1,records:[]};
  if(holds.version!==1||!Array.isArray(holds.records)||holds.records.some(h=>!text(h.id)||!validEmail(h.email)||h.email!==normalize(h.email)||
     !Number.isSafeInteger(h.attempts)||h.attempts<1||![h.firstHeldAt,h.lastAttemptAt,h.nextAttemptAt].every(Number.isFinite)||!text(h.reason)||
     Object.hasOwn(h,'progress')&&!validProgress(h.progress))||
     new Set(holds.records.map(h=>h.email)).size!==holds.records.length)throw Error('Invalid saved tag-sync holds');
  const result={mode,recentChecked:0,fullChecked:0,missingMembers:0,skippedEmails:0,added:0,removed:0,
   removalPolicy:'automatic-agent-status-v1',removableTags:REMOVABLE_HIVE_TAGS,protectedTags:'Every tag outside removableTags',
   sourcePolicy:'validated-counted-source-v1',retryPolicy:'fresh-audience-progress-v1',held:0,deferred:0,retried:0,resolvedHolds:0,retryAudiencesCompleted:0,
   cycleComplete:false,fullTraversalComplete:false,fullCoverage:'in-progress',budgetExhausted:false};
  async function currentTags(email){
   const matches=listPage(await engine.hive('contacts?'+new URLSearchParams({email,limit:'200'})),'email match',{limit:200,complete:true});
   if(matches.data.some(c=>typeof c.email!=='string'||normalize(c.email)!==email))throw Error('Mismatched email lookup');
   if(!matches.data.length)throw new RecordHold('source-contact-not-found');
   if(matches.data.some(c=>!Array.isArray(c.tags)||c.tags.some(t=>!text(t?.name))))throw new RecordHold('invalid-source-contact-tags');
   return [...new Set(matches.data.flatMap(c=>c.tags.map(t=>t.name)))];
  }
  async function currentMember(row){
   let member;
   try{member=await engine.mc(row,undefined,'GET');}catch(e){if(e.status!==404)throw e;return null;}
   if(!Array.isArray(member?.tags)||member.tags.some(t=>!text(t?.name)))throw Error('Incomplete Mailchimp tags');
   return member;
  }
  async function reconcile(contact,deadline){
   // Leave one shared 12-second request timeout before the 30-second platform cap.
   deadline=Math.min(deadline,18000);
   const email=String(contact.email||'').trim().toLowerCase();
   if(!validEmail(email)){result.skippedEmails++;return;}
   checkBudget(deadline);
   const hiveNames=await currentTags(email);
   for(const role of roles){
    const row={email,role};let member;
    checkBudget(deadline);
    try{member=await engine.mc(row,undefined,'GET');}catch(e){if(e.status!==404)throw e;result.missingMembers++;continue;}
    if(!Array.isArray(member?.tags))throw Error('Incomplete Mailchimp tags');
    const changes=tagChanges(hiveNames,member.tags.map(t=>t?.name),known);
    if(apply&&changes.length){checkBudget(deadline);await engine.mc(row,{tags:changes},'POST','/tags');}
    result.added+=changes.filter(t=>t.status==='active').length;result.removed+=changes.filter(t=>t.status==='inactive').length;
   }
  }
  async function hold(contact,error){
   const email=normalize(contact.email);
   if(!holds.records.some(h=>h.email===email)){
    holds.records.push({id:contact.id,email,firstHeldAt:now(),lastAttemptAt:now(),attempts:1,nextAttemptAt:now()+backoff(1),reason:error.message});
    // This must be durable BEFORE discovery acknowledges the pending contact.
    await save(holdKey,holds);result.held++;
   }
  }
  // At most ONE due hold per tick, oldest due first. Reserve its next attempt
  // durably before I/O, so an interruption cannot starve other held contacts.
  const due=holds.records.filter(h=>h.nextAttemptAt<=now()).sort((a,b)=>a.nextAttemptAt-b.nextAttemptAt||a.lastAttemptAt-b.lastAttemptAt||a.email.localeCompare(b.email))[0];
  if(due&&now()-started<18000){
   const progress=due.progress??=emptyProgress();
   const role=progress.completed.includes(progress.nextRole)?roles.find(r=>!progress.completed.includes(r))??progress.nextRole:progress.nextRole;
   // Rotate the audience before I/O as well as reserving the held record's turn.
   // A crash cannot force every later attempt back through Agent first.
   progress.nextRole=roles.find(r=>r!==role);
   due.attempts++;due.lastAttemptAt=now();due.nextAttemptAt=now()+backoff(due.attempts);await save(holdKey,holds);result.retried++;
   try{
    checkBudget(18000);
    // Only one audience per retry. Fresh read-only requests overlap, including
    // catalog validation: three individually slow reads cannot consume three
    // sequential request timeouts before a write. Never persist source/member tags.
    const row={email:due.email,role};
    const reads=await Promise.allSettled([refreshCatalog(),currentTags(due.email),currentMember(row)]);
    const failures=reads.filter(r=>r.status==='rejected').map(r=>r.reason);
    const failure=failures.find(e=>!(e instanceof RecordHold))??failures[0];
    if(failure)throw failure; // A global failure wins over an isolated malformed record.
    const hiveNames=reads[1].value,member=reads[2].value,key=sourceKey(hiveNames);
    if(progress.sourceKey!==key){
     progress.sourceKey=key;progress.completed=[];
     await save(holdKey,holds); // Invalidate obsolete completion BEFORE any write.
    }
    const changes=member?tagChanges(hiveNames,member.tags.map(t=>t.name),known):[];
    if(!member)result.missingMembers++;
    if(apply&&changes.length){checkBudget(18000);await engine.mc(row,{tags:changes},'POST','/tags');}
    result.added+=changes.filter(t=>t.status==='active').length;result.removed+=changes.filter(t=>t.status==='inactive').length;
    progress.completed=[...new Set([...progress.completed,role])];
    due.nextAttemptAt=now()+5*60000;
    await save(holdKey,holds);result.retryAudiencesCompleted++;
    if(progress.completed.length===roles.length){
     holds.records=holds.records.filter(h=>h!==due);await save(holdKey,holds);result.resolvedHolds++;reconciledEmails.add(due.email);
    }
   }catch(error){
    if(error instanceof RecordHold){due.reason=error.message;progress.sourceKey=null;progress.completed=[];await save(holdKey,holds);}
    else if(error instanceof TickBudget)result.budgetExhausted=true;
    else throw error; // Auth, rate limit, transport, JSON, page and destination failures stop the run.
   }
  }else await refreshCatalog();
  // Fast pass checks changes; the full pass also checks unchanged imported contacts.
  for(const pass of ['recent','full']){
   const key='tag-sync/all-'+mode+'-'+pass,deadline=pass==='recent'?18000:25000;
   if(now()-started>=deadline){result.budgetExhausted=true;continue;}
   let state=await store.get(key,{type:'json'})||{cursor:null,cycleStarted:started,since:started-5*60000};
   if(!cursor(state.cursor)||![state.since,state.cycleStarted].every(Number.isFinite)||
      Object.hasOwn(state,'pending')&&(!Array.isArray(state.pending)||!cursor(state.next)))throw Error('Invalid saved scan state');
   if(!state.coverage){
    state.coverage=emptyCoverage();
    // Legacy pending work is consumed, but unknown earlier pages cannot be certified.
    state.coverage.verified=state.cursor===null&&!Object.hasOwn(state,'pending');
   }
   let coverage=state.coverage;
   if(coverage.version!==1||typeof coverage.verified!=='boolean'||!Array.isArray(coverage.ids)||!Array.isArray(coverage.cursors)||
      coverage.ids.some(id=>!text(id))||new Set(coverage.ids).size!==coverage.ids.length||coverage.cursors.some(c=>!cursor(c))||
      new Set(coverage.cursors).size!==coverage.cursors.length||!(coverage.total===null||Number.isSafeInteger(coverage.total)&&coverage.total>=0))throw Error('Invalid saved scan coverage');
   if(state.restartRequired){
    if(Object.hasOwn(state,'pending'))throw Error('Cannot restart pending work');
    state.cursor=null;state.cycleStarted=now();state.coverage=coverage=emptyCoverage();delete state.restartRequired;
    // Persist the deliberate restart before fetching; retain since/completion watermarks.
    await save(key,state);
   }
   try{
    if(!Object.hasOwn(state,'pending')){
     const query=new URLSearchParams({limit:'25'});
     if(pass==='recent')query.set('updated_since',new Date(state.since).toISOString());
     if(state.cursor!==null)query.set('cursor',state.cursor);
     checkBudget(Math.min(deadline,18000));
     const page=listPage(await engine.hive('contacts?'+query),'contact page',{limit:25});
     if(page.data.some(c=>!Object.hasOwn(c,'email')||!(c.email===null||typeof c.email==='string')))throw Error('Incomplete discovery contact');
     const ids=page.data.map(c=>c.id),nextCount=coverage.ids.length+ids.length;
     const problem=coverage.total!==null&&coverage.total!==page.total?'changed-total':
      ids.some(id=>coverage.ids.includes(id))?'repeated-contact':
      coverage.cursors.includes(state.cursor)||page.next_cursor!==null&&(page.next_cursor===state.cursor||coverage.cursors.includes(page.next_cursor))?'repeated-cursor':
      coverage.verified&&(nextCount>page.total||page.next_cursor===null&&nextCount!==page.total)?'inconsistent-terminal-count':null;
     if(problem){
      // Do not accept this page or advance its cursor. The next tick starts a
      // counted traversal with the SAME since filter; this is not a dedup reset.
      state.restartRequired={reason:problem,at:now()};await save(key,state);throw Error('Unverified scan coverage: '+problem);
     }
     coverage.ids.push(...ids);coverage.cursors.push(state.cursor);coverage.total=page.total;
     state.pending=page.data.map(c=>({id:c.id,email:c.email}));state.next=page.next_cursor;state.total=page.total;
     await save(key,state);
    }
    while(state.pending.length){
     checkBudget(Math.min(deadline,18000));
     const contact=state.pending[0];
     if(!text(contact?.id)||!Object.hasOwn(contact,'email'))throw Error('Invalid saved pending contact');
     const existing=validEmail(contact.email)&&(reconciledEmails.has(normalize(contact.email))||holds.records.some(h=>h.email===normalize(contact.email)));
     if(existing)result.deferred++;
     else{
      try{await reconcile(contact,deadline);result[pass+'Checked']++;}
      catch(error){
       if(error instanceof TickBudget){
        // A slow valid record must not repeatedly monopolize the front of a page.
        // Keep it durably queued for the same fresh, resumable audience retries.
        result.budgetExhausted=true;await hold(contact,new RecordHold('reconciliation-budget'));
       }else if(error instanceof RecordHold)await hold(contact,error);
       else throw error;
      }
     }
     state.pending.shift();await save(key,state);
    }
    state.cursor=state.next;delete state.next;delete state.pending;
    if(state.cursor===null){
     const verified=coverage.verified&&coverage.ids.length===coverage.total;
     if(pass==='full'){
      result.fullCoverage=verified?'verified':'legacy-unverified';result.fullTraversalComplete=verified;
      result.cycleComplete=verified&&holds.records.length===0;result.fullContacts=verified?coverage.ids.length:null;
      result.cycleMinutes=Math.round((now()-state.cycleStarted)/60000);
     }
     if(verified){
      // A held record has its own durable retry; advancing discovery cannot drop it.
      state.since=state.cycleStarted-5*60000;state.lastTraversalComplete=now();
      if(!holds.records.length){state.lastCycleComplete=now();state.lastVerifiedCycleComplete=now();}
     }
     state.cycleStarted=now();state.coverage=emptyCoverage();
    }
    await save(key,state);
   }catch(error){if(!(error instanceof TickBudget))throw error;result.budgetExhausted=true;}
  }
  result.unresolvedHolds=holds.records.length;result.partial=holds.records.length>0||result.budgetExhausted;
  await save('tag-sync/last-'+mode,{...result,at:now()});return result;
 });
}
