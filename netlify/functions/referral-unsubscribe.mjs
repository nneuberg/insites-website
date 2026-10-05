import {verifyUnsubscribeToken,escapeHtml} from '../lib/referral-followups.mjs';
import {ledger} from '../lib/referral-transport.mjs';
const page=(body,status=200)=>new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>InSites email preferences</title><body style="font-family:Arial,sans-serif;background:#f5f1e8;color:#171714;padding:30px"><main style="max-width:520px;margin:50px auto;background:white;padding:32px;border-top:4px solid #d4bd73"><h1>InSites email preferences</h1>${body}</main></body></html>`,{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'"}});
export function createUnsubscribeHandler({env=process.env,callLedger=(a,d)=>ledger(a,d,env)}={}){return async request=>{
 if(!['GET','POST'].includes(request.method))return page('<p>Method not allowed.</p>',405);
 const token=new URL(request.url).searchParams.get('token'),code=verifyUnsubscribeToken(token,env.REFERRAL_LEDGER_SECRET);
 if(!code)return page('<p>This link is invalid. Contact neal@insites.services for help.</p>',400);
 if(request.method==='GET')return page(`<p>Stop the two-day and six-month referral follow-up emails. Your code and reward eligibility will remain active.</p><form method="post" action="?token=${escapeHtml(token)}"><button style="background:#171714;color:white;border:0;padding:14px 20px;font-size:16px">Unsubscribe from referral follow-ups</button></form>`);
 try{await callLedger('unsubscribeFollowups',{code});return page('<p>You’re unsubscribed from referral follow-up emails. Your referral code and reward eligibility remain active.</p>');}catch{return page('<p>We couldn’t save your preference. Please try again or contact neal@insites.services.</p>',503);}
};}
export default createUnsubscribeHandler();
export const config={rateLimit:{windowLimit:30,windowSize:60,aggregateBy:['ip','domain']}};
