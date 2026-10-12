const grid=document.querySelector('#gallery-grid'),status=document.querySelector('#gallery-status'),search=document.querySelector('#gallery-search'),more=document.querySelector('#gallery-more'),back=document.querySelector('#album-back'),dialog=document.querySelector('#lightbox'),heroTitle=document.querySelector('#gallery-title');
const endpoint='/.netlify/functions/gallery';
let items=[],cursor=null,album=null,requestNumber=0,busy=false,selected=0,focusReturn=null;
function photoUrl(item,large=false){return item.imageUrl+(large?'&large=1':'');}
function render(){
  const filtered=items.filter(item=>item.name.toLowerCase().includes(search.value.toLowerCase()));
  grid.replaceChildren();
  for(const item of filtered){
    const card=document.createElement('button'); card.className='gallery-card'; card.type='button';
    const frame=document.createElement('div');frame.className='gallery-frame';
    const image=document.createElement('img');image.src=photoUrl(item);image.alt='';image.loading='lazy';image.decoding='async';image.onerror=()=>{image.hidden=true;};
    const fallback=document.createElement('span');fallback.className='fallback';fallback.textContent='Preview unavailable';
    const title=document.createElement('h3');title.textContent=album?item.name.replace(/\.[^.]+$/,''):item.name;
    const caption=document.createElement('p');caption.textContent=album?'View photograph ↗':'Explore album →';
    frame.append(image,fallback);card.append(frame,title,caption);
    card.onclick=()=>{if(album){selected=items.indexOf(item);focusReturn=card;showPhoto();dialog.showModal();}else{items=[];cursor=null;history.pushState(null,'',`?album=${encodeURIComponent(item.id)}`);search.value='';load();}};
    grid.append(card);
  }
  if(!filtered.length){const empty=document.createElement('p');empty.className='gallery-empty';empty.textContent=search.value?'No matches in the loaded photos or albums. Load more or try another search.':album?'Photos will appear here once uploaded.':'Albums will appear here once uploaded.';grid.append(empty);}
  more.hidden=!cursor;more.disabled=busy;
}
async function load(append=false){
  const version=++requestNumber;busy=true;more.disabled=true;document.querySelector('#gallery-refresh').disabled=true;
  const albumId=new URL(location.href).searchParams.get('album');
  const params=new URLSearchParams();if(albumId)params.set('album',albumId);if(append&&cursor)params.set('cursor',cursor);
  status.textContent='Loading…';
  try{
    const response=await fetch(`${endpoint}?${params}`,{cache:'no-store'});const data=await response.json();
    if(version!==requestNumber)return;
    if(!response.ok)throw Error(data.error||'Could not load photos.');
    if(!Array.isArray(data.items))throw Error('Could not load photos.');
    items=append?[...new Map([...items,...data.items].map(x=>[x.id,x])).values()]:data.items;
    album=data.album;cursor=data.nextPageToken;heroTitle.textContent=album?album.name:'Every home. A fresh perspective.';
    back.hidden=!album;search.placeholder=album?'Search photographs':'Search properties';
    status.textContent=`${items.length} ${album?'photos':'albums'} loaded${cursor?' · More available':''}`;
    render();
  }catch(error){if(version!==requestNumber)return;status.textContent=(items.length?'Showing previously loaded results. ':'')+error.message;if(!items.length){grid.replaceChildren();const p=document.createElement('p');p.className='gallery-empty';p.textContent=error.message;grid.append(p);}}
  finally{if(version===requestNumber){busy=false;more.disabled=false;document.querySelector('#gallery-refresh').disabled=false;}}
}
function showPhoto(){const item=items[selected];if(!item)return;document.querySelector('#lightbox-name').textContent=item.name;const image=document.querySelector('#lightbox-image');image.alt=item.name;document.querySelector('#lightbox-error').hidden=true;image.onerror=()=>{document.querySelector('#lightbox-error').hidden=false;};image.src=photoUrl(item,true);document.querySelector('#lightbox-count').textContent=`${selected+1} / ${items.length}${cursor?' loaded':''}`;document.querySelector('#lightbox-prev').disabled=selected===0;document.querySelector('#lightbox-next').disabled=selected===items.length-1;}
document.querySelector('#lightbox-close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>focusReturn?.focus());
document.querySelector('#lightbox-prev').onclick=()=>{if(selected>0){selected--;showPhoto();}};
document.querySelector('#lightbox-next').onclick=()=>{if(selected<items.length-1){selected++;showPhoto();}};
dialog.addEventListener('keydown',event=>{if(event.key==='ArrowLeft')document.querySelector('#lightbox-prev').click();if(event.key==='ArrowRight')document.querySelector('#lightbox-next').click();});
search.oninput=render;more.onclick=()=>load(true);document.querySelector('#gallery-refresh').onclick=()=>load();
back.onclick=()=>{history.pushState(null,'',location.pathname);items=[];search.value='';load();};
window.addEventListener('popstate',()=>{items=[];search.value='';load();});
// Recheck Drive on visits, focus, and every minute while visible. No manual rebuild needed.
setInterval(()=>{if(!document.hidden&&!busy&&!dialog.open)load();},60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!busy&&!dialog.open)load();});
load();
