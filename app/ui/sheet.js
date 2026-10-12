// Ark og varsler. Ark glir opp nedenfra; hodet er glass, innholdet ligger på fast flate.
import { h, icon, clear } from './h.js';

let layer = null;
let toasts = null;
const stack = [];
let background = [];

/** Bakgrunnen kan ikke nås med tastatur eller skjermleser mens et ark eller fokus er åpent. */
export function setInert(on) {
  for (const el of background) el.inert = !!on;
  document.body.classList.toggle('has-sheet', !!on);
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export function initLayers(layerEl, toastEl, bg = []) {
  layer = layerEl;
  toasts = toastEl;
  background = bg;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && stack.length) closeSheet();
    if (e.key === 'Tab' && stack.length) {
      const box = stack[stack.length - 1].sheet;
      const items = [...box.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!box.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
}

/**
 * Åpner et ark. render(body, api) fyller innholdet; api.refresh() tegner på nytt, api.close() lukker.
 * Returnerer api.
 */
export function openSheet({ title, eyebrow = null, render, full = false, onClose = null, label = null, foot = null }) {
  const scrim = h('div', { class: 'scrim', onClick: () => closeSheet() });
  const body = h('div', { class: 'sheet-body' });
  const footEl = foot ? h('div', { class: 'sheet-foot' }) : null;
  const titleEl = h('div', { class: 'sheet-title' }, eyebrow ? h('p', { class: 'eyebrow' }, eyebrow) : null, h('h2', { class: 'h2', id: `sh-${stack.length}` }, title));
  const sheet = h('section', { class: `sheet${full ? ' full' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `sh-${stack.length}`, 'aria-label': label },
    h('header', { class: 'sheet-head glass' }, titleEl, h('button', { type: 'button', class: 'iconbtn', 'aria-label': 'Lukk', onClick: () => closeSheet() }, icon('close', { size: 20 }))),
    body, footEl);
  const prevFocus = document.activeElement;
  const api = {
    body,
    sheet,
    setTitle(t) { titleEl.querySelector('h2').textContent = t; },
    refresh() {
      const y = body.scrollTop;
      clear(body);
      render(body, api);
      if (footEl) { clear(footEl); foot(footEl, api); }
      body.scrollTop = y;
    },
    close: () => closeSheet(api),
    onClose,
    prevFocus,
  };
  stack.push({ scrim, sheet, api });
  layer.append(scrim, sheet);
  setInert(true);
  api.refresh();
  requestAnimationFrame(() => { scrim.classList.add('in'); sheet.classList.add('in'); });
  setTimeout(() => { const f = sheet.querySelector('[autofocus]'); (f || sheet.querySelector('.iconbtn'))?.focus({ preventScroll: true }); }, 60);
  return api;
}

export function closeSheet(which = null) {
  const idx = which ? stack.findIndex((s) => s.api === which) : stack.length - 1;
  if (idx < 0) return;
  const [s] = stack.splice(idx, 1);
  s.scrim.classList.remove('in');
  s.sheet.classList.remove('in');
  setTimeout(() => { s.scrim.remove(); s.sheet.remove(); }, 320);
  if (!stack.length) setInert(false);
  s.api.onClose?.();
  if (s.api.prevFocus?.focus) s.api.prevFocus.focus({ preventScroll: true });
}

export function closeAllSheets() {
  while (stack.length) closeSheet();
}

export function topSheet() {
  return stack[stack.length - 1]?.api || null;
}

export function refreshSheets() {
  for (const s of stack) s.api.refresh();
}

/** Varsel øverst. actions: [{label, onClick, primary}]. */
export function toast(text, { sub = null, actions = [], timeout = 6500, orb = false } = {}) {
  const el = h('div', { class: 'toast glass', role: 'status' },
    orb ? h('span', { class: 'orb', 'aria-hidden': 'true', style: { width: '24px', height: '24px' } }) : null,
    h('div', { class: 'toast-text' }, text, sub ? h('small', null, sub) : null),
    actions.map((a) => h('button', { type: 'button', class: `btn btn-small ${a.primary ? 'btn-primary' : 'btn-text'}`, onClick: () => { dismiss(); a.onClick(); } }, a.label)),
    h('button', { type: 'button', class: 'iconbtn', 'aria-label': 'Lukk varselet', onClick: () => dismiss(), style: { width: '36px', height: '36px' } }, icon('close', { size: 16 })));
  let timer = null;
  const dismiss = () => { clearTimeout(timer); el.remove(); };
  while (toasts.children.length >= 2) toasts.firstChild.remove();
  toasts.append(el);
  if (timeout) timer = setTimeout(dismiss, timeout);
  el.addEventListener('pointerenter', () => clearTimeout(timer));
  el.addEventListener('pointerleave', () => { if (timeout) { clearTimeout(timer); timer = setTimeout(dismiss, 3000); } });
  return dismiss;
}

export function clearToasts() {
  if (toasts) clear(toasts);
}
