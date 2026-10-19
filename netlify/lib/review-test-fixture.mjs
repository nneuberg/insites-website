import {createEngine} from './review-engine.mjs';
// Disposable fake invitation. This token authorizes no real contact or provider action.
export const TEST_TOKEN='e3e1ede11e394e5e9c801420d7ed7ecc29cfbfb11dc280ce';
export const TEST_EXPIRES_AT=Date.parse('2026-10-27T00:00:00Z');
export async function testRuntime(token,storeFactory,now=()=>Date.now()){
 if(token!==TEST_TOKEN)return null;
 const store=storeFactory();
 const engine=createEngine({store,env:{REVIEW_ENABLED:'false'},now,
  fetcher:()=>{throw Error('External calls are forbidden for the test fixture');}});
 if(now()<TEST_EXPIRES_AT)await store.setJSON('requests/'+token,{
  token,isTest:true,role:'Customer',name:'Test Test',email:'review-test@example.invalid',
  contactId:'isolated-test',address:'123 Test Street (test only)',createdAt:now(),
  expiresAt:TEST_EXPIRES_AT,sentStages:[]
 },{onlyIfNew:true});
 return engine;
}
