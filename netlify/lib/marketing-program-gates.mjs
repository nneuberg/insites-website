import catalog from './marketing-program-catalog.cjs';
// Discovery may queue work while its owner is OFF. Dispatch authorization is
// explicit, fail-closed, and separate from discovery and executor verification.
export function marketingProgramEnabled(config,program){
 if(config?.enabled!==true)return false;
 if(catalog.NB_PROGRAMS.includes(program))return config.noBusinessOwnerEnabled===true;
 if(program==='review-agent-v1'||program==='review-customer-v1')return config.reviewOwnerEnabled===true;
 if(program==='referral-customer-v1')return config.referralOwnerEnabled===true;
 return false;
}
export function marketingExecutorEnabled(config,key){
 if(key==='classifier')return marketingProgramEnabled(config,'nb-intro-v1');
 if(typeof key!=='string'||key.split(':').length!==2)return false;
 return marketingProgramEnabled(config,key.split(':')[0]);
}
