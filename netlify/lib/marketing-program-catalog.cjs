/* Finite versioned programs. No reset/recycle or automatic subscriber creation. */
var MarketingProgramCatalog=(function(){
 const DAY=86400000;
 const pairs=days=>days.flatMap((day,n)=>[{stage:'o'+(n+1),day,kind:'original',previousResend:n?'r'+n:null},{stage:'r'+(n+1),day:day+7,kind:'resend',originalStage:'o'+(n+1)}]);
 const programs={
  'nb-intro-v1':{version:'native-observed-signal-v1',stages:pairs([0,21,42,63]),afterPreviousResendDays:14,classifyDay:70},
  'nb-evergreen-v1':{version:'native-observed-signal-v1',branch:'observed-engaged',stages:pairs([60,116,172,228]),afterPreviousResendDays:49},
  'nb-permission-v1':{version:'native-observed-signal-v1',branch:'no-observed-signal',stages:pairs([60]),endDay:74}
 };
 return{DAY,programs,NB_PROGRAMS:Object.keys(programs),classification:{completeInterest:'b2d58fd968',engagedInterest:'09c2597b08',neverInterest:'298e5168a2',categoryId:'c4bd0f7549'}};
}());
if(typeof module!=='undefined')module.exports=MarketingProgramCatalog;
