// Små byggeklosser som går igjen: tilbakekomst-brikke, rader, ringen, mini-tidslinjen, valg.
import { h, icon } from './h.js';
import { clock } from '../clock.js';
import { MIN, startOfDay, atTime, hhmm, fmtDate } from '../../core/time.js';
import { retLabel, KINDS } from '../../core/sort.js';
import { nextStep } from '../../core/steps.js';

export const now = () => clock.now();

export function ago(t, n = now()) {
  const m = Math.round((n - t) / MIN);
  if (m < 1) return 'nå';
  if (m < 60) return `for ${m} min siden`;
  const hrs = Math.round(m / 60);
  if (hrs < 24) return `for ${hrs} t siden`;
  return fmtDate(t);
}

export function kindDot(kind) {
  return h('span', { class: `k-dot k-${kind}`, title: KINDS[kind] || '', 'aria-hidden': 'true' });
}

/** Brikken «↺ kommer i morgen kl. 08:30». Trykk for å endre. */
export function retChip(thing, onClick) {
  const label = thing.kind === 'avtale' && thing.start
    ? (thing.allDay ? fmtDate(thing.start) : `${fmtDate(thing.start)} kl. ${hhmm(thing.start)}`)
    : thing.draft && thing.draft.status !== 'sendt' ? 'venter på at du sender' : retLabel(thing.ret, now());
  return h('button', { type: 'button', class: 'ret', onClick, 'aria-label': `Kommer tilbake: ${label}. Endre` }, icon(thing.kind === 'avtale' ? 'clock' : 'comeback', { size: 14 }), h('span', null, label));
}

/** Første linje med innhold i et utkast (hopper over «Hei,»). */
export function snippet(body) {
  const lines = String(body || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const content = lines.find((l) => !/^(hei|hallo|kjære)\b[^.!?]*[,!]?$/i.test(l)) || lines[0] || '';
  return content.replace(/^(hei|hallo)\s+[^!,.]+[!,]\s*/i, '');
}

/** En ting som rad: avkrysning, tittel, tilbakekomst. */
export function thingRow(thing, { onCheck, onOpen, onRet, reason = null, extra = null } = {}) {
  const done = thing.status === 'ferdig';
  const step = thing.kind === 'frist' ? nextStep(thing) : null;
  const doneSteps = (thing.steps || []).filter((s) => s.done).length;
  return h('div', { class: `row${done ? ' done' : ''}` },
    thing.kind === 'avtale' || thing.kind === 'ide' || thing.kind === 'notat'
      ? h('span', { style: { width: '26px', display: 'grid', placeItems: 'center', paddingTop: '7px' } }, kindDot(thing.kind))
      : h('button', { type: 'button', class: `check${done ? ' on' : ''}`, 'aria-label': done ? `Åpne «${thing.title}» igjen` : `Merk «${thing.title}» som ferdig`, onClick: onCheck }, icon('check', { size: 15 })),
    h('div', { class: 'row-main' },
      reason ? h('span', { class: 'row-reason' }, reason) : null,
      h('button', { type: 'button', class: 'row-open', onClick: onOpen },
        h('span', { class: 'row-title' }, thing.title),
        step ? h('span', { class: 'small muted' }, `Neste steg: ${step.title}`) : null,
        thing.draft && thing.draft.status !== 'sendt' ? h('span', { class: 'small muted', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, `«${snippet(thing.draft.body)}»`) : null),
      h('div', { class: 'row-sub' },
        retChip(thing, onRet),
        thing.steps?.length ? h('span', { class: 'tag' }, `${doneSteps}/${thing.steps.length} steg`) : null,
        thing.due && thing.kind !== 'frist' ? h('span', { class: 'tag' }, `frist ${fmtDate(thing.due - 1)}`) : null,
        thing.kind === 'frist' && thing.due ? h('span', { class: 'tag', style: { color: 'var(--clay)' } }, `frist ${fmtDate(thing.due - 1)}`) : null),
      extra));
}

/** Ring som viser tid igjen. frac 0–1. */
export function ring({ value, unit, frac, soon = false, label }) {
  const r = 32;
  const c = 2 * Math.PI * r;
  return h('div', { class: `ring${soon ? ' soon' : ''}`, role: 'img', 'aria-label': label },
    h('div', { html: `<svg viewBox="0 0 76 76" width="76" height="76" aria-hidden="true"><circle class="track" cx="38" cy="38" r="${r}" fill="none" stroke-width="6"/><circle class="bar" cx="38" cy="38" r="${r}" fill="none" stroke-width="6" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - Math.max(0, Math.min(1, frac)))}"/></svg>`, style: { position: 'absolute', inset: '0' } }),
    h('div', null, h('div', { class: 'ring-num' }, value), h('div', { class: 'ring-unit' }, unit)));
}

/** Mini-tidslinje for resten av dagen (07–23). */
export function strip(events, n, { from = '07:00', to = '23:00', gap = null, onClick = null } = {}) {
  const d = startOfDay(n);
  const a = atTime(d, from);
  const b = atTime(d, to);
  const pos = (t) => `${Math.max(0, Math.min(100, ((t - a) / (b - a)) * 100))}%`;
  const width = (s, e) => `${Math.max(0.8, ((Math.min(e, b) - Math.max(s, a)) / (b - a)) * 100)}%`;
  const box = h(onClick ? 'button' : 'div', { class: 'strip', type: onClick ? 'button' : null, onClick, 'aria-label': 'Resten av dagen. Åpne Dag', style: onClick ? { width: '100%', border: '0', padding: '0', display: 'block' } : null },
    gap && gap.end > gap.start ? h('div', { class: 'strip-gap', style: { left: pos(gap.start), width: width(gap.start, gap.end) } }) : null,
    events.filter((e) => !e.allDay && e.end > a && e.start < b).map((e) => h('div', { class: `strip-ev${e.planned ? ' planned' : ''}`, title: `${hhmm(e.start)} ${e.planned && !e.deliver ? 'Økt: ' : ''}${e.title}`, style: { left: pos(e.start), width: width(e.start, e.end) } })),
    n >= a && n <= b ? h('div', { class: 'strip-now', style: { left: `calc(${pos(n)} - 1.5px)` } }) : null);
  const hours = [7, 11, 15, 19, 23];
  return h('div', null, box, h('div', { class: 'strip-axis', 'aria-hidden': 'true' }, hours.map((x) => h('span', null, String(x).padStart(2, '0')))));
}

/** Segmentvalg. options: [[verdi, tekst]]. */
export function seg(options, value, onChange, { label = null } = {}) {
  return h('div', { class: 'seg', role: 'group', 'aria-label': label },
    options.map(([v, t]) => h('button', { type: 'button', 'aria-pressed': String(v === value), onClick: () => onChange(v) }, t)));
}

export function toggleRow(label, sub, on, onChange) {
  return h('div', { class: 'toggle' },
    h('div', null, h('div', { style: { fontWeight: '600' } }, label), sub ? h('div', { class: 'small muted' }, sub) : null),
    h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(!!on), 'aria-label': label, onClick: () => onChange(!on) }));
}

export function field(label, input) {
  return h('div', { class: 'field' }, h('label', { for: input.id }, label), input);
}

/** Kopierer tekst, med reserve når utklippstavla ikke er tilgjengelig. */
export async function copyText(text, el = null) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (el?.select) { el.focus(); el.select(); }
    return false;
  }
}

