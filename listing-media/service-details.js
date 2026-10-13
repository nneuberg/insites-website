let serviceKeyboardInteraction = false;
document.addEventListener('keydown', () => {serviceKeyboardInteraction = true;}, true);
document.addEventListener('pointerdown', () => {serviceKeyboardInteraction = false;}, true);
document.querySelectorAll('.service-info').forEach(item => {
  const button = item.querySelector('.service-detail-trigger');
  const detail = item.querySelector('.service-detail');
  let pinned = false;
  const show = value => { detail.hidden = !value; button.setAttribute('aria-expanded', String(value)); };
  item.addEventListener('pointerenter', event => {if (event.pointerType === 'mouse') show(true);});
  item.addEventListener('pointerleave', event => {if (event.pointerType === 'mouse') {pinned = false;show(false);}});
  item.addEventListener('focusin', () => {if (serviceKeyboardInteraction) show(true);});
  item.addEventListener('focusout', event => {if (!item.contains(event.relatedTarget)) {pinned = false;show(false);}});
  button.addEventListener('click', event => {if (event.detail > 0 && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {pinned = false;show(true);return;} pinned = !pinned;show(pinned);});
  item.addEventListener('keydown', event => {if (event.key === 'Escape') {pinned = false;show(false);event.stopPropagation();}});
  document.addEventListener('pointerdown', event => {if (!item.contains(event.target)) {pinned = false;show(false);}});
});

function closeExample(serviceId, returnFocus = true) {
  const row = document.querySelector('#examples-' + serviceId);
  if (!row) return;
  row.hidden = true;
  row.querySelectorAll('video').forEach(video => video.pause());
  row.querySelectorAll('iframe').forEach(frame => frame.removeAttribute('src'));
  const trigger = document.querySelector('.service-example-toggle[data-example-service="' + serviceId + '"]');
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
  if (returnFocus && serviceKeyboardInteraction) document.querySelector('#detail-' + serviceId)?.parentElement.querySelector('.service-detail-trigger')?.focus();
}
document.querySelectorAll('.service-example-toggle').forEach(trigger => {
  trigger.addEventListener('click', () => {
    const id = trigger.dataset.exampleService;
    const row = document.querySelector('#examples-' + id);
    if (!row) return;
    if (!row.hidden) {closeExample(id);return;}
    document.querySelectorAll('.service-examples-row:not([hidden])').forEach(other => closeExample(other.id.replace('examples-', ''), false));
    row.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    row.querySelectorAll('[data-src]').forEach(media => {if (!media.getAttribute('src')) media.src = media.dataset.src;});
    const detail = document.querySelector('#detail-' + id);
    if (detail) {detail.hidden = true;detail.parentElement.querySelector('.service-detail-trigger').setAttribute('aria-expanded', 'false');}
    const section = row.querySelector('section');
    section.focus({preventScroll:true});
    section.scrollIntoView({behavior:'smooth', block:'nearest'});
  });
});
document.querySelectorAll('.service-example-close').forEach(button => button.addEventListener('click', () => closeExample(button.dataset.exampleService)));
document.querySelectorAll('.service-examples').forEach(section => section.addEventListener('keydown', event => {if (event.key === 'Escape') {closeExample(section.closest('tr').id.replace('examples-', ''));event.stopPropagation();}}));
document.querySelectorAll('.service-example-media video').forEach(video => video.addEventListener('loadedmetadata', () => {
  video.closest('figure').classList.toggle('portrait', video.videoHeight > video.videoWidth);
}));
