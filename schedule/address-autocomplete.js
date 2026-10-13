const input = document.querySelector('#property-address');
const list = document.querySelector('#address-options');
const status = document.querySelector('#address-status');
let timer, request, generation = 0, active = -1, labels = [];
const cache = new Map();
function close() {list.hidden = true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active = -1;}
function choose(index) {if (!labels[index]) return;input.value = labels[index];generation++;clearTimeout(timer);request?.abort();close();status.textContent = '';input.dispatchEvent(new Event('change',{bubbles:true}));}
function render(results) {
  labels = results;active = -1;list.replaceChildren();input.removeAttribute('aria-activedescendant');
  results.forEach((label,index) => {const item = document.createElement('li');item.id = `address-option-${index}`;item.role = 'option';item.setAttribute('aria-selected','false');item.textContent = label;item.addEventListener('pointerdown',event => event.preventDefault());item.addEventListener('click',()=>choose(index));list.append(item);});
  list.hidden = !results.length;input.setAttribute('aria-expanded',String(!!results.length));
  status.textContent = results.length ? '' : 'No matching address found. You can enter the full address manually.';
}
input.addEventListener('input', () => {
  clearTimeout(timer);request?.abort();const version = ++generation;const query = input.value.trim();close();status.textContent = '';
  if (query.length < 4) return;
  timer = setTimeout(async () => {
    if (cache.has(query)) {render(cache.get(query));return;}
    request = new AbortController();status.textContent = 'Finding addresses…';
    try {
      const response = await fetch('/.netlify/functions/address-autocomplete?q='+encodeURIComponent(query),{signal:request.signal});
      if (!response.ok) throw new Error('Address search unavailable');
      const data = await response.json();if (version !== generation || document.activeElement !== input) return;
      const results = data.suggestions || [];
      cache.set(query,results);render(results);
    } catch(error) {if (error.name !== 'AbortError' && version === generation) {close();status.textContent = 'Address suggestions are unavailable. Please enter the full address manually.';}}
  },600);
});
input.addEventListener('keydown', event => {
  if (event.key === 'Escape') {generation++;request?.abort();clearTimeout(timer);close();status.textContent='';return;}
  if (list.hidden) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();active = (active + (event.key === 'ArrowDown' ? 1 : -1) + labels.length) % labels.length;
    [...list.children].forEach((item,index)=>item.setAttribute('aria-selected',String(index === active)));
    input.setAttribute('aria-activedescendant',list.children[active].id);list.children[active].scrollIntoView({block:'nearest'});
  } else if (event.key === 'Enter' && active >= 0) {event.preventDefault();choose(active);}
});
input.addEventListener('blur',()=>{generation++;clearTimeout(timer);request?.abort();close();status.textContent='';});
