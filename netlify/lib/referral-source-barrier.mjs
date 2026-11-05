// Read-only qualification fence. Cache publication and pending-event/work writes
// are separate transactions, so a cache etag alone cannot certify current facts.
// This adds no source request, credential, queue mutation or launch authority.
const PREFIX='hive-source-events/pending/';
const WORK='hive-source-work/v1';
const idOK=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(x);
const etagOK=x=>typeof x==='string'&&!!x;
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const hold=()=>{throw Error('Referral source events or work require reconciliation');};

export async function referralSourceBarrier({store,inspectionId,maxPages=20}){
 if(typeof store?.getWithMetadata!=='function'||typeof store?.list!=='function'||!idOK(inspectionId)||!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>20)hold();
 const before=await store.getWithMetadata(WORK,{type:'json'});
 if(!before)hold();
 {
  const w=before.data;
  if(!etagOK(before.etag)||!object(w)||w.schema!==1||typeof w.globalRoleDirty!=='boolean'||w.globalRoleDirty||w.roleMappingUnknown!==false)hold();
  for(const k of ['pendingInspectionIds','refreshContactIds','invalidatedContactIds','invalidatedInspectionIds'])if(!Array.isArray(w[k])||w[k].some(x=>!idOK(x)))hold();
  // Negative customer history needs every invalidated inspection reconciled:
  // stale contact links can hide a prior order from the current customer index.
  if(w.refreshContactIds.length||w.invalidatedContactIds.length||w.invalidatedInspectionIds.length)hold();
 }
 let pages=0;
 for await(const page of store.list({prefix:PREFIX,paginate:true})){
  if(++pages>maxPages||!Array.isArray(page?.blobs))hold();
  // Any remaining pending-prefix row holds, including completed remnants. The
  // shared coordinator must archive it; no event body read or inference here.
  if(page.blobs.length)hold();
 }
 const after=await store.getWithMetadata(WORK,{type:'json'});
 if((before?.etag??null)!==(after?.etag??null)||after&&!etagOK(after.etag))hold();
 return JSON.stringify({work:before?.etag??null,events:[]});
}
