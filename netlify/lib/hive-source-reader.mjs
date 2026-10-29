import {assertSourceAuthority,normalizeSourceEmail} from './hive-source-cache.mjs';
// Compatibility for qualification's exact-email/history reader, entirely local.
// No unsupported query can fall back to an independent Hive request.
export function createCachedHiveReader({cache,view,now=()=>Date.now()}){
 return async path=>{
  const url=new URL(path,'https://cache.invalid/'),q=url.searchParams;
  if(url.origin!=='https://cache.invalid')throw Error('Unsupported cache read');
  if(/^\/inspections\/[-a-zA-Z0-9_]+$/.test(url.pathname)&&!url.search)return view.getInspection(url.pathname.split('/').at(-1));
  const cursor=q.get('cursor')||'0';if(!/^\d+$/.test(cursor))throw Error('Invalid local cursor');
  const offset=Number(cursor);if(!Number.isSafeInteger(offset)||offset<0)throw Error('Invalid local cursor');
  let rows;
  if(url.pathname==='/contacts'&&q.has('email')&&[...q.keys()].every(k=>['email','limit','cursor'].includes(k))){
   const email=normalizeSourceEmail(q.get('email'));rows=(await view.listAllContacts()).filter(c=>normalizeSourceEmail(c.email)===email);
  }else if(url.pathname==='/inspections'&&q.has('contact_id')&&[...q.keys()].every(k=>['contact_id','include_canceled','include_deleted','limit','cursor'].includes(k))){
   const {state}=await cache.read();assertSourceAuthority(state,'inspections',{now:now(),maxAgeMs:86400000,requireHistory:true});
   rows=[];
   for(const record of Object.values(state.inspections)){
    if(!Array.isArray(record.data.contacts))throw Error('Incomplete inspection history');
    if(record.data.contacts.some(c=>c.id===q.get('contact_id')&&c.role==='Customer')){
     // Existing policy ignores deleted/canceled, but preserve their explicit facts.
     if(record.deleted)rows.push(structuredClone(record.data));else rows.push(await view.getInspection(record.id));
    }
   }
  }else throw Error('Unsupported cached source read');
  rows.sort((a,b)=>a.id.localeCompare(b.id));return {data:rows.slice(offset,offset+200),total:rows.length,next_cursor:offset+200<rows.length?String(offset+200):null};
 };
}
