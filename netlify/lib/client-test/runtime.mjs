import {getStore} from '@netlify/blobs';
import permit from './permit.json' with {type:'json'};
import {createClientHarness} from './harness.mjs';
import {CLIENT_SCOPE as S} from './provider-guard.mjs';
import {createHandler} from './handler.mjs';
export const store=()=>getStore({name:S.store,consistency:'strong'});
export const openHarness=()=>createClientHarness({storeFactory:name=>{if(name!==S.store)throw Error('Invalid store');return store()},transport:fetch,env:process.env,permit});
export async function handle(request){try{return await createHandler(openHarness())(request)}catch{return Response.json({error:'Client test unavailable'},{status:503,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}})}}
