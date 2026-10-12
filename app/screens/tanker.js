// Tanker: alt du har fanget, sortert etter når det kommer tilbake. Ingen innboks som hoper seg opp.
import { h, icon, append } from '../ui/h.js';
import { app } from '../ui/appref.js';
import { now as nowFn, thingRow } from '../ui/parts.js';
import { openThing, openRetPicker, openDraft, undoToast } from '../ui/flows.js';
import { topBar } from './na.js';
import { store } from '../store.js';
import { actions } from '../actions.js';
import { HOUR, startOfDay, addDays } from '../../core/time.js';
import { PLACES } from '../../core/sort.js';
import { searchThoughts } from '../../core/search.js';

export const view = { q: '' };

function row(th) {
  return thingRow(th, {
    onCheck: () => {
      if (th.status === 'ferdig') { actions.reopen(th.id); return; }
      const l = actions.done(th.id);
      undoToast(`Ferdig: «${th.title}».`, l);
    },
    onOpen: () => (th.draft && th.draft.status !== 'sendt' ? openDraft(th.id) : openThing(th.id)),
    onRet: () => openRetPicker(th),
  });
}

function group(title, list, { sub = null, id = null } = {}) {
  if (!list.length) return null;
  return h('section', { class: 'section', id },
    h('div', { class: 'section-head' }, h('h2', { class: 'h3' }, title), h('span', { class: 'tag' }, sub || String(list.length))),
    h('div', { class: 'list' }, list.map(row)));
}

export function render() {
  const ds = store.ds();
  const t = nowFn();
  const today = startOfDay(t);
  const tomorrow = addDays(today, 1);
  const active = ds.things.filter((th) => th.status === 'aktiv' && th.kind !== 'avtale');
  const by = (fn) => active.filter(fn);
  const search = h('input', { type: 'search', id: 'tanker-q', placeholder: 'Søk: «hva tenkte jeg om pitchen?»', value: view.q, 'aria-label': 'Søk i alt du har fanget' });
  let timer = null;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { view.q = search.value; app.render(); setTimeout(() => { const el = document.getElementById('tanker-q'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 0); }, 250); });

  const screen = h('div', { class: 'screen' },
    topBar(t, { title: 'Tanker' }),
    h('section', { class: 'hello' },
      h('h1', { class: 'display' }, 'Tanker'),
      h('p', { class: 'status' }, h('span', null, `${active.length} ting har en plan for når de kommer tilbake.`))),
    h('div', { class: 'search' }, icon('search', { size: 18 }), search));

  if (view.q.trim()) {
    const hits = searchThoughts(view.q, ds.things.filter((x) => x.status !== 'slettet').map((x) => ({ ...x, text: `${x.title} ${x.text || ''} ${x.person || ''}` })), { now: t }).slice(0, 20);
    append(screen, hits.length
      ? h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', { class: 'h3' }, 'Treff'), h('span', { class: 'tag' }, String(hits.length))), h('div', { class: 'list' }, hits.map((r) => row(ds.things.find((x) => x.id === r.thought.id)))))
      : h('p', { class: 'empty' }, `Fant ingenting om «${view.q}».`));
    return screen;
  }

  const todayList = by((th) => (th.ret?.type === 'ledig' && th.kind !== 'frist') || (th.ret?.type === 'tid' && th.ret.at < tomorrow) || th.ret?.type === 'kveld' || th.ret?.type === 'etter');
  const placeGroups = Object.keys(PLACES).map((k) => [k, by((th) => th.ret?.type === 'sted' && th.ret.place === k)]).filter(([, l]) => l.length);
  const people = by((th) => th.ret?.type === 'person');
  const deadlines = by((th) => th.kind === 'frist').sort((a, b) => a.due - b.due);
  const later = by((th) => (th.ret?.type === 'tid' && th.ret.at >= tomorrow) || th.ret?.type === 'morgen').sort((a, b) => (a.ret.at || tomorrow) - (b.ret.at || tomorrow));
  const ideas = by((th) => th.ret?.type === 'uke');
  const done = ds.things.filter((th) => th.status === 'ferdig' && th.doneAt > t - 24 * HOUR);
  const archive = ds.things.filter((th) => th.status === 'arkiv');

  if (!active.length && !done.length) {
    append(screen, h('div', { class: 'card', style: { alignItems: 'center', textAlign: 'center' } },
      h('span', { class: 'orb lg', 'aria-hidden': 'true' }),
      h('p', { class: 'h3' }, 'Tomt her ennå'),
      h('p', { class: 'muted' }, 'Skriv det du tenker på i feltet nederst. «Kjøp melk», «ring tannlegen i morgen kl 9» eller «innlevering 1. desember». Jarvis sorterer.')));
    return screen;
  }

  append(screen, 
    group('I dag', todayList),
    group('Frister', deadlines),
    ...placeGroups.map(([k, l]) => group(`Når du er ${PLACES[k]}`, l)),
    group('Når du har kontakt med noen', people),
    group('Senere', later),
    group('Idéer · kommer søndag', ideas));
  if (done.length) append(screen, h('details', { class: 'list' }, h('summary', { class: 'fold' }, h('span', null, `Ferdig siste døgn · ${done.length}`), icon('down', { size: 18 })), done.map(row)));
  if (archive.length) append(screen, h('details', { class: 'list' }, h('summary', { class: 'fold' }, h('span', null, `Arkiv · ${archive.length}`), icon('down', { size: 18 })), archive.map(row)));
  return screen;
}
