import { createHmac, timingSafeEqual } from 'node:crypto';
export function same(a,b){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length && timingSafeEqual(x,y);}
export function verifySvix(raw, headers, secret, now=Date.now()) {
 const id=headers.get('svix-id')||headers.get('webhook-id'),timestamp=headers.get('svix-timestamp')||headers.get('webhook-timestamp'),signatures=headers.get('svix-signature')||headers.get('webhook-signature');
 if(!secret || !id || !/^\d+$/.test(timestamp||'') || Math.abs(now/1000-Number(timestamp))>300 || !signatures)throw new Error('Unauthorized');
 const digest=createHmac('sha256',Buffer.from(secret.replace(/^whsec_/,''),'base64')).update(`${id}.${timestamp}.${raw}`).digest('base64');
 if(!signatures.split(' ').some(s=>s.startsWith('v1,') && same(s.slice(3),digest)))throw new Error('Unauthorized');return id;
}
export async function ledger(action,data={},env=process.env,timeoutMs=20000) {
 if(!env.REFERRAL_LEDGER_URL || !env.REFERRAL_LEDGER_SECRET)throw new Error('Ledger not connected');
 const url=new URL(env.REFERRAL_LEDGER_URL);if(url.protocol!=='https:'||url.hostname!=='script.google.com')throw new Error('Invalid ledger URL');
 const payload=JSON.stringify({action,data}),timestamp=String(Date.now());
 const signature=createHmac('sha256',env.REFERRAL_LEDGER_SECRET).update(`${timestamp}.${payload}`).digest('hex');
 const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({timestamp,payload,signature}),signal:AbortSignal.timeout(timeoutMs)});
 if(!response.ok)throw new Error('Ledger unavailable');const result=await response.json();if(!result.ok)throw new Error('Ledger operation failed');return result.data;
}
export const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
