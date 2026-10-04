import {createHash} from 'node:crypto';
export const CODE_TERMS_VERSION='2026-10-04-personal-share';
export function validateShare(input){
 if(input.friendName||input.friendEmail||input.channel)throw Error('Refresh the page to use the updated form.');
 const name=input.referrerName,address=String(input.referrerEmail||'').trim().toLowerCase();
 if(typeof name!=='string'||!name.trim()||name.length>100||/[\x00-\x1f]/.test(name))throw Error('Enter your name.');
 if(address.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)||/[\x00-\x1f]/.test(address))throw Error('Enter a valid email.');
 if(input.eligibility!=='confirmed'||input.permissionAndTerms!=='accepted')throw Error('Please confirm eligibility and accept the program rules.');
 if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(input.referralId||''))throw Error('Refresh the page and try again.');
 const out={referrerName:name.trim(),referrerEmail:address,shareId:input.referralId,termsVersion:CODE_TERMS_VERSION,eligibility:input.eligibility,permissionAndTerms:input.permissionAndTerms};
 return {...out,requestHash:createHash('sha256').update(JSON.stringify(out)).digest('hex')};
}
