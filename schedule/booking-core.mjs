const canonical = id => ({basic:'basic-aerial',elevated:'elevated-aerial'}[id] || id);

export function calculateSelection(catalog, selectedIds) {
  const ids = new Set(selectedIds);
  const selected = catalog.services.filter(service => ids.has(service.id));
  if (ids.size !== selected.length) throw new Error('Unknown service');
  if (ids.has('photography') && ids.has('exterior')) throw new Error('Choose interior / exterior photography or exterior-only photography.');
  if (ids.has('basic-aerial') && ids.has('elevated-aerial')) throw new Error('Choose Basic Aerial or Elevated Aerial.');
  const primary = selected.find(service => service.priceCents !== null);
  if (selected.some(service => service.priceCents === null) && !primary) throw new Error('Add-on-only services require another media service.');
  const lines = selected.map(service => {
    if (service.priceCents === null) return {id:service.id,name:service.name,priceCents:service.addonPriceCents,addonTo:primary.name};
    const offers = selected.flatMap(parent => parent.addons.filter(addon => canonical(addon.id) === service.id).map(addon => ({priceCents:addon.priceCents,parent:parent.name})));
    const offer = offers.sort((a,b) => a.priceCents - b.priceCents)[0];
    return {id:service.id,name:service.name,priceCents:offer?.priceCents ?? service.priceCents,addonTo:offer?.parent ?? null};
  });
  return {lines,totalCents:lines.reduce((total,line)=>total+line.priceCents,0),hasPhotography:ids.has('photography')};
}

export function buildBookingPayload(catalog, selection, values) {
  const money = cents => '$' + (cents / 100).toFixed(2);
  const serviceLines = selection.lines.map(line => `${line.name}: ${money(line.priceCents)}${line.addonTo ? ` (add-on to ${line.addonTo})` : ' (standalone)'}`);
  const extra = selection.hasPhotography ? `Photography includes up to ${catalog.includedPhotos} photos; additional photos are ${money(catalog.extraPhotoCents)} each. The photo count is tailored to what is needed to portray the home.` : '';
  return {
    _subject:`New listing media request — ${values.property_address}`,
    _template:'table',
    name:values.realtor_name,email:values.email,phone:values.phone,brokerage:values.brokerage || 'Not provided',
    property_address:values.property_address,
    requested_services:serviceLines.join('\n'),
    priced_services_total:selection.lines.length ? money(selection.totalCents) : 'Quote required',
    pricing_notes:[extra,'Booking request; availability and final price require confirmation.'].filter(Boolean).join(' '),
    preferred_date:values.preferred_date || 'No specific date',date_flexibility:values.date_flexibility,notes:values.notes || 'None provided',
  };
}
