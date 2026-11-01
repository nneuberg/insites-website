import {createHash} from 'node:crypto';

const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const serialized=x=>JSON.stringify(canonical(x));
const hash=x=>createHash('sha256').update(serialized(x)).digest('hex');
const authKeys=new Set(['AWSAccessKeyId','Signature','Expires','X-Amz-Algorithm','X-Amz-Credential','X-Amz-Date','X-Amz-Expires','X-Amz-SignedHeaders','X-Amz-Signature','X-Amz-Security-Token']);
function mediaComparison(a,b){
 try{
  const old=new URL(a),incoming=new URL(b);
  const redactAuthValues=value=>{
   const fragmentAt=value.indexOf('#'),head=fragmentAt<0?value:value.slice(0,fragmentAt),fragment=fragmentAt<0?'':value.slice(fragmentAt),queryAt=head.indexOf('?');
   if(queryAt<0)return value;
   return head.slice(0,queryAt+1)+head.slice(queryAt+1).replace(/(^|&)(AWSAccessKeyId|Signature|Expires|X-Amz-Algorithm|X-Amz-Credential|X-Amz-Date|X-Amz-Expires|X-Amz-SignedHeaders|X-Amz-Signature|X-Amz-Security-Token)=[^&]*/g,'$1$2=[redacted]')+fragment;
  };
  const nonAuth=u=>[...u.searchParams].filter(([k])=>!authKeys.has(k)).sort((x,y)=>serialized(x).localeCompare(serialized(y)));
  const changedAuthKeys=[...authKeys].filter(k=>serialized(old.searchParams.getAll(k))!==serialized(incoming.searchParams.getAll(k)));
  return {sameRawResourceWithAuthValuesRedacted:redactAuthValues(a)===redactAuthValues(b),sameOrigin:old.origin===incoming.origin,samePath:old.pathname===incoming.pathname,sameFragment:old.hash===incoming.hash,sameNonAuthQuery:serialized(nonAuth(old))===serialized(nonAuth(incoming)),sameUserInfo:old.username===incoming.username&&old.password===incoming.password,sameAuthParameterMultiplicity:[...authKeys].every(k=>old.searchParams.getAll(k).length===incoming.searchParams.getAll(k).length),changedAuthKeys};
 }catch{return {parseable:false};}
}
// Private diagnostic evidence only: no raw records, values or signed URLs.
// Deterministic so replayed traversal publication has identical output.
export function inspectionConflictDiagnostic(old,incoming){
 const paths=[];let truncated=false;
 function walk(a,b,path,depth=0){
  if(serialized(a)===serialized(b))return;
  if(paths.length>=100){truncated=true;return;}
  if(Buffer.byteLength(path,'utf8')>512){truncated=true;return;}
  if(depth<12&&a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)){
   for(const k of [...new Set([...Object.keys(a),...Object.keys(b)])].sort())walk(a[k],b[k],path+'/'+k.replaceAll('~','~0').replaceAll('/','~1'),depth+1);
  }else paths.push(path);
 }
 walk(old,incoming,'');
 return {schema:1,revision:incoming.revision,oldHash:hash(old),incomingHash:hash(incoming),changedPaths:paths,pathsTruncated:truncated,coverPhotoComparison:mediaComparison(old.data?.cover_photo_url,incoming.data?.cover_photo_url)};
}
