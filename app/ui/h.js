// Små DOM-hjelpere og ikoner. Ingen rammeverk.

/** Lager et element: h('button', {class: 'x', onClick: fn, 'aria-label': '…'}, 'Tekst', barn…) */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k === 'selected') el.selected = !!v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el, ...children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === true) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

let idCounter = 0;
export function uid(prefix = 'id') {
  idCounter = (idCounter + 1) % 1e6;
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${idCounter.toString(36)}`;
}

const PATHS = {
  na: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  strom: '<path d="M4 7c3-3 5 3 8 0s5 3 8 0"/><path d="M4 12c3-3 5 3 8 0s5 3 8 0"/><path d="M4 17c3-3 5 3 8 0s5 3 8 0"/>',
  plan: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  staben: '<circle cx="12" cy="8" r="3"/><circle cx="5.5" cy="10" r="2.2"/><circle cx="18.5" cy="10" r="2.2"/><path d="M7 19c.6-3 2.6-5 5-5s4.4 2 5 5M2.5 18c.3-2 1.5-3.4 3-3.6M21.5 18c-.3-2-1.5-3.4-3-3.6"/>',
  meg: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c1-4 3.7-6 7-6s6 2 7 6"/>',
  mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>',
  send: '<path d="M4 12l16-8-6 16-2.5-6.5z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  play: '<path d="M8 5.5v13l11-6.5z"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1.5"/>',
  pause: '<path d="M9 6v12M15 6v12"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.7-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.8-7.5-9.5V6z"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  watch: '<rect x="7" y="6" width="10" height="12" rx="3"/><path d="M9 6l.7-3h4.6l.7 3M9 18l.7 3h4.6l.7-3"/>',
  wave: '<path d="M3 12h2M7 8v8M11 5v14M15 8v8M19 10.5v3M21 12h0"/>',
  alarm: '<circle cx="12" cy="13" r="7"/><path d="M12 9.5V13l2.5 1.5M4.5 5.5l3-2.5M19.5 5.5l-3-2.5"/>',
  nfc: '<path d="M7 7c3 3 3 7 0 10M11 4.5c4.5 4.5 4.5 10.5 0 15M15 2.5c5.5 5.5 5.5 13.5 0 19"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5h4"/>',
  star: '<path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/>',
  people: '<circle cx="9" cy="9" r="3"/><circle cx="17" cy="10" r="2.4"/><path d="M3.5 19c.8-3.4 2.9-5.2 5.5-5.2s4.7 1.8 5.5 5.2M15 14.2c2.5-.3 4.6 1.1 5.4 4.3"/>',
  edit: '<path d="M5 19l1-4L16 5l3 3L9 18z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  sparkle: '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4"/>',
  trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/>',
  sim: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  message: '<path d="M4.5 18.5l1.3-3.6A7.5 7.5 0 1 1 9 18.2z"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M5.5 15.5v-9a2 2 0 0 1 2-2h9"/>',
  inbox: '<path d="M4 13.5l2.5-7.5h11l2.5 7.5v4.5a1.5 1.5 0 0 1-1.5 1.5h-13a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M4 13.5h4.5l1.5 2.5h4l1.5-2.5H20"/>',
  wand: '<path d="M5 19l10-10M14 5v3M12.5 6.5h3M19 9v2M18 10h2M18 3.5v1.5M17.25 4.25h1.5"/>',
  undo: '<path d="M9 7.5L5 11.5l4 4"/><path d="M5.5 11.5h8a5 5 0 0 1 0 10h-2"/>',
  pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  wallet: '<rect x="3.5" y="6.5" width="17" height="12" rx="2.5"/><path d="M16 12.5h2.5M3.5 9.5h17"/>',
  cart: '<path d="M4 5h2l2 10h9.5l2-7H7"/><circle cx="9.5" cy="19" r="1.3"/><circle cx="16.5" cy="19" r="1.3"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c1-4 3.7-6 7-6s6 2 7 6"/>',
  book: '<path d="M5 5.5A2 2 0 0 1 7 3.5h12v15H7a2 2 0 0 0-2 2z"/><path d="M5 20.5V5.5"/>',
  flag: '<path d="M6 21V4M6 4.5h11l-2 4 2 4H6"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  cloud: '<path d="M7.5 18.5h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6-1.4A4.5 4.5 0 0 0 7.5 18.5z"/>',
  rain: '<path d="M7.5 15.5h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6-1.4A4.5 4.5 0 0 0 7.5 15.5z"/><path d="M9 18l-1 2.5M13 18l-1 2.5M17 18l-1 2.5"/>',
  snow: '<path d="M7.5 15.5h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6-1.4A4.5 4.5 0 0 0 7.5 15.5z"/><path d="M9 19h.01M13 19.5h.01M17 19h.01M11 21.5h.01M15 21.5h.01"/>',
  partly: '<circle cx="8.5" cy="8.5" r="3"/><path d="M8.5 2.5v1M2.5 8.5h1M4.3 4.3l.7.7M12.7 4.3l-.7.7"/><path d="M9.5 19.5h8a3.5 3.5 0 0 0 .3-7 4.8 4.8 0 0 0-9.2-.8 3.9 3.9 0 0 0 .9 7.8z"/>',
  storm: '<path d="M7.5 15.5h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6-1.4A4.5 4.5 0 0 0 7.5 15.5z"/><path d="M12.5 16l-2 3.5h3L11.5 23"/>',
  timer: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 1.5M9.5 2.5h5"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 16l-5-5-8 8.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/>',
  phone: '<path d="M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 4.5 5.5a2 2 0 0 1 2-2z"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/>',
  board: '<rect x="3.5" y="4.5" width="5" height="15" rx="1.5"/><rect x="10" y="4.5" width="5" height="10" rx="1.5"/><rect x="16.5" y="4.5" width="4" height="7" rx="1.5"/>',
  comeback: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v3.7h3.7"/>',
  archive: '<rect x="3.5" y="4.5" width="17" height="4" rx="1"/><path d="M5 8.5v10a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-10M10 12.5h4"/>',
  moon: '<path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z"/>',
  battery: '<rect x="3" y="7.5" width="16" height="9" rx="2"/><path d="M21 10.5v3"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4M12 13v4M10 15h4"/>',
  more: '<circle cx="6" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="18" cy="12" r="1"/>',
  down: '<path d="M6 9.5l6 6 6-6"/>',
  person: '<circle cx="12" cy="8" r="3.5"/><path d="M5.5 20c.9-3.8 3.4-6 6.5-6s5.6 2.2 6.5 6"/>',
  smaller: '<path d="M14 10l6-6M20 9V4h-5M10 14l-6 6M4 15v5h5"/>',
  walk: '<circle cx="13" cy="4.5" r="1.8"/><path d="M10.5 21l2-6-2.5-2.5 1-4.5 3.5 3 3 1M8.5 11.5l2-3.5"/>',
  eye: '<path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
};

/** Ikon som inline-SVG. Dekorativt (aria-hidden) med mindre label er gitt. */
export function icon(name, { size = 22, label = null, cls = '' } = {}) {
  const span = document.createElement('span');
  span.className = `icon ${cls}`.trim();
  if (label) { span.setAttribute('role', 'img'); span.setAttribute('aria-label', label); }
  else span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${PATHS[name] || ''}</svg>`;
  return span;
}

/** Knapp med tekst og valgfritt ikon. */
export function button(label, onClick, { kind = 'soft', icon: ic = null, aria = null, id = null, disabled = false, small = false, cls = '' } = {}) {
  return h('button', {
    type: 'button',
    class: `btn btn-${kind}${small ? ' btn-small' : ''}${cls ? ` ${cls}` : ''}`,
    onClick,
    'aria-label': aria,
    id,
    disabled,
  }, ic ? icon(ic, { size: small ? 16 : 18 }) : null, h('span', null, label));
}

