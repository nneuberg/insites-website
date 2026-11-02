import catalog from './marketing-program-catalog.cjs';
import {operationId} from './marketing-admission-client.mjs';
import {nativeNoBusiness} from './marketing-eligibility.mjs';
const groups=m=>{const i=m?.interests||{},c=catalog.classification;return{complete:i[c.completeInterest],engaged:i[c.engagedInterest],never:i[c.neverInterest]};};
export function createProgramProducer({config,client,provider,sourceNoBusiness,now=()=>Date.now()}){
 async function enroll(email,program='nb-intro-v1'){
  if(config.producerEnabled!==true)return{off:true};
  const proof=await sourceNoBusiness(email);if(proof.eligible!==true)return{held:true};
  const primary=await provider.member(config.audiences[0],email),other=await provider.member(config.audiences[1],email);if(!primary||!nativeNoBusiness(primary)||other?.status==='subscribed')return{held:true};
  const personId=await client.register(email,config.audiences,proof.contactIds);
  return client.command(personId,'enrollProgram',{personId,program,intentPrefix:operationId('program',personId,program),sourceProof:{schema:'hive-nobusiness-v1',verified:true,currentNoBusiness:true,conflicts:false,bookingStop:false,contactIds:proof.contactIds,observedAt:proof.observedAt}});
 }
 async function progress(personKey,state){
  if(config.producerEnabled!==true)return{off:true};
  const person=Object.values(state.people).find(x=>!x.parent),intro=person?.programs?.['nb-intro-v1'];if(!person||person.stops.length||person.quarantine.length||person.programStops?.['nb-intro-v1']?.length)return{held:true};
  if(intro&&!intro.progressDoneAt&&now()>=intro.anchorAt+70*catalog.DAY){
   const c=intro.classification,e=config.completionExecutor;
   if(c?.completedAt){const program=c.branch==='observed-engaged'?'nb-evergreen-v1':'nb-permission-v1';await enroll(person.email,program);if((await client.snapshot(personKey)).state.people[person.id].programs?.[program])await client.command(personKey,'programProgressDone',{personId:person.id,program:'nb-intro-v1'});return{completed:true};}
   if(e?.verified!==true)return{held:true};
   if(!c){
    const proof=await sourceNoBusiness(person.email);if(proof.stop){await client.stop(personKey,'business',catalog.NB_PROGRAMS);return{stopped:true};}if(proof.eligible!==true)return{held:true};
    const m=await provider.member(e.audienceId,person.email);if(!nativeNoBusiness(m))return{held:true};const baseline={verified:true,...groups(m),memberKey:client.memberKey(e.audienceId,person.email),observedAt:now()};
    const begin=await client.command(personKey,'beginClassification',{personId:person.id,binding:JSON.stringify(e),baseline},operationId('classify',personKey));if(begin.trigger)try{await provider.trigger(begin.executor,person.email);}catch{/* Uncertain zero-email attempt is never retriggered. */}return{attempted:begin.trigger};
   }
   const poll=await client.command(personKey,'beginClassificationPoll',{personId:person.id},operationId('classification-poll',personKey,c.polls));if(!poll.poll)return{held:true};
   const m=await provider.member(e.audienceId,person.email),g=groups(m);if(g.complete===true&&typeof g.engaged==='boolean'&&typeof g.never==='boolean'&&g.engaged!==g.never){await client.command(personKey,'completeClassification',{personId:person.id,proof:{verified:true,...g,memberKey:client.memberKey(e.audienceId,person.email),journeyId:e.journeyId,graphVersion:e.graphVersion,observedAt:now()}});return{classified:true};}
  }
  const permission=person.programs?.['nb-permission-v1'];if(permission){const intents=Object.values(state.intents).filter(i=>i.program==='nb-permission-v1'),sent=Object.values(state.permits).filter(p=>intents.some(i=>i.id===p.intentId)&&p.state==='sent'),original=sent.find(p=>state.intents[p.intentId].stage==='o1'),latest=Math.max(0,...sent.map(p=>p.firstSentObservedAt));if(original&&now()>=Math.max(permission.anchorAt+74*catalog.DAY,original.firstSentObservedAt+14*catalog.DAY,latest+7*catalog.DAY)&&intents.every(i=>['sent','skipped','held','no_send','expired'].includes(i.state)))await client.command(personKey,'programProgressDone',{personId:person.id,program:'nb-permission-v1'});}
  return{held:true};
 }
 return{enroll,progress};
}
