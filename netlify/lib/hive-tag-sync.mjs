const normalize=name=>name.trim().toLowerCase();
const protectedTag=name=>/^review:/i.test(name)||normalize(name)==='feedback received';
export function tagChanges(hiveNames,mailchimpNames,knownHiveNames){
 if(![hiveNames,mailchimpNames,knownHiveNames].every(a=>Array.isArray(a)&&a.every(n=>typeof n==='string'&&n.trim())))throw Error('Incomplete tag data');
 const current=new Map(hiveNames.filter(n=>!protectedTag(n)).map(n=>[normalize(n),n]));
 const existing=new Set(mailchimpNames.map(normalize)),known=new Set(knownHiveNames.map(normalize));
 return [
  ...[...current].filter(([key])=>!existing.has(key)).map(([,name])=>({name,status:'active'})),
  ...mailchimpNames.filter(name=>!protectedTag(name)&&known.has(normalize(name))&&!current.has(normalize(name))).map(name=>({name,status:'inactive'}))
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
  const stateKey='tag-sync/'+(apply?'live':'audit');
  let state=await store.get(stateKey,{type:'json'})||{role:'Agent',cursor:null,cycleStarted:started};
  if(!state.pending?.length){
   const q=new URLSearchParams({role:state.role==='Agent'?'agent':'client',limit:'25'});
   if(state.cursor)q.set('cursor',state.cursor);
   const page=await engine.hive('contacts?'+q);
   if(!Array.isArray(page.data))throw Error('Incomplete contact page');
   state.pending=page.data.map(c=>({id:c.id,email:c.email}));state.next=page.next_cursor||null;
   await store.setJSON(stateKey,state);
  }
  const result={mode:apply?'live':'audit',checked:0,missingMembers:0,added:0,removed:0,protectedTags:'REVIEW:* and feedback received',cycleComplete:false};
  while(state.pending.length&&now()-started<35000){
   const contact=state.pending[0],email=String(contact.email||'').trim().toLowerCase();
   if(/^\S+@\S+\.\S+$/.test(email)){
    const matches=await engine.hive('contacts?'+new URLSearchParams({email,limit:'200'}));
    if(!Array.isArray(matches.data)||matches.next_cursor||!matches.data.length)throw Error('Incomplete email match');
    if(matches.data.some(c=>!Array.isArray(c.tags)||String(c.email).trim().toLowerCase()!==email))throw Error('Incomplete current Hive contact tags');
    const hiveNames=[...new Set(matches.data.flatMap(c=>c.tags.map(t=>t.name)))];
    const row={email,role:state.role};let member;
    try{member=await engine.mc(row,undefined,'GET');}catch(e){if(e.status!==404)throw e;result.missingMembers++;}
    if(member){
     if(!Array.isArray(member.tags))throw Error('Incomplete Mailchimp tags');
     const changes=tagChanges(hiveNames,member.tags.map(t=>t.name),known);
     if(apply&&changes.length)await engine.mc(row,{tags:changes},'POST','/tags');
     result.added+=changes.filter(t=>t.status==='active').length;result.removed+=changes.filter(t=>t.status==='inactive').length;
    }
   }
   state.pending.shift();result.checked++;await store.setJSON(stateKey,state);
  }
  if(!state.pending.length){
   state.cursor=state.next;delete state.next;delete state.pending;
   if(!state.cursor){if(state.role==='Agent')state.role='Customer';else{result.cycleComplete=true;result.cycleMinutes=Math.round((now()-state.cycleStarted)/60000);state={role:'Agent',cursor:null,cycleStarted:now(),lastCycleComplete:now()};}}
   await store.setJSON(stateKey,state);
  }
  await store.setJSON('tag-sync/last-'+result.mode,{...result,at:now()});return result;
 });
}
