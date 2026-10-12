// Fokus: en skive som en Time Timer (en time rundt), store tall, ett steg, og en vei tilbake uten skam.
import { h, icon, button, clear, append } from './h.js';
import { toast, setInert } from './sheet.js';
import { app } from './appref.js';
import { store } from '../store.js';
import { clock } from '../clock.js';
import { actions } from '../actions.js';
import { brain } from '../brain.js';
import { chime } from '../voice.js';
import { MIN, fmtCountdown } from '../../core/time.js';
import { retLabel } from '../../core/sort.js';
import { firstSmallStep } from '../../core/smaller.js';

let el = null;
let wake = null;
let shownCheck = {};
let baseTitle = 'Jarvis';

const active = () => store.ds().active || null;

function ticks() {
  let s = '';
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const big = i % 5 === 0;
    const r1 = big ? 80 : 84;
    const x1 = 100 + Math.sin(a) * r1; const y1 = 100 - Math.cos(a) * r1;
    const x2 = 100 + Math.sin(a) * 88; const y2 = 100 - Math.cos(a) * 88;
    s += `<line class="dial-tick" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke-width="${big ? 2.2 : 1}" stroke-linecap="round" opacity="${big ? 0.8 : 0.4}"/>`;
  }
  return s;
}

function wedgePath(frac) {
  if (frac <= 0) return '';
  if (frac >= 0.9999) return '<circle class="dial-wedge" cx="100" cy="100" r="76"/>';
  const a = frac * Math.PI * 2;
  const x = 100 - Math.sin(a) * 76;
  const y = 100 - Math.cos(a) * 76;
  // Mot klokka fra toppen, slik en Time Timer viser tid igjen.
  return `<path class="dial-wedge" d="M100 100 L100 24 A76 76 0 ${frac > 0.5 ? 1 : 0} 0 ${x.toFixed(2)} ${y.toFixed(2)} Z"/>`;
}

export function isFocusOpen() { return !!el; }

