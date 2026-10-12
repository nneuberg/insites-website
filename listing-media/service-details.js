document.querySelectorAll('.service-info').forEach(item => {
  const button = item.querySelector('.service-detail-trigger');
  const detail = item.querySelector('.service-detail');
  let pinned = false;
  const show = value => { detail.hidden = !value; button.setAttribute('aria-expanded', String(value)); };
  item.addEventListener('pointerenter', event => {if (event.pointerType === 'mouse') show(true);});
  item.addEventListener('pointerleave', () => {if (!pinned && !item.contains(document.activeElement)) show(false);});
  item.addEventListener('focusin', () => show(true));
  item.addEventListener('focusout', event => {if (!item.contains(event.relatedTarget)) {pinned = false;show(false);}});
  button.addEventListener('click', () => {pinned = !pinned;show(pinned);});
  item.addEventListener('keydown', event => {if (event.key === 'Escape') {pinned = false;show(false);event.stopPropagation();}});
  document.addEventListener('pointerdown', event => {if (!item.contains(event.target)) {pinned = false;show(false);}});
});
