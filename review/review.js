const params=new URLSearchParams(location.search),preview=params.get('preview')==='1',token=params.get('token');
const el=id=>document.getElementById(id),form=el('feedback-form');
const thanks=()=>{form.hidden=true;for(const id of ['review-eyebrow','review-heading','address','intro']){const item=el(id);if(item)item.hidden=true;}el('thanks').hidden=false;};
async function start(){
 try{
  let details;if(preview){details={name:'Alex',address:'Your inspection address'};el('preview-note').hidden=false;}
  else{const r=await fetch('/api/review-feedback?token='+encodeURIComponent(token||''),{cache:'no-store'});details=await r.json();if(!r.ok)throw Error(details.error);}
  el('address').textContent=details.address;el('intro').textContent=`Hi ${details.name}, thank you for choosing InSites. Tell us how we did.`;
  if(details.rated){thanks();return;}form.hidden=false;
  const selected=Number(params.get('rating'));if(Number.isInteger(selected)&&selected>=1&&selected<=5)form.querySelector(`input[value="${selected}"]`).checked=true;
 }catch(e){el('intro').textContent=e.message||'Unable to open this review invitation.';}
}
form.addEventListener('submit',async e=>{
 e.preventDefault();el('submit').disabled=true;el('status').textContent='';
 try{
  if(!preview){const r=await fetch('/api/review-feedback?token='+encodeURIComponent(token),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rating:Number(new FormData(form).get('rating')),feedback:el('feedback').value})});const result=await r.json();if(!r.ok)throw Error(result.error);}
  thanks();if(preview)el('status').textContent='Preview only — nothing was saved.';
 }catch(e){el('status').textContent=e.message||'Please try again.';}finally{el('submit').disabled=false;}
});
start();
