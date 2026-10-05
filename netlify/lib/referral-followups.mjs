import {createHmac,timingSafeEqual} from 'node:crypto';
import {ledger} from './referral-transport.mjs';
export const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function unsubscribeToken(code,secret){
 if(!secret||!/^INS25[A-Z2-9]{7}$/.test(code))throw Error('Invalid unsubscribe configuration');
 return code+'.'+createHmac('sha256',secret).update('referral-followup-unsubscribe-v1:'+code).digest('hex');
}
export function verifyUnsubscribeToken(token,secret){
 const code=String(token||'').split('.')[0];let expected;try{expected=unsubscribeToken(code,secret);}catch{return null;}
 const a=Buffer.from(String(token)),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b)?code:null;
}
export function followupEmail(job,{address,secret}){
 if(!address?.trim())throw Error('Mailing address required');
 if(!['2-Day','6-Month'].includes(job.stage))throw Error('Invalid follow-up stage');
 const first=String(job.name||'').trim().split(/\s+/)[0]||'there',twoDay=job.stage==='2-Day';
 const subject=twoDay?'Thank you for putting your trust in me':'A little reminder: your InSites referral code';
 const heading=twoDay?'Your trust means a lot.':'Know someone making a move?';
 const paragraphs=twoDay?[
  'I saw that you picked up your referral code, and I wanted to say thank you. Trusting me with your own inspection means a lot. Being willing to pass my name along to someone you care about means even more.',
  'Whether you’ve shared it already or are saving it for the right person, I appreciate it.',
  'Keep your code handy. If a friend, family member, or coworker is buying a home, you’re welcome to pass it along. You can use the same code for as many friends as you’d like.'
 ]:[
  'It’s been a little while since you picked up your InSites referral code, so I wanted to send a friendly reminder that it’s still yours to share.',
  'If someone you know is thinking about buying a home, I’d be glad to give them the same care and clear answers I aim to bring to every inspection.',
  'There’s no need to get a new code. Keep this one handy and share it whenever someone comes to mind. And if no one does right now, no pressure at all.'
 ];
 const reward='Your friends get $25 off a full home inspection with your code. After each qualifying new client’s inspection is completed and paid, you’ll receive a $25 Amazon gift card as my thank-you.';
 const close=twoDay?'Thanks again for your confidence in me. If you ever have a question about your home, just reply—I’m happy to help.':'Thank you again for trusting me and keeping InSites in mind. If I can help with a question about your home, just reply.';
 const link='https://www.insites.services/referral/';
 const unsub='https://www.insites.services/.netlify/functions/referral-unsubscribe?token='+unsubscribeToken(job.code,secret);
 const terms='Past InSites clients only. New clients and full home inspections only. Real-estate licensees and anyone with a financial interest in the referred transaction are ineligible. One reward per qualifying new client; unlimited qualifying referrals. Reward follows completion, full payment, and a 24-hour wait. Claim the reward within six months of issue.';
 const text=`Hi ${first},\n\n${paragraphs.join('\n\n')}\n\nYour referral code: ${job.code}\n\n${reward}\n\nShare your code: ${link}\nReturn with this same email address to retrieve your code and open a ready-to-send text or email.\n\n${close}\n\nThanks,\nNeal Neuberger\nInSites Inspection Services\n330-990-9700\nneal@insites.services\n\n${terms}\nFull terms: ${link}#terms\n\nInSites Inspection Services\n${address}\nYou’re receiving this because you generated an InSites referral code.\nUnsubscribe from referral follow-ups: ${unsub}`;
 const e=escapeHtml;
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(subject)}</title></head><body style="margin:0;background:#f5f1e8;color:#171714;font-family:Arial,sans-serif"><div style="display:none;max-height:0;overflow:hidden">${twoDay?'A personal thank-you from Neal—and your code to keep sharing.':'Your same code. $25 off for a friend. A thank-you for you.'}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:28px 12px"><table role="presentation" cellspacing="0" cellpadding="0" width="600" style="width:100%;max-width:600px;background:#fff"><tr><td style="padding:28px 32px;border-bottom:3px solid #d4bd73"><img src="https://www.insites.services/insites-logo-tan.png" width="44" height="44" alt="" style="vertical-align:middle;margin-right:14px"><img src="https://www.insites.services/insites-wordmark-official.png" width="166" alt="InSites Inspection Services" style="vertical-align:middle;max-width:65%;height:auto"></td></tr><tr><td style="padding:32px"><p style="font-size:11px;letter-spacing:2px;color:#765a19;font-weight:bold">A NOTE FROM NEAL</p><h1 style="font-size:34px;line-height:1.15;letter-spacing:-1px;margin:16px 0 26px">${heading}</h1><div style="font-size:16px;line-height:1.7;color:#45433e"><p>Hi ${e(first)},</p>${paragraphs.map(p=>`<p>${e(p)}</p>`).join('')}<div style="background:#f5f1e8;border-left:3px solid #d4bd73;padding:18px 22px;margin:26px 0"><span style="font-size:12px;letter-spacing:1px">YOUR REFERRAL CODE</span><br><strong style="font-size:25px;letter-spacing:1px;color:#171714">${e(job.code)}</strong></div><p>${reward}</p><p style="margin:28px 0"><a href="${link}" style="display:inline-block;background:#171714;color:#fff;padding:15px 24px;text-decoration:none;font-weight:bold">Share your code →</a></p><p style="font-size:13px;color:#6a665d">Return with this same email address to retrieve your code and open a ready-to-send text or email.</p><p>${e(close)}</p><p>Thanks,<br><strong style="color:#171714">Neal Neuberger</strong><br>InSites Inspection Services<br><a href="tel:+13309909700" style="color:#765a19">330-990-9700</a></p></div><p style="font-size:11px;line-height:1.6;color:#6a665d;border-top:1px solid #e7e2d7;padding-top:20px">${terms} <a href="${link}#terms" style="color:#6a665d">Full terms</a>.</p></td></tr><tr><td style="padding:24px 32px;background:#eee9df;font-size:12px;line-height:1.7;color:#625f58">InSites Inspection Services<br>${e(address)}<br>You’re receiving this because you generated an InSites referral code.<br><a href="${unsub}" style="color:#625f58">Unsubscribe from referral follow-ups</a></td></tr></table></td></tr></table></body></html>`;
 return {subject,text,html,unsub};
}
export async function runFollowup({env=process.env,callLedger=(a,d)=>ledger(a,d,env,7000),sendEmail}={}){
 if(!env.RESEND_API_KEY||!env.REFERRAL_MAILING_ADDRESS||!env.REFERRAL_LEDGER_SECRET)throw Error('Follow-up email configuration incomplete');
 const job=await callLedger('prepareFollowup',{});if(!job.send)return {sent:false};
 const email=followupEmail(job,{address:env.REFERRAL_MAILING_ADDRESS,secret:env.REFERRAL_LEDGER_SECRET});
 const message={from:'Neal at InSites <offers@insites.services>',reply_to:'neal@insites.services',to:[job.email],subject:email.subject,html:email.html,text:email.text,headers:{'List-Unsubscribe':`<${email.unsub}>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}};
 let receipt;
 if(sendEmail)receipt=await sendEmail(message,job.id);
 else {const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':'referral-followup/'+job.id},body:JSON.stringify(message),signal:AbortSignal.timeout(7000)});if(!response.ok)throw Error('Follow-up email not confirmed');receipt=(await response.json()).id;}
 if(!receipt)throw Error('Email receipt missing');await callLedger('followupSent',{code:job.code,stage:job.stage,emailId:receipt});return {sent:true};
}
