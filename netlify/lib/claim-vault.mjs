import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
// Dedicated future server-side secret. No key is generated/configured by build.
export function claimVault(hexKey){
 if(typeof hexKey!=='string'||!/^([a-f0-9]{64})$/i.test(hexKey))throw Error('Claim encryption configuration unavailable');
 const key=Buffer.from(hexKey,'hex');
 return {seal(value,context){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(context));const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return {v:1,iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),data:ciphertext.toString('base64')};},open(value,context){if(value?.v!==1)throw Error('Unknown encrypted record');const cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(value.iv,'hex'));cipher.setAAD(Buffer.from(context));cipher.setAuthTag(Buffer.from(value.tag,'hex'));return JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.data,'base64')),cipher.final()]).toString('utf8'));}};
}
