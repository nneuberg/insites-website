import {validToken} from '../lib/review-policy.mjs';
export default async request=>{
 const url=new URL(request.url),token=url.pathname.split('/').at(-1);
 if(!validToken(token))return new Response('This review link is invalid.',{status:400});
 const query=new URLSearchParams({token}),rating=Number(url.searchParams.get('rating'));
 if(Number.isInteger(rating)&&rating>=1&&rating<=5)query.set('rating',String(rating));
 return new Response(null,{status:302,headers:{Location:'/review/?'+query,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'}});
};
export const config={path:'/review/r/:token'};
