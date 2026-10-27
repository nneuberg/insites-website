import {createCipheriv,createDecipheriv,randomBytes,timingSafeEqual} from 'node:crypto';
export const WINDOW=Object.freeze({notBefore:1793066400000,expires:1793070000000});
export const config={schedule:'0 0 1 1 *'};
const SITE='a21b8d9c-9ce0-4114-985d-d77cabae32e9',TEAM='BPA77L2JCYAQ',PRODUCT='OKMHM2X2OHYV';
const AAD='insites-production-recovery-check-v1';
export function encryptionCheck(value,{challenge=false,now=Date.now()}={}){
 if(typeof value!=='string'||! /^[a-f0-9]{64}$/i.test(value))return {encryptionFormatValid:false,encryptionRoundTrip:false};
 const key=Buffer.from(value,'hex'),iv=randomBytes(12),plain=Buffer.from(JSON.stringify({purpose:AAD,issuedAt:now,expiresAt:now+3600000}));
 try{
  const enc=createCipheriv('aes-256-gcm',key,iv);enc.setAAD(Buffer.from(AAD));const data=Buffer.concat([enc.update(plain),enc.final()]),tag=enc.getAuthTag();
  const dec=createDecipheriv('aes-256-gcm',key,iv);dec.setAAD(Buffer.from(AAD));dec.setAuthTag(tag);const recovered=Buffer.concat([dec.update(data),dec.final()]);
  const r={encryptionFormatValid:true,encryptionRoundTrip:recovered.length===plain.length&&timingSafeEqual(recovered,plain)};
  // Optional synthetic ciphertext only; never key/hash/fingerprint. Not enabled in handler.
  if(challenge)r.recoveryChallenge={version:1,aad:AAD,iv:iv.toString('hex'),tag:tag.toString('hex'),data:data.toString('base64')};
  return r;
 }finally{key.fill(0);plain.fill(0);}
}
export async function check({context,window=WINDOW,now=Date.now(),env,fetcher=fetch}){
 const r={diagnostic:'provider-readiness-v1',checked:false};
 if(context?.site?.id!==SITE||context?.deploy?.context!=='production')return {...r,reason:'context-blocked'};
 if(!Number.isFinite(window.notBefore)||!Number.isFinite(window.expires)||window.notBefore<=0||window.expires<=window.notBefore||window.expires-window.notBefore>3600000||now<window.notBefore||now>=window.expires)return {...r,reason:'window-closed'};
 const start=new Date(window.notBefore),end=new Date(window.expires-1);
 if(start.getUTCFullYear()!==end.getUTCFullYear()||(start.getUTCMonth()===0&&start.getUTCDate()===1)||(end.getUTCMonth()===0&&end.getUTCDate()===1))return {...r,reason:'window-blocked'};
 try{
  Object.assign(r,encryptionCheck(env('REFERRAL_CLAIM_ENCRYPTION_KEY'),{now}));
  const key=env('TREMENDOUS_API_KEY');
  r.productionKeyFormatValid=typeof key==='string'&&key.startsWith('PROD_')&&!/\s/.test(key)&&key.indexOf('PROD_',5)===-1;
  if(!r.productionKeyFormatValid)return {...r,reason:'key-format-invalid'};
  // Hardcoded GET-only destinations, no caller inputs, redirects or retry loops.
  const get=async path=>{const response=await fetcher('https://api.tremendous.com/api/v2'+path,{method:'GET',headers:{Authorization:'Bearer '+key,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(8000)});return {status:response.status,ok:response.ok,body:response.ok?await response.json():null};};
  const org=await get('/organizations');r.organizationHttpStatus=org.status;
  if(!org.ok)return {...r,reason:'organization-read-failed'};
  r.organizationMatches=Array.isArray(org.body?.organizations)&&org.body.organizations.length===1&&org.body.organizations[0]?.id===TEAM;
  if(!r.organizationMatches)return {...r,reason:'organization-mismatch'};
  const products=await get('/products?id='+PRODUCT+'&country=US&currency=USD');r.productsHttpStatus=products.status;
  if(!products.ok)return {...r,reason:'products-read-failed'};
  const list=products.body?.products;const matches=Array.isArray(list)?list.filter(p=>p?.id===PRODUCT):[];const p=matches.length===1?matches[0]:null;
  r.productMatches=!!p&&p.name==='Amazon.com'&&p.category==='merchant_card';
  r.usAvailable=Array.isArray(p?.countries)&&p.countries.some(c=>c?.abbr==='US');
  r.usdAvailable=Array.isArray(p?.currency_codes)&&p.currency_codes.includes('USD');
  r.denomination25Supported=Array.isArray(p?.skus)&&p.skus.some(s=>Number.isFinite(s?.min)&&Number.isFinite(s?.max)&&s.min<=25&&s.max>=25&&(s.currency_code==='USD'||s.currency_code===undefined&&r.usdAvailable));
  return {...r,checked:true};
 }catch{return {...r,reason:'request-or-validation-failed'};}
}
export default async function handler(_request,context){console.log(JSON.stringify(await check({context,env:k=>Netlify.env.get(k)})));}
