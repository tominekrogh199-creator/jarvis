// Dag: tidslinje med avtaler, ledige luker du kan fylle, «gå nå»-merker og dagens steg.
import { h, icon, button, append } from '../ui/h.js';
import { app } from '../ui/appref.js';
import { now as nowFn, kindDot } from '../ui/parts.js';
import { openThing, openGap, openNewEvent, openImport, openRetPicker, undoToast } from '../ui/flows.js';
import { openPlan } from '../ui/plan.js';
import { topBar } from './na.js';
import { store } from '../store.js';
import { actions } from '../actions.js';
import { eventsOf } from '../model.js';
import { MIN, HOUR, startOfDay, addDays, atTime, hhmm, fmtDuration, WEEKDAYS, WEEKDAYS_SHORT, MONTHS } from '../../core/time.js';
import { freeGaps } from '../../core/planner.js';
import { leaveAt } from '../../core/now.js';

export const view = { day: null };

const PX = 58;

function lanes(items) {
  const out = [];
  const ends = [];
  for (const it of items) {
    let lane = ends.findIndex((e) => e <= it.start);
    if (lane < 0) { lane = ends.length; ends.push(it.end); } else ends[lane] = it.end;
    out.push({ ...it, lane });
  }
  const maxLane = Math.max(1, ends.length);
  return out.map((x) => ({ ...x, lanes: maxLane }));
}

/** Tidslinja for én dag. compact = sidepanelet på store skjermer. */
export function timeline(dayT, { compact = false } = {}) {
  const ds = store.ds();
  const t = nowFn();
  const isToday = startOfDay(dayT) === startOfDay(t);
  const events = eventsOf(ds).filter((e) => !e.allDay && e.end > dayT && e.start < addDays(dayT, 1));
  const sessions = (ds.sessions || []).filter((s) => startOfDay(s.start) === startOfDay(dayT)).map((s) => ({ id: s.id, title: s.title, start: s.start, end: s.start + s.actualMin * MIN, session: true }));
  let from = 7;
  let to = 23;
  for (const e of events) { from = Math.min(from, new Date(Math.max(e.start, dayT)).getHours()); to = Math.max(to, Math.min(24, new Date(e.end).getHours() + 1)); }
  if (compact && isToday) from = Math.max(from, Math.min(new Date(t).getHours() - 1, 18));
  const top = atTime(dayT, `${String(from).padStart(2, '0')}:00`);
  const y = (ts) => ((ts - top) / HOUR) * PX + 10;
  const height = (to - from) * PX + 20;
  const box = h('div', { class: 'tl', style: { height: `${height}px` }, role: 'list', 'aria-label': `Tidslinje ${WEEKDAYS[new Date(dayT).getDay()]}` });
  for (let hr = from; hr <= to; hr++) {
    const yy = y(atTime(dayT, `${String(hr).padStart(2, '0')}:00`));
    append(box, h('div', { class: 'tl-line', style: { top: `${yy}px` } }), h('span', { class: 'tl-hour', style: { top: `${yy}px` } }, `${String(hr % 24).padStart(2, '0')}:00`));
  }
  const gaps = freeGaps(dayT, { now: isToday ? t : 0, events: events.map((e) => ({ ...e, status: 'aktiv' })), dayStart: `${String(from).padStart(2, '0')}:00`, dayEnd: `${String(Math.min(to, 23)).padStart(2, '0')}:00`, minMin: 30 });
  for (const g of gaps) {
    append(box, h('button', { type: 'button', class: 'tl-gap', style: { top: `${y(g.start) + 3}px`, height: `${Math.max(26, y(g.end) - y(g.start) - 6)}px` }, onClick: () => openGap(g), 'aria-label': `Ledig ${hhmm(g.start)} til ${hhmm(g.end)}. Hva passer her?` }, `Ledig ${fmtDuration(g.minutes)} · hva passer?`));
  }
  const laid = lanes([...events, ...sessions].sort((a, b) => a.start - b.start));
  for (const e of laid) {
    const top0 = y(Math.max(e.start, top));
    const hgt = Math.max(30, y(e.end) - top0 - 3);
    const w = 100 / e.lanes;
    const item = h('button', {
      type: 'button',
      role: 'listitem',
      class: `tl-item${e.session ? ' session' : ''}${e.planned ? ' planned' : ''}${e.deliver ? ' deliver' : ''}${e.end < t ? ' past' : ''}`,
      style: { top: `${top0}px`, height: `${hgt}px`, left: `calc(60px + (100% - 74px) * ${(e.lane * w) / 100})`, right: 'auto', width: `calc((100% - 74px) * ${w / 100} - 4px)` },
      onClick: () => { if (e.planned) openPlan(e.thingId); else if (e.thingId) openThing(e.thingId); else if (!e.session) openCalendarEvent(e); },
    }, h('b', null, e.session ? `Fokus: ${e.title}` : e.planned && !e.deliver ? `Økt: ${e.title}` : e.title), h('small', null, `${hhmm(e.start)}–${hhmm(e.end)}${e.planned && !e.deliver ? ` · ${e.context}` : ''}${e.person ? ` · ${e.person}` : ''}${e.travelMin ? ` · ${e.travelMin} min reise` : ''}${e.source === 'gcal' ? ' · Google' : ''}`));
    append(box, item);
    const go = leaveAt(e);
    if (go && go > top && !e.session) append(box, h('div', { class: 'tl-go', style: { top: `${y(go)}px` } }, h('span', null, `Gå ${hhmm(go)}`)));
  }
  if (isToday && t > top && t < atTime(dayT, `${String(Math.min(to, 23)).padStart(2, '0')}:59`)) append(box, h('div', { class: 'tl-now', style: { top: `${y(t)}px` }, 'data-t': hhmm(t), 'aria-label': `Nå, ${hhmm(t)}` }));
  return box;
}

