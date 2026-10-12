import {getStore} from '@netlify/blobs';
import {connection} from '../lib/gallery-drive.mjs';
import {scanTick} from '../lib/gallery-recognition.mjs';
export default async function(){
  if(process.env.GALLERY_AI_ENABLED!=='true'||!process.env.GALLERY_GEMINI_API_KEY)return Response.json({status:'not-enabled'});
  const {drive}=await connection();
  const result=await scanTick({drive,store:getStore({name:'gallery-front-covers',consistency:'strong'}),key:process.env.GALLERY_GEMINI_API_KEY,maxCalls:Number(process.env.GALLERY_AI_MAX_CALLS||1000),maxUSD:Number(process.env.GALLERY_AI_MONTHLY_USD||5)});
  return Response.json(result);
}
export const config={schedule:'* * * * *'};
