// Cache-only bounded candidate discovery. Proof is reevaluated by the producer.
export async function discoverPrograms({config,cache,producer,cursor=0,now=()=>Date.now(),deadline=now()+180000}){
 if(config.producerEnabled!==true)return{off:true,cursor,considered:0,enrolled:0};
 const {state}=await cache.read(),rows=Object.values(state.contacts||{}).sort((a,b)=>a.id.localeCompare(b.id));let index=Math.max(0,cursor),read=0,considered=0,enrolled=0;
 for(;index<rows.length&&read<250&&considered<Math.min(5,Number.isSafeInteger(config.maxDiscovery)&&config.maxDiscovery>0?config.maxDiscovery:2)&&now()<deadline-60000;index++,read++){
  const r=rows[index];if(r.deleted||!Array.isArray(r.emails)||r.emails.length!==1||!r.data?.tags?.some(t=>t.name?.trim().toLowerCase()==='no business'))continue;
  considered++;try{const result=await producer.enroll(r.emails[0]);if(result.enrolled)enrolled++;}catch{/* Uncertain source/provider/ledger admission stays unstarted. */}
 }
 return{cursor:index>=rows.length?0:index,considered,enrolled};
}
