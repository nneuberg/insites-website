const params=new URLSearchParams(location.search),preview=params.get('preview')==='1',token=params.get('token');
const el=id=>document.getElementById(id),form=el('feedback-form');
let revision=0,savedRating=null,savedFeedback='';
const thanks=()=>{form.hidden=true;for(const id of ['review-eyebrow','review-heading','address','intro']){const item=el(id);if(item)item.hidden=true;}const showGoogle=Number.isInteger(savedRating)&&savedRating>=4&&savedRating<=5;el('google-invitation').hidden=!showGoogle;el('private-thanks').hidden=showGoogle;el('thanks').hidden=false;};
async function start(){
 try{
  let details;if(preview){details={name:'Alex',address:'Your inspection address'};el('preview-note').hidden=false;}
  else{const r=await fetch('/api/review-feedback?token='+encodeURIComponent(token||''),{cache:'no-store'});details=await r.json();if(!r.ok)throw Error(details.error);}
  el('address').textContent=details.address;el('intro').textContent=`Hi ${details.name}, thank you for choosing InSites. Tell us how we did.`;
  revision=details.revision||0;savedRating=details.rating;savedFeedback=details.feedback||'';
  el('feedback').value=savedFeedback;
  if(details.rated){form.querySelector(`input[value="${details.rating}"]`).checked=true;thanks();return;}form.hidden=false;
  const selected=Number(params.get('rating'));if(Number.isInteger(selected)&&selected>=1&&selected<=5)form.querySelector(`input[value="${selected}"]`).checked=true;
 }catch(e){el('intro').textContent=e.message||'Unable to open this review invitation.';}
}
el('edit-feedback').addEventListener('click',()=>{
 form.hidden=false;el('thanks').hidden=true;el('submit').textContent='Save my changes';el('status').textContent='';
});
form.addEventListener('submit',async e=>{
 e.preventDefault();el('submit').disabled=true;el('status').textContent='';
 try{
  const rating=Number(new FormData(form).get('rating')),feedback=el('feedback').value;
  if(!Number.isInteger(rating)||rating<1||rating>5||feedback.length>4000)throw Error('Select a rating from 1 to 5 and keep your comment under 4,001 characters.');
  if(!preview){const r=await fetch('/api/review-feedback?token='+encodeURIComponent(token),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rating,feedback,revision})});const result=await r.json();if(!r.ok)throw Error(result.error);}
  if(rating!==savedRating||feedback.trim()!==savedFeedback)revision++;savedRating=rating;savedFeedback=feedback.trim();
  thanks();if(preview)el('status').textContent='Preview only — nothing was saved.';
 }catch(e){el('status').textContent=e.message||'Please try again.';}finally{el('submit').disabled=false;}
});
start();
