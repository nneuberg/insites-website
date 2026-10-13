import './address-autocomplete.js';
import {calculateSelection, buildBookingPayload} from './booking-core.mjs';
const form = document.querySelector('#media-booking-form');
const submitButton = document.querySelector('#booking-submit');
const loadStatus = document.querySelector('#booking-load-status');
const submitStatus = document.querySelector('#booking-submit-status');
const money = cents => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:cents%100?2:0}).format(cents/100);
let catalog, sending = false;
function selectedIds(name) {return Array.from(form.querySelectorAll(`input[name="${name}"]:checked`)).map(input=>input.value);}
function selection() {return calculateSelection(catalog,selectedIds('media_service'));}
function update() {
  if (!catalog) return;
  const hasPrimary = selectedIds('media_service').some(id => catalog.services.find(service => service.id === id)?.priceCents !== null);
  for (const service of catalog.services.filter(service => service.priceCents === null)) {
    const input = form.querySelector(`input[value="${service.id}"]`);
    const unavailable = !hasPrimary || (service.id === 'exterior' && selectedIds('media_service').includes('photography'));
    input.disabled = unavailable;
    if (unavailable) input.checked = false;
  }
  const quote = selection();
  const lines = document.querySelector('#booking-lines');
  lines.replaceChildren();
  if (!quote.lines.length) lines.textContent = 'Select a service to see your pricing.';
  for (const line of quote.lines) {
    const p = document.createElement('p');
    p.textContent = `${line.name} — ${money(line.priceCents)}${line.addonTo ? ' (add-on)' : ''}`;
    lines.append(p);
  }
  document.querySelector('#booking-total').textContent = quote.lines.length ? money(quote.totalCents) : '—';
  const extra = document.querySelector('#booking-extra-note');
  extra.hidden = !quote.hasPhotography;
  extra.textContent = `Plus ${money(catalog.extraPhotoCents)} for each photo beyond ${catalog.includedPhotos}. Additional-photo charges are based on the final photo count.`;
  submitButton.disabled = sending || !quote.lines.length;
}
form.addEventListener('change',event=>{
  const input = event.target;
  if (input.name === 'media_service' && input.checked) {
    const other = {photography:'exterior',exterior:'photography','basic-aerial':'elevated-aerial','elevated-aerial':'basic-aerial'}[input.value];
    if (other) form.querySelector(`input[value="${other}"]`).checked = false;
  }
  if (input.name === 'media_service') update();
});
form.addEventListener('submit',async event=>{
  event.preventDefault();
  if (!catalog || sending) return;
  const data = new FormData(form);
  if (data.get('company_website')) return;
  const quote = selection();
  if (!quote.lines.length) {submitStatus.textContent='Please select a service.';return;}
  if (!form.reportValidity()) return;
  const payload = buildBookingPayload(catalog,quote,Object.fromEntries(data));
  sending=true; submitStatus.textContent='';submitButton.disabled=true;submitButton.textContent='Sending…';
  try {
    const response = await fetch('https://formsubmit.co/ajax/neal@insites.services',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(payload)});
    if (!response.ok) throw new Error('Request failed');
    const result = await response.json();
    if (result.success !== true && result.success !== 'true') throw new Error('Request not accepted');
    form.innerHTML='<div class="booking-success" role="status"><p class="eyebrow">Request received</p><h2>Thanks—I’ll be in touch.</h2><p>Your service selection and property details have been sent to Neal. He’ll follow up to confirm timing and final pricing.</p></div>';
  } catch {
    sending=false;submitButton.textContent='Request listing media →';update();
    submitStatus.textContent='Your request could not be sent. Your selections are still here. Try again, or call or text Neal at 330-990-9700.';
  }
});
try {
  const response = await fetch('/listing-media/pricing.json',{cache:'no-cache'});
  if (!response.ok) throw new Error('Pricing unavailable');
  catalog = await response.json();
  if (!Array.isArray(catalog.services) || !catalog.services.every(service=>(service.priceCents === null ? Number.isSafeInteger(service.addonPriceCents) && service.addonPriceCents >= 0 : Number.isSafeInteger(service.priceCents) && service.priceCents >= 0) && Array.isArray(service.addons) && service.addons.every(addon=>Number.isSafeInteger(addon.priceCents) && addon.priceCents>=0))) throw new Error('Invalid prices');
  for (const service of catalog.services) {
    form.querySelector(`[data-fee="${service.id}"]`).textContent=service.priceCents === null ? '—' : money(service.priceCents);
    const ids={basic:'basic-aerial',elevated:'elevated-aerial'};
    const offers=catalog.services.flatMap(parent=>parent.addons.filter(addon=>(ids[addon.id]||addon.id)===service.id).map(addon=>addon.priceCents));
    form.querySelector(`[data-addon-fee="${service.id}"]`).textContent=service.addonPriceCents !== undefined ? money(service.addonPriceCents) : offers.length ? money(Math.min(...offers)) : '—';
  }
  loadStatus.hidden=true;update();
} catch {
  catalog=null;
  loadStatus.textContent='Booking options could not load. Please call or text Neal at 330-990-9700.';
  submitButton.disabled=true;
}
