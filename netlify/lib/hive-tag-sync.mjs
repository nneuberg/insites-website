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
export async function reconcileHiveTags({engine,store,apply=false,now=()=>Date.now()}){
 return engine.locked('hive-tag-reconciliation',async()=>{
  const started=now(),catalog=await engine.hive('tags');
  if(!Array.isArray(catalog.data)||catalog.next_cursor)throw Error('Incomplete Hive tag catalog');
  const names=catalog.data.map(t=>t.name);
  if(names.some(n=>typeof n!=='string'||!n.trim()))throw Error('Invalid Hive tag catalog');
  const previous=await store.get('tag-sync/catalog',{type:'json'})||[];
  const known=[...new Set([...previous,...names])];await store.setJSON('tag-sync/catalog',known);
  const result={mode:apply?'live':'audit',recentChecked:0,fullChecked:0,missingMembers:0,added:0,removed:0,removalPolicy:'automatic-agent-status-v1',removableTags:REMOVABLE_HIVE_TAGS,protectedTags:'Every tag outside removableTags',cycleComplete:false};
  async function reconcile(contact){
   const email=String(contact.email||'').trim().toLowerCase();
   if(!/^\S+@\S+\.\S+$/.test(email))return;
   const matches=await engine.hive('contacts?'+new URLSearchParams({email,limit:'200'}));
   if(!Array.isArray(matches.data)||matches.next_cursor||!matches.data.length)throw Error('Incomplete email match');
   if(matches.data.some(c=>!Array.isArray(c.tags)||String(c.email).trim().toLowerCase()!==email))throw Error('Incomplete current Hive contact tags');
   const hiveNames=[...new Set(matches.data.flatMap(c=>c.tags.map(t=>t.name)))];
   for(const role of ['Agent','Customer']){
    const row={email,role};let member;
    try{member=await engine.mc(row,undefined,'GET');}catch(e){if(e.status!==404)throw e;result.missingMembers++;continue;}
    if(!Array.isArray(member.tags))throw Error('Incomplete Mailchimp tags');
    const changes=tagChanges(hiveNames,member.tags.map(t=>t.name),known);
    if(apply&&changes.length)await engine.mc(row,{tags:changes},'POST','/tags');
    result.added+=changes.filter(t=>t.status==='active').length;result.removed+=changes.filter(t=>t.status==='inactive').length;
   }
  }
  // Fast pass checks changes; the full pass also checks unchanged imported contacts.
  for(const pass of ['recent','full']){
   const key='tag-sync/all-'+result.mode+'-'+pass;
   let state=await store.get(key,{type:'json'})||{cursor:null,cycleStarted:started,since:started-5*60000};
   if(!state.pending?.length){
    const query=new URLSearchParams({limit:'25'});
    if(pass==='recent')query.set('updated_since',new Date(state.since).toISOString());
    if(state.cursor)query.set('cursor',state.cursor);
    const page=await engine.hive('contacts?'+query);
    if(!Array.isArray(page.data))throw Error('Incomplete contact page');
    state.pending=page.data.map(c=>({id:c.id,email:c.email}));state.next=page.next_cursor||null;state.total=page.total;
    await store.setJSON(key,state);
   }
   const deadline=pass==='recent'?18000:35000;
   while(state.pending.length&&now()-started<deadline){
    await reconcile(state.pending[0]);state.pending.shift();result[pass+'Checked']++;await store.setJSON(key,state);
   }
   if(!state.pending.length){
    state.cursor=state.next;delete state.next;delete state.pending;
    if(!state.cursor){
     if(pass==='full'){result.cycleComplete=true;result.fullContacts=state.total;result.cycleMinutes=Math.round((now()-state.cycleStarted)/60000);}
     // Overlap protects changes near the polling boundary.
     state.since=state.cycleStarted-5*60000;state.cycleStarted=now();state.lastCycleComplete=now();
    }
    await store.setJSON(key,state);
   }
  }
  await store.setJSON('tag-sync/last-'+result.mode,{...result,at:now()});return result;
 });
}