export function openFocus() {
  const a = active();
  if (!a) return;
  closeFocus(false);
  baseTitle = document.title.replace(/^\d+:\d+ · /, '') || 'Jarvis';
  shownCheck = {};
  el = h('section', { class: 'focus', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Fokus' });
  document.body.append(el);
  setInert(true);
  render();
  setTimeout(() => el?.querySelector('.btn-primary')?.focus({ preventScroll: true }), 50);
  try { navigator.wakeLock?.request('screen').then((w) => { wake = w; }).catch(() => {}); } catch { /* ikke støttet */ }
  tick();
}

export function closeFocus(restore = true) {
  if (!el) return;
  el.remove();
  el = null;
  setInert(false);
  try { wake?.release(); } catch { /* ferdig */ }
  wake = null;
  if (restore) document.title = baseTitle;
  app.render();
}

function render() {
  const a = active();
  if (!el || !a) return;
  clear(el);
  const th = store.ds().things.find((t) => t.id === a.thingId);
  const step = a.stepId && th?.steps ? th.steps.find((s) => s.id === a.stepId) : null;
  const first = a.pause ? 'Gå fra skjermen. Strekk deg, drikk vann.' : th ? (step ? step.title : firstSmallStep(th)) : 'Velg én ting og begynn smått.';
  const say = h('input', { class: 'input', id: 'focus-say', placeholder: 'Jeg kom på noe …', enterkeyhint: 'done' });
  const caught = h('p', { class: 'small muted', 'aria-live': 'polite' });
  const capture = async () => {
    const text = say.value.trim();
    if (!text) return;
    say.value = '';
    const res = await brain.handle(text);
    for (const t of res.saved) actions.edit(t.id, { heldRet: t.ret, ret: { type: 'etter' } }, `«${t.title}» venter til økta er ferdig.`);
    caught.textContent = res.saved.length ? `Tatt vare på: ${res.saved.map((t) => `«${t.title}»`).join(', ')}. Den kommer etter økta.` : (res.answer || res.done[0] || '');
  };
  say.addEventListener('keydown', (e) => { if (e.key === 'Enter') capture(); });
  const paused = !!a.pausedAt;
  append(el,
    h('div', { class: 'focus-top' },
      h('p', { class: 'eyebrow' }, a.pause ? 'Pause' : 'Fokus'),
      button('Skjul', () => closeFocus(), { kind: 'ghost', small: true, aria: 'Skjul fokus. Økta fortsetter.' })),
    h('div', { class: 'dial', id: 'dial', role: 'timer', 'aria-label': 'Tid igjen, vist på en skive på 60 minutter' },
      h('div', { html: `<svg viewBox="0 0 200 200" aria-hidden="true"><circle class="dial-face" cx="100" cy="100" r="96"/><g id="wedge"></g>${ticks()}<circle cx="100" cy="100" r="6" fill="var(--surface)" stroke="var(--line)"/></svg>`, style: { width: '100%', height: '100%' } })),
    h('div', null, h('div', { class: 'count', id: 'count' }, '–'), h('div', { class: 'count-sub', id: 'count-sub' }, '')),
    h('h2', { class: 'focus-title' }, a.title),
    h('div', { class: 'focus-card card' },
      h('p', { class: 'label' }, a.pause ? 'Nå' : 'Første lille steg'), h('p', null, first),
      h('p', { class: 'checkin', id: 'checkin', hidden: true })),
    h('div', { class: 'actions', style: { justifyContent: 'center' } },
      button('Ferdig', () => finish(true), { kind: 'primary', icon: 'check' }),
      button(paused ? 'Fortsett' : 'Pause', () => { if (paused) actions.resumeSession(); else actions.pauseSession(); render(); tick(); }, { icon: paused ? 'play' : 'pause' }),
      button('+5 min', () => { actions.extendSession(5); render(); tick(); }, { icon: 'plus' }),
      button('Stopp her', () => finish(false), { kind: 'ghost' })),
    a.pause ? null : h('div', { class: 'focus-card', style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, h('label', { class: 'label', for: 'focus-say' }, 'Fang en tanke uten å miste tråden'), say, caught));
}

function finish(done) {
  const a = active();
  if (!a) return;
  const r = actions.finishSession({ done: done && !a.pause });
  // Det som ble fanget underveis, får sin vanlige tilbakekomst igjen.
  const held = store.ds().things.filter((t) => t.ret?.type === 'etter');
  for (const t of held) actions.edit(t.id, { ret: t.heldRet || { type: 'ledig' }, heldRet: null }, `«${t.title}» kommer ${retLabel(t.heldRet || { type: 'ledig' }, clock.now())}.`);
  closeFocus();
  if (a.pause) { toast('Pausen er over. Velkommen tilbake.', { timeout: 3500 }); return; }
  const sub = held.length ? `${held.length} ${held.length === 1 ? 'tanke' : 'tanker'} fra økta ligger i Tanker.` : null;
  toast(done ? `Bra jobba. ${r?.actualMin || 0} minutter.` : `Du jobbet ${r?.actualMin || 0} minutter. Det teller.`, { sub, actions: r?.logId ? [{ label: 'Angre', onClick: () => actions.undo(r.logId) }] : [] });
}

/** Kalles hvert sekund fra appen. */
export function tick() {
  const a = active();
  if (!a) { if (el) closeFocus(); return; }
  const t = clock.now();
  const ref = a.pausedAt || t;
  const left = Math.max(0, a.end - ref);
  document.title = `${fmtCountdown(left)} · ${baseTitle}`;
  if (!el) return;
  const wedge = el.querySelector('#wedge');
  if (wedge) wedge.innerHTML = wedgePath(Math.min(1, left / (60 * MIN)));
  el.querySelector('#dial')?.classList.toggle('soon', left < 2 * MIN);
  const c = el.querySelector('#count');
  if (c) c.textContent = fmtCountdown(left);
  const sub = el.querySelector('#count-sub');
  if (sub) sub.textContent = a.pausedAt ? 'på pause' : left > 0 ? `igjen av ${Math.round((a.end - a.start - a.pausedTotal) / MIN)} min` : 'tiden er ute';
  const ci = el.querySelector('#checkin');
  const total = a.end - a.start - a.pausedTotal;
  if (ci && store.settings.checkins && !a.pause) {
    if (left <= 0 && !shownCheck.end) { shownCheck.end = true; ci.hidden = false; ci.textContent = 'Tiden er ute. Ferdig, fem minutter til, eller stopp her? Alt er like greit.'; if (store.settings.sound) { chime(); navigator.vibrate?.([120, 80, 120]); } }
    else if (left > 0 && left <= total / 2 && !shownCheck.half && total >= 8 * MIN) { shownCheck.half = true; ci.hidden = false; ci.textContent = `Halvveis. Fortsatt på «${a.title}»? Hvis du har gled ut, bare gå tilbake til steget.`; }
  } else if (left <= 0 && !shownCheck.end) { shownCheck.end = true; if (store.settings.sound) chime(); }
}
