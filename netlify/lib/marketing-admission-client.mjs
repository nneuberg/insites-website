import {createHmac,createHash} from 'node:crypto';
import {ledger} from './referral-transport.mjs';
const normalize=email=>{const x=String(email||'').trim().toLowerCase();if(!/^\S+@\S+\.\S+$/.test(x)||x.length>254)throw Error('Invalid destination');return x;};
export const operationId=(...parts)=>createHash('sha256').update(JSON.stringify(parts)).digest('hex');
export function createAdmissionClient({env=process.env,transport=ledger,now=()=>Date.now(),deadline}={}){
 const identity=email=>{if(!env.REFERRAL_LEDGER_SECRET)throw Error('Existing ledger secret unavailable');return createHmac('sha256',env.REFERRAL_LEDGER_SECRET).update('marketing-person-v1\0'+normalize(email)).digest('hex');};
 const memberKey=(audience,email)=>'member:'+audience+':'+createHash('md5').update(normalize(email)).digest('hex');
 const command=(personKey,type,data={},opId=operationId(personKey,type,data))=>transport('marketingAdmission',{personKey,command:{type,data,opId}},env,20000,{deadline});
 async function register(email,audiences,contactIds=[]){if(!Array.isArray(contactIds)||contactIds.length>8||contactIds.some(x=>typeof x!=='string'||!/^[A-Za-z0-9-]{1,100}$/.test(x)))throw Error('Invalid exact Hive identity aliases');const normalized=normalize(email),personId=identity(email);await command(personId,'register',{personId,email:normalized,aliases:[...new Set([...audiences.map(a=>memberKey(a,email)),...contactIds.map(id=>'hive-contact:'+id)])]});return personId;}
 return{identity,memberKey,command,register,snapshot:person=>command(person,'snapshot'),scanDue:cursor=>command('scan','scanDue',{cursor}),stop:(person,reason,programs)=>command(person,'stop',{personId:person,reason,...(programs?{programs}:{})}),now};
}
