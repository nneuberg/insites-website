import {createHash} from 'node:crypto';
import {qualifiedCaseReader} from './referral-qualified-case.mjs';
import {assessReferralIdentity} from './referral-identity-evidence.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const ref=x=>typeof x==='string'&&x.trim().length>=3&&x.length<=500;
// Private injected operator authorization only: no HTTP handler, tokens, or new grant.
// The evidence and audit metadata commit together with CAS; no raw customer data in output.
export function qualificationEvidenceOperations({store,reviewStore,readHive,authorize,now=()=>Date.now()}){
 return {async record(command){
  const actor=await authorize?.(command);if(!actor?.authorized||!ref(actor.subject))throw Error('Authorized operator required');
  if(!/^[a-zA-Z0-9_-]{16,100}$/.test(command?.id||'')||!/^HIVE-[a-zA-Z0-9_-]{1,100}$/.test(command.useId||''))throw Error('Evidence command invalid');
  const key='qualification-inputs/'+hash(command.useId),old=await store.getWithMetadata(key,{type:'json'});
  const commandHash=hash(JSON.stringify(command.evidence));
  if(old?.data._audit?.commandId===command.id){if(old.data._audit.commandHash!==commandHash)throw Error('Evidence command conflict');return {recorded:false,replayed:true};}
  if((old?.etag||null)!==(command.expectedEtag||null))throw Error('Evidence changed; reread before editing');
  const e=structuredClone(command.evidence);if(!e||e.useId!==command.useId||e.inspectionId!==command.useId.slice(5)||!ref(e.evidenceReference)||e.evidenceVerified!==true)throw Error('Bound referenced evidence required');
  const until=Date.parse(e.validUntil);if(!Number.isFinite(until)||until<=now()||until>now()+86400000)throw Error('Evidence expiry must be within24hours');
  const identity=assessReferralIdentity({email:e.email,sourceContactIds:[e.sourceContactId],verifiedAliases:e.verifiedAliases||[],sharedEmailEvidence:e.sharedEmailEvidence,sourceConflictEvidence:e.sourceConflictEvidence});
  if(identity.status!=='usable-exact-identifier')throw Error('Concrete identity conflict requires review');
  for(const name of ['bookingProvenanceVerified','consumerReferrerVerified','codeAssociationVerified','distinctPeopleVerified','noPriorRewardVerified'])if(e[name]!==true||!ref(e.references?.[name]))throw Error('Specific qualification references required');
  if(!ref(e.referrerId)||!ref(e.code)||!/^\S+@\S+\.\S+$/.test(e.referrerEmail||''))throw Error('Referrer binding required');
  if(e.operatorCompletion&&(!e.operatorCompletion.authorized||!e.operatorCompletion.verified||e.operatorCompletion.inspectionId!==e.inspectionId||!ref(e.operatorCompletion.reference)||!Number.isFinite(Date.parse(e.operatorCompletion.verifiedAt))))throw Error('Specific completion attestation required');
  const staged={get:async k=>k===key?e:store.get(k,{type:'json'})};
  const candidate=await qualifiedCaseReader({store:staged,reviewStore,readHive,now})(command.useId);
  if(candidate.facts.sourceContactId!==e.sourceContactId||String(candidate.facts.clientEmail).trim().toLowerCase()!==String(e.email).trim().toLowerCase())throw Error('Current source identity mismatch');
  // A valid record may still be held for incomplete history; never turn unknown into new.
  e._audit={commandId:command.id,commandHash,actor:actor.subject,recordedAt:new Date(now()).toISOString(),priorEtag:old?.etag||null};
  const saved=await store.setJSON(key,e,old?{onlyIfMatch:old.etag}:{onlyIfNew:true});if(!saved.modified)throw Error('Evidence changed; no overwrite');
  return {recorded:true,newCustomerVerified:candidate.facts.newCustomerVerified===true,eligibleNotAsserted:true};
 }};
}
