// Authenticated OFF-installation observations. Reads only six fixed store keys and
// the first pending-event page; returns counts/booleans/times, never identities.
import {createHash} from 'node:crypto';
const obj=x=>x&&typeof x==='object'&&!Array.isArray(x);
const n=x=>Number.isSafeInteger(x)&&x>=0?x:null;
const b=x=>typeof x==='boolean'?x:null;
const count=x=>obj(x)?Object.keys(x).length:null;
const length=x=>Array.isArray(x)?x.length:null;
const choice=(x,allowed)=>allowed.includes(x)?x:null;
const coverage=c=>({complete:b(c?.complete),scope:choice(c?.scope,['all','selective']),watermark:n(c?.watermark),historyComplete:b(c?.historyComplete)});
export async function installationSourceReadiness({store,now=()=>Date.now()}){
 const keys=['hive-source-cache/post-repair-20261031','hive-source-work/v1','hive-source-coordinator/v1','hive-source/transport-v1','hive-source/leases/'+createHash('sha256').update('hive-source-coordinator').digest('hex'),'hive-source-tags/v1'];
 const [cache,work,coord,transport,lease,tags]=await Promise.all(keys.map(key=>store.get(key,{type:'json'})));
 let firstPageCount=0,pendingPageRead=false;
 for await(const page of store.list({prefix:'hive-source-events/pending/',paginate:true})){
  if(!Array.isArray(page?.blobs))throw Error('Source metadata unavailable');
  firstPageCount=page.blobs.length;pendingPageRead=true;break;
 }
 const conflicts=obj(cache?.conflicts)?Object.keys(cache.conflicts):null;
 const safeReasons=['Unexpected inspection identity','Incomplete or inconsistent pagination','Duplicate or wrong source identities','Pagination cycle','Incomplete coverage','Incomplete source record','Incomplete contact authority','Incomplete contact tags or roles','Missing source revision','Invalid source calendar time','Invalid source revision','Invalid normalized source record','Invalid normalized email identities','source-page-invalid'];
 return {observedAt:now(),cache:{present:cache!=null,schema:n(cache?.schema),contacts:count(cache?.contacts),inspections:count(cache?.inspections),coverage:{contacts:coverage(cache?.coverage?.contacts),inspections:coverage(cache?.coverage?.inspections)},contactConflicts:conflicts?.filter(k=>k.startsWith('contacts:')).length??null,inspectionConflicts:conflicts?.filter(k=>k.startsWith('inspections:')).length??null},work:{present:work!=null,schema:n(work?.schema),globalRoleDirty:b(work?.globalRoleDirty),roleMappingUnknown:b(work?.roleMappingUnknown),pendingInspectionCount:length(work?.pendingInspectionIds),refreshContactCount:length(work?.refreshContactIds),invalidatedContactCount:length(work?.invalidatedContactIds),invalidatedInspectionCount:length(work?.invalidatedInspectionIds)},events:{firstPageCount,pendingPageRead,empty:firstPageCount===0,exactTotal:false},coordinator:{present:coord!=null,schema:n(coord?.schema),quarantined:b(coord?.quarantined),resumeAfter:n(coord?.resumeAfter),active:coord?.active==null?false:true,kind:choice(coord?.active?.kind,['contacts','inspections']),purpose:choice(coord?.active?.purpose,['baseline','delta','pending','contacts','roles','contacts-safety','hourly','photo-conflict-recheck','customer-role-recheck']),pages:n(coord?.active?.traversal?.pages),rows:length(coord?.active?.traversal?.rows),total:n(coord?.active?.traversal?.total),hourlyAt:n(coord?.hourlyAt),contactsAt:n(coord?.contactsAt),fullRolesAt:n(coord?.fullRolesAt),validationAt:n(coord?.validationFailure?.at),validationReason:choice(coord?.validationFailure?.reason,safeReasons)},transport:{present:transport!=null,version:n(transport?.version),attempts:n(transport?.attempts),successes:n(transport?.successes),failures:n(transport?.failures),notBefore:n(transport?.notBefore),blocked:transport?.blocked===null?false:typeof transport?.blocked==='string'?true:null,blockReason:choice(transport?.blocked,['uncertain-write','monthly-quota','credentials-or-access','quota-headers-unverified','provider-quota-reserve','included-quota-exhausted']),inFlight:transport?.inFlight===null?false:obj(transport?.inFlight)?true:null,inFlightUntil:n(transport?.inFlight?.until),lastReservationAt:n(transport?.lastReservationAt)},lease:{present:lease!=null,until:n(lease?.until),acquiredAt:n(lease?.acquiredAt),quarantined:b(lease?.quarantined),fence:n(lease?.fence)},tags:{present:tags!=null,schema:n(tags?.schema),checkedAt:n(tags?.checkedAt),count:length(tags?.data)}};
}