/** Avtaler fra kalenderfila: vis kort info, og la brukeren avlyse dem her i appen. */
function openCalendarEvent(e) {
  undoToast(`${e.title}: ${hhmm(e.start)}–${hhmm(e.end)}${e.place ? ` · ${e.place}` : ''}`, null, { more: [{ label: 'Avlys her', onClick: () => { const l = actions.cancelEvent(e.id); undoToast(`Avlyste «${e.title}» i appen.`, l); } }] });
}

function stepsFor(ds, dayT) {
  const out = [];
  for (const th of ds.things) {
    if (th.status !== 'aktiv' || th.kind !== 'frist' || !th.steps) continue;
    for (const s of th.steps) if (startOfDay(s.at || s.day) === startOfDay(dayT)) out.push({ th, s });
  }
  return out.sort((a, b) => (a.s.at || 0) - (b.s.at || 0));
}

export function render() {
  const ds = store.ds();
  const t = nowFn();
  const today = startOfDay(t);
  if (!view.day || view.day < today - 7 * 86400000) view.day = today;
  const day = view.day;
  const d = new Date(day);
  const events = eventsOf(ds);
  const allDay = events.filter((e) => e.allDay && startOfDay(e.start) === day);
  const timed = events.filter((e) => !e.allDay && !e.planned && startOfDay(e.start) === day);
  const steps = stepsFor(ds, day);
  const dueToday = ds.things.filter((th) => th.status === 'aktiv' && th.due && startOfDay(th.due - 1) === day);
  const gaps = freeGaps(day, { now: day === today ? t : 0, events: events.filter((e) => !e.allDay).map((e) => ({ ...e, status: 'aktiv' })), dayStart: '07:00', dayEnd: '23:00', minMin: 10 });
  const free = gaps.reduce((s, g) => s + g.minutes, 0);
  return h('div', { class: 'screen' },
    topBar(t, { title: 'Dag' }),
    h('section', { class: 'hello' },
      h('h1', { class: 'display' }, day === today ? 'I dag' : day === addDays(today, 1) ? 'I morgen' : `${WEEKDAYS[d.getDay()].charAt(0).toUpperCase()}${WEEKDAYS[d.getDay()].slice(1)}`),
      h('p', { class: 'status' }, h('b', null, `${d.getDate()}. ${MONTHS[d.getMonth()]}`), h('span', null, `${timed.length} ${timed.length === 1 ? 'avtale' : 'avtaler'}`), h('span', null, `ledig ${fmtDuration(free)}`))),
    h('nav', { class: 'days', 'aria-label': 'Velg dag' }, Array.from({ length: 8 }, (_, i) => addDays(today, i)).map((x) => {
      const dd = new Date(x);
      const has = events.some((e) => startOfDay(e.start) === x) || stepsFor(ds, x).length;
      return h('button', { type: 'button', class: 'day-btn', 'aria-current': x === day ? 'date' : null, onClick: () => { view.day = x; app.render(); } },
        h('small', null, i0(x, today) === 0 ? 'i dag' : WEEKDAYS_SHORT[dd.getDay()]), String(dd.getDate()), has ? h('span', { class: 'dot', 'aria-hidden': 'true' }) : h('span', { style: { height: '5px' } }));
    })),
    allDay.length || dueToday.length ? h('div', { class: 'allday' },
      allDay.map((e) => h('button', { type: 'button', class: 'chip', onClick: () => e.thingId && openThing(e.thingId) }, icon('calendar', { size: 15 }), e.title)),
      dueToday.map((th) => h('button', { type: 'button', class: 'chip', style: { color: 'var(--clay)' }, onClick: () => openThing(th.id) }, icon('flag', { size: 15 }), `Frist: ${th.title}`))) : null,
    steps.length ? h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', { class: 'h3' }, steps.some((x) => x.s.at) ? (day === today ? 'Dagens økter' : 'Økter denne dagen') : day === today ? 'Dagens steg' : 'Steg denne dagen')),
      h('div', { class: 'list' }, steps.map(({ th, s }) => h('div', { class: `row${s.done ? ' done' : ''}` },
        h('button', { type: 'button', class: `check${s.done ? ' on' : ''}`, 'aria-label': s.done ? `Åpne steget «${s.title}» igjen` : `Merk steget «${s.title}» som gjort`, onClick: () => actions.stepDone(th.id, s.id, !s.done) }, icon('check', { size: 15 })),
        h('button', { type: 'button', class: 'row-open', onClick: () => (s.at ? openPlan(th.id) : openThing(th.id)) }, h('span', { class: 'row-title' }, s.title), h('span', { class: 'small muted' }, `${s.at ? `${hhmm(s.at)}–${hhmm(s.end)} · ` : ''}${th.title}${s.deliver ? '' : ` · ${s.estimateMin} min`}`)))))) : null,
    timeline(day),
    h('div', { class: 'actions' },
      button('Ny avtale', () => openNewEvent(day), { kind: 'soft', icon: 'plus' }),
      day === today ? button('Har dårlig tid?', () => { const r = actions.triage(); undoToast(r.moved ? `Ryddet dagen: ${r.moved} ting kommer i morgen tidlig.` : 'Det som står igjen, haster.', r.logId); }, { kind: 'soft', icon: 'bolt' }) : null,
      button('Hent inn kalender', () => openImport(), { kind: 'text', icon: 'calendar' })),
    plannedLater(ds, day, t));
}

function i0(x, today) { return Math.round((x - today) / 86400000); }

/** Ting som er satt til å komme tilbake denne dagen. */
function plannedLater(ds, day, t) {
  const list = ds.things.filter((th) => th.status === 'aktiv' && th.kind !== 'avtale' && th.ret?.type === 'tid' && startOfDay(th.ret.at) === day).sort((a, b) => a.ret.at - b.ret.at);
  if (!list.length) return null;
  return h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', { class: 'h3' }, 'Kommer tilbake denne dagen')),
    h('div', { class: 'list' }, list.map((th) => h('div', { class: 'row' },
      h('span', { class: 'mono small', style: { width: '44px', paddingTop: '2px', color: th.ret.at < t ? 'var(--ink-3)' : 'var(--ink)' } }, hhmm(th.ret.at)),
      kindDot(th.kind),
      h('button', { type: 'button', class: 'row-open', onClick: () => openThing(th.id) }, h('span', { class: 'row-title' }, th.title)),
      button('Endre', () => openRetPicker(th), { kind: 'text', small: true })))));
}
