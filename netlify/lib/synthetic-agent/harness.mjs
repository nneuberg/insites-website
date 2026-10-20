import {createHash} from 'node:crypto';
import {createEngine} from './lib/review-engine.mjs';
import {googleSync} from './lib/review-google.mjs';
export const SCOPE=Object.freeze({
 store:'insites-synthetic-agent-e2e-20261020',email:'nneuberger92+insites-agent-test@gmail.com',
 inbox:'nneuberger92@gmail.com',contactId:'09e083a5-e25d-4ce6-9d79-5a9515436a19',
 audience:'3ebb3017d4',pending:'TEST:REVIEW:AGENT:20261020',address:'123 Test Street (test only)',
 origin:'https://www.insites.services',path:'/api/review-synthetic-agent',
 invitationSubject:'TEST ONLY — InSites review invitation',matchSubject:'TEST ONLY — verify synthetic InSites Google review',
 comment:'Synthetic end-to-end verification; not a public Google review.'
});
const hardExpiry=Date.parse('2026-10-27T00:00:00Z');
const fail=()=>{throw Error('Synthetic scope blocked');};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// No default fetch or environment: importing this module cannot contact a provider.
// Store factory MUST select SCOPE.store; the production campaign store is never requested.
export function createHarness({storeFactory,transport,env={},permit={},now=()=>Date.now()}){
 function guard(){
  const t=now();
  if(permit.enabled!==true||permit.subscriptionAuditPassed!==true||permit.testJourneyRestricted!==true||
   !Number.isFinite(permit.startsAt)||!Number.isFinite(permit.expiresAt)||t<permit.startsAt||t>=permit.expiresAt||
   permit.expiresAt-permit.startsAt>7200000||permit.expiresAt>hardExpiry||env.REVIEW_ENABLED==='true')fail();
 }
 guard();
 if(typeof transport!=='function'||typeof storeFactory!=='function')fail();
 const store=storeFactory(SCOPE.store),memberHash=createHash('md5').update(SCOPE.email).digest('hex');
 const dc=env.MAILCHIMP_API_KEY?.split('-').at(-1);
 if(!/^us\d+$/.test(dc||'')||!env.HIVE_API_KEY||!env.RESEND_API_KEY)fail();
 const memberPath=`/3.0/lists/${SCOPE.audience}/members/${memberHash}`;
 const live=async()=>{guard();if(await store.get('safety/stopped',{type:'json'}))fail();};
 const sendOnce=async(key,fn)=>{
  await live();
  // Reserve before transport. Unknown responses require manual reconciliation, never automatic resend.
  const held=await store.setJSON('safety/'+key,{attemptedAt:now()},{onlyIfNew:true});
  if(!held.modified)throw Error('Already attempted; reconcile provider before continuing');
  return fn();
 };
 async function scopedFetch(raw,opt={}){
  await live();const u=new URL(raw),method=opt.method||'GET';let body=opt.body?JSON.parse(opt.body):undefined;
  if(u.username||u.password||u.search||u.hash||u.protocol!=='https:')fail();
  if(u.hostname===`${dc}.api.mailchimp.com`&&(u.pathname===memberPath||u.pathname===memberPath+'/tags')){
   if(method==='GET'&&u.pathname===memberPath)return transport(raw,{...opt,redirect:'error'});
   if(method==='PATCH'&&u.pathname===memberPath){
    if(!equal(Object.keys(body||{}),['merge_fields'])||!equal(Object.keys(body.merge_fields),['REVLINK','REVADDR'])||body.merge_fields.REVADDR!==SCOPE.address)fail();
    const match=body.merge_fields.REVLINK.match(/^https:\/\/www\.insites\.services\/review\/r\/([a-f0-9]{48})$/);if(!match)fail();
    const current=await engine.get(match[1]);validateRow(current);
    // Query-free path preserves Mailchimp's existing ?rating=N links.
    body.merge_fields.REVLINK=SCOPE.origin+'/review-synthetic/'+match[1];
   }else if(method==='POST'&&u.pathname===memberPath+'/tags'){
    if(!equal(Object.keys(body||{}),['tags'])||!Array.isArray(body.tags)||body.tags.length>3)fail();
    for(const tag of body.tags){if(!equal(Object.keys(tag),['name','status'])||!['REVIEW:PENDING','feedback received','google reviewed'].includes(tag.name)||!['active','inactive'].includes(tag.status))fail();}
    const activation=body.tags.some(t=>t.name==='REVIEW:PENDING'&&t.status==='active');
    body.tags=body.tags.map(t=>({...t,name:t.name==='REVIEW:PENDING'?SCOPE.pending:t.name}));
    if(activation)return sendOnce('invitation',()=>transport(raw,{...opt,body:JSON.stringify(body),redirect:'error'}));
   }else fail();
   return transport(raw,{...opt,body:JSON.stringify(body),redirect:'error'});
  }
  if(u.hostname==='api.hiveinspect.com'&&u.pathname==='/v1/contacts/'+SCOPE.contactId){
   if(method==='GET')return transport(raw,{...opt,redirect:'error'});
   if(method==='PATCH'&&equal(Object.keys(body||{}),['tags'])&&equal(body.tags,['realtor','google reviewed']))return transport(raw,{...opt,redirect:'error'});
   fail();
  }
  fail(); // Denies inspection scans, other recipients, subscription changes, dates, Google and email APIs.
 }
 const scopedEnv={HIVE_API_KEY:env.HIVE_API_KEY,MAILCHIMP_API_KEY:env.MAILCHIMP_API_KEY,REVIEW_ENABLED:'true',REVIEW_START_AFTER:new Date(permit.startsAt-60000).toISOString()};
 const engine=createEngine({store,env:scopedEnv,fetcher:scopedFetch,now});
 function validateRow(r){if(!r||r.role!=='Agent'||r.email!==SCOPE.email||r.contactId!==SCOPE.contactId||r.address!==SCOPE.address||r.inspectionId!=='SYNTHETIC-AGENT-20261020'||r.isTest)fail();}
 async function row(token){await live();const r=await engine.get(token);validateRow(r);return r;}
 const review=()=>({reviewId:'SYNTHETIC-AGENT-20261020',reviewer:{displayName:'TEST ONLY'},starRating:'FIVE',comment:SCOPE.comment,createTime:new Date(permit.startsAt+1000).toISOString(),updateTime:new Date(permit.startsAt+1000).toISOString()});
 async function syntheticGoogleFetch(raw,opt={}){
  await live();
  if(raw==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-no-real-token'});
  if(raw==='https://mybusiness.googleapis.com/v4/accounts/synthetic/locations/synthetic/reviews?pageSize=50&orderBy=updateTime+desc')return Response.json({reviews:[await store.get('synthetic-review',{type:'json'})],totalReviewCount:1});
  if(raw!=='https://api.resend.com/emails'||opt.method!=='POST')fail();
  const data=JSON.parse(opt.body);
  if(data.from!=='InSites Reviews <neal@insites.services>'||!equal(data.to,['neal@insites.services']))fail();
  data.to=[SCOPE.inbox];data.subject=SCOPE.matchSubject;
  data.html=data.html.replace('New Google review — please verify the person','TEST ONLY — synthetic Google review').replaceAll(SCOPE.origin+'/review-match/?token=',SCOPE.origin+'/review-synthetic-match/');
  return sendOnce('match-email',()=>transport(raw,{...opt,body:JSON.stringify(data),redirect:'error',headers:{...opt.headers,'Idempotency-Key':'synthetic-agent-20261020-match'}}));
 }
 const sync=googleSync({store,engine,now,fetcher:syntheticGoogleFetch,env:{...scopedEnv,GOOGLE_REVIEW_CLIENT_ID:'synthetic',GOOGLE_REVIEW_CLIENT_SECRET:'synthetic',GOOGLE_REVIEW_REFRESH_TOKEN:'synthetic',GOOGLE_REVIEW_LOCATION:'accounts/synthetic/locations/synthetic',RESEND_API_KEY:env.RESEND_API_KEY}});
 return Object.freeze({
  async stop(){await store.setJSON('safety/stopped',{stoppedAt:now()});return {stopped:true};},
  async begin(){
   await live();
   await engine.enroll({id:'SYNTHETIC-AGENT-20261020',confirmed:true,ends_at:new Date(permit.startsAt).toISOString(),price:{paid:true,amount_due:0},agreements:{all_signed:true},reports:{status:'published'},address:{full:SCOPE.address},contacts:[{id:SCOPE.contactId,email:SCOPE.email,first_name:'TEST ONLY',last_name:'Review Agent',role:'Buyer Agent'}]});
   let rows=[];for await(const page of store.list({prefix:'requests/',paginate:true}))for(const b of page.blobs)rows.push(await store.get(b.key,{type:'json'}));
   if(rows.length!==1)throw Error('Expected one subscribed synthetic agent; no invitation sent');validateRow(rows[0]);
   await engine.process(rows[0].token);await store.setJSON('synthetic-review',{...review(),createTime:new Date(now()).toISOString(),updateTime:new Date(now()).toISOString()},{onlyIfNew:true});return {token:rows[0].token};
  },
  async details(token){const r=await row(token);return {name:'TEST ONLY',address:r.address,rated:!!r.ratedAt,rating:r.rating??null,feedback:r.feedback??'',revision:r.feedbackRevision||0};},
  async feedback(token,input){await row(token);return engine.feedback(token,input);},
  async checkSuppression(token){const r=await row(token);if(!r.ratedAt)fail();await engine.process(token);return {ended:!!(await row(token)).endedAt};},
  async notify(token){const r=await row(token);if(!r.ratedAt)fail();await store.setJSON('google-baseline',{since:permit.startsAt},{onlyIfNew:true});return sync.run();},
  async match(matchToken){await live();if(!/^[a-f0-9]{48}$/.test(matchToken))fail();const m=await store.get('matches/'+matchToken,{type:'json'});if(!m||m.review?.reviewId!==review().reviewId||now()>=m.expiresAt)fail();await row(m.requestToken);return {matchToken,review:m.review,name:'TEST ONLY Review Agent',address:SCOPE.address};},
  async confirm(matchToken){await this.match(matchToken);const m=await store.get('matches/'+matchToken,{type:'json'});return engine.confirmGoogle(m.requestToken,m.review);}
 });
}
