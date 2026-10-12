// Nå: tiden synlig, det som skal komme tilbake akkurat nå, og én ting.
import { h, icon, button } from '../ui/h.js';
import { app } from '../ui/appref.js';
import { ring, strip, kindDot, snippet, now as nowFn } from '../ui/parts.js';
import { openRetPicker, openDraft, openThing, openBrief, openWrap, openStuck, openPlace, openSettings, openWeatherInfo, undoToast, briefData, wrapData, energyBlock } from '../ui/flows.js';
import { openFocus } from '../ui/focus.js';
import { store } from '../store.js';
import { actions } from '../actions.js';
import { weather, SOURCE_LABEL } from '../weather.js';
import { eventsOf, nowState, surfacing, pendingDrafts, currentPlace } from '../model.js';
import { MIN, HOUR, startOfDay, atTime, hhmm, fmtCountdown, WEEKDAYS_SHORT, MONTHS_SHORT } from '../../core/time.js';
import { greeting } from '../../core/brief.js';
import { timeStatus, leaveAt } from '../../core/now.js';
import { PLACES } from '../../core/sort.js';
import { describe } from '../../core/weather.js';
import { firstSmallStep } from '../../core/smaller.js';
import { canWait } from '../../core/planwork.js';
import { openPlan, waitingRow } from '../ui/plan.js';

/** 90 → «90», 135 → «2:15». */
function ringValue(min) {
  return min > 99 ? `${Math.floor(min / 60)} t` : String(Math.max(0, min));
}
function ringUnit(min, word = '') {
  if (min > 99) return `${min % 60 ? `${min % 60} min` : 'timer'}${word ? ` ${word}` : ''}`;
  return word ? `min ${word}` : 'min';
}

const WX_ICON = { sol: 'sun', 'sky-sol': 'partly', sky: 'cloud', regn: 'rain', sno: 'snow', torden: 'storm' };

export function topBar(t, { title = null } = {}) {
  const d = new Date(t);
  const w = weather.data;
  return h('header', { class: 'top' },
    h('div', { class: 'top-meta' },
      h('span', { class: 'clock' }, `${WEEKDAYS_SHORT[d.getDay()]} ${d.getDate()}. ${MONTHS_SHORT[d.getMonth()]} · ${hhmm(t)}`),
      store.demo ? h('button', { type: 'button', class: 'demo-pill', onClick: () => openSettings(), title: 'Du ser en eksempeldag. Trykk for å bytte til dine egne ting.' }, 'Eksempeldag') : null,
      title ? h('span', { class: 'sr' }, title) : null),
    h('div', { class: 'top-actions' },
      h('button', { type: 'button', class: 'wx', onClick: () => openWeatherInfo(), 'aria-label': w ? `Været: ${w.now.temp} grader, ${w.now.desc}. Kilde: ${SOURCE_LABEL[w.source] || w.source}` : 'Været er ikke tilgjengelig her' },
        icon(w ? (WX_ICON[describe(w.now.code).kind] || 'cloud') : 'cloud', { size: 18 }),
        w ? `${w.now.temp}°` : h('small', null, 'Vær'),
        w?.source === 'eksempel' ? h('small', null, 'eks.') : null),
      h('button', { type: 'button', class: 'me', onClick: () => openSettings(), 'aria-label': 'Meg og innstillinger' }, (store.settings.name || 'Meg').charAt(0).toLocaleUpperCase('nb'))));
}

function hello(t, n, ds) {
  const st = timeStatus(n, t);
  const next = n.next;
  const go = next ? leaveAt(next) : null;
  const place = currentPlace(ds, t);
  const inSession = n.pick?.session && n.pick.step?.at <= t;
  const nextToday = next && startOfDay(next.start) === startOfDay(t);
  return h('section', { class: 'hello' },
    h('h1', { class: 'display' }, greeting(t, store.settings.name)),
    h('p', { class: 'status' },
      h('b', null, inSession ? `Økt til ${hhmm(n.pick.step.end)}` : st.title),
      go && go > t ? h('span', { class: 'go' }, icon('walk', { size: 16 }), `Gå ${hhmm(go)}`) : null,
      nextToday && n.mode !== 'opptatt' ? h('span', null, `${next.planned && !next.deliver ? 'Økt: ' : ''}${next.title} ${hhmm(next.start)}`) : null,
      n.mode === 'opptatt' ? h('span', null, n.event.title) : null),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'chip', onClick: () => openPlace() }, icon('pin', { size: 15 }), place ? `Du er ${PLACES[place]}` : 'Hvor er du?')));
}

function activeCard(ds, t) {
  const a = ds.active;
  if (!a) return null;
  const left = Math.max(0, a.end - (a.pausedAt || t));
  return h('button', { type: 'button', class: 'card', onClick: () => openFocus(), style: { flexDirection: 'row', alignItems: 'center', textAlign: 'left', border: '0' } },
    h('span', { class: 'orb', 'data-state': 'svarer', 'aria-hidden': 'true' }),
    h('span', { style: { flex: '1', minWidth: '0' } }, h('span', { class: 'eyebrow', style: { display: 'block' } }, a.pause ? 'Pause pågår' : 'Økt pågår'), h('span', { style: { fontWeight: '600' } }, a.title)),
    h('span', { class: 'mono', style: { fontSize: '22px', fontWeight: '600' } }, a.pausedAt ? 'pause' : fmtCountdown(left)));
}

function comebackCard(ds, t) {
  const s = ds.seen || {};
  if (!s.comeback || t - s.comeback > 8 * HOUR || s.comebackDismissed === s.comeback) return null;
  const n = nowState(ds, t);
  const one = n.pick;
  return h('section', { class: 'card', style: { gap: '12px' } },
    h('p', { class: 'eyebrow' }, 'Comeback'),
    h('h2', { class: 'h2' }, 'Velkommen tilbake.'),
    h('p', null, s.comebackText || 'Jeg har ryddet. Ingenting er slettet.'),
    one ? h('p', { class: 'muted' }, 'Én ting å starte med: ', h('b', { style: { color: 'var(--ink)' } }, one.title)) : null,
    h('div', { class: 'actions' },
      one ? button('Start 5 min', () => app.startFocus({ thingId: one.thing.id, stepId: one.step?.id || null, title: one.title, minutes: 5 }), { kind: 'primary', icon: 'play' }) : null,
      button('Takk', () => { actions.markSeen('comebackDismissed', s.comeback); app.render(); }, { kind: 'text' })));
}

function briefCard(ds, t) {
  const today = startOfDay(t);
  const hr = new Date(t).getHours();
  if (ds.seen?.brief === today || hr < 4 || hr >= 12) return null;
  const b = briefData();
  const wx = b.lines.find((l) => l.kind === 'vaer');
  const first = b.lines.find((l) => l.kind === 'forst');
  return h('section', { class: 'card', style: { gap: '12px' } },
    h('div', { class: 'section-head', style: { padding: '0' } }, h('p', { class: 'eyebrow' }, 'Morgenbrief'), wx?.source === 'eksempel' ? h('span', { class: 'tag' }, 'eksempelvær') : null),
    wx ? h('p', null, wx.text, wx.action ? h('b', { style: { display: 'block', marginTop: '2px' } }, wx.action) : null) : null,
    first ? h('p', null, first.text, first.action ? h('b', { style: { display: 'block', marginTop: '2px', color: 'var(--amber)' } }, first.action) : null) : null,
    b.steps.length ? h('p', { class: 'muted' }, 'Dagens steg: ', h('b', { style: { color: 'var(--ink)' } }, b.steps[0].step.title)) : null,
    b.undecided.length ? h('p', { class: 'muted' }, `${b.undecided.length} ${b.undecided.length === 1 ? 'tanke' : 'tanker'} uten plan venter på deg.`) : null,
    energyBlock(),
    h('div', { class: 'actions' }, button('Hele briefen', () => openBrief(), { kind: 'soft', small: true }), button('Ferdig', () => { actions.markSeen('brief'); app.render(); }, { kind: 'text', small: true })));
}

function wrapCard(ds, t) {
  const today = startOfDay(t);
  const [eh, em] = store.settings.eveningTime.split(':').map(Number);
  if (ds.seen?.wrap === today || t < atTime(today, `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`)) return null;
  const w = wrapData();
  const n = w.done.length + w.stepsDone.length;
  return h('section', { class: 'card', style: { gap: '10px' } },
    h('p', { class: 'eyebrow' }, 'Kveldsavslutning · to minutter'),
    h('p', null, n ? `Du fikk gjort ${n} ${n === 1 ? 'ting' : 'ting'} i dag.` : 'Noen dager handler om å komme gjennom. Det teller også.'),
    w.unfinished.length ? h('p', { class: 'muted' }, `${w.unfinished.length} ${w.unfinished.length === 1 ? 'ting kan' : 'ting kan'} flyttes til i morgen med ett trykk.`) : null,
    h('div', { class: 'actions' }, button('Ta avslutningen', () => openWrap(), { kind: 'primary', small: true }), button('Ikke i kveld', () => { actions.markSeen('wrap'); app.render(); }, { kind: 'text', small: true })));
}

function surfaceSection(ds, t, n) {
  const list = surfacing(ds, t).filter((x) => x.thing.id !== n.pick?.thing.id);
  if (!list.length) return null;
  return h('section', { class: 'section', 'aria-label': 'Dukker opp nå' },
    h('div', { class: 'section-head' }, h('h2', { class: 'h3' }, 'Dukker opp nå'), h('span', { class: 'tag' }, String(list.length))),
    h('div', { class: 'list' }, list.map(({ thing, reason, type, step }) => h('div', { class: 'row' },
      kindDot(thing.kind),
      h('div', { class: 'row-main' },
        h('span', { class: 'row-reason' }, reason),
        h('button', { type: 'button', class: 'row-open', onClick: () => (thing.draft ? openDraft(thing.id) : openThing(thing.id)) }, h('span', { class: 'row-title' }, thing.title)),
        h('div', { class: 'actions' }, ['okt', 'lever'].includes(type)
          ? app.surfaceActions({ thing, type, step }).map((a, i) => button(a.label, a.onClick, { kind: i ? 'text' : 'soft', small: true, icon: i ? null : type === 'okt' ? 'play' : 'check' }))
          : type === 'sendt'
          ? [button('Ja, sendt', () => { const l = actions.draftSent(thing.id); undoToast('Bra. Markert som sendt.', l); }, { kind: 'soft', small: true }), button('Ikke ennå', () => actions.draftNotYet(thing.id), { kind: 'text', small: true })]
          : [
            ['oppgave', 'frist'].includes(thing.kind) ? button('Start', () => app.startFocus({ thingId: thing.id, title: thing.title, minutes: Math.min(25, thing.estimateMin || 15) }), { kind: 'soft', small: true, icon: 'play' }) : null,
            thing.draft ? button('Se utkastet', () => openDraft(thing.id), { kind: 'soft', small: true }) : null,
            button('Gjort', () => { const l = actions.done(thing.id); undoToast(`Ferdig: «${thing.title}».`, l); }, { kind: 'text', small: true, icon: 'check' }),
            button('Senere', () => openRetPicker(thing, { later: true }), { kind: 'text', small: true }),
          ]))))));
}

function nowCard(ds, t, n) {
  if (n.mode === 'opptatt') {
    const e = n.event;
    const total = Math.max(1, (e.end - e.start) / MIN);
    const left = Math.round((e.end - t) / MIN);
    const after = n.pick;
    return h('section', { class: 'now', 'aria-label': 'Nå' },
      h('div', { class: 'now-main' },
        h('p', { class: 'eyebrow' }, `Nå · opptatt til ${hhmm(e.end)}`),
        h('h2', { class: 'now-title' }, e.title),
        h('p', { class: 'now-why' }, after ? `Etterpå: ${after.title}.` : 'Etterpå har du ingenting som haster.')),
      ring({ value: ringValue(left), unit: ringUnit(left, 'igjen'), frac: left / total, soon: left <= 10, label: `${left} minutter igjen av ${e.title}` }),
      h('div', { class: 'actions' },
        button('Fang en tanke', () => app.focusInput(), { kind: 'soft', icon: 'plus' }),
        button('Har dårlig tid?', () => { const r = actions.triage(); undoToast(r.moved ? `Ryddet dagen: ${r.moved} ting kommer i morgen tidlig.` : 'Det som står igjen, haster.', r.logId); }, { kind: 'text' })));
  }
  if (n.mode === 'tomt' || !n.pick) {
    return h('section', { class: 'now', 'aria-label': 'Nå' },
      h('div', { class: 'now-main' },
        h('p', { class: 'eyebrow' }, 'Nå'),
        h('h2', { class: 'now-title' }, 'Ingenting haster.'),
        h('p', { class: 'now-why' }, 'Hvil, eller fang det du tenker på. Jeg sier fra når noe skal komme tilbake.')),
      ring({ value: ringValue(n.gapMin), unit: ringUnit(n.gapMin), frac: Math.min(1, n.gapMin / 120), label: `${n.gapMin} minutter ledig` }),
      h('div', { class: 'actions' }, button('Fang en tanke', () => app.focusInput(), { kind: 'soft', icon: 'plus' }), button('Se dagen', () => app.go('dag'), { kind: 'text' })),
      !ds.things.length ? h('div', { style: { gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: '8px' } },
        h('p', { class: 'small muted' }, 'Prøv å si noe, så ser du hvordan det sorteres:'),
        h('div', { class: 'actions' }, ['Kjøp melk', 'Ring tannlegen i morgen kl 9', 'Innlevering i markedsføring 1. desember', 'Si til Emma at jeg kommer litt sent'].map((x) => h('button', { type: 'button', class: 'chip', onClick: () => app.fill(x) }, x)))) : null);
  }
  const p = n.pick;
  const th = p.thing;
  const isDraft = !!th.draft && th.draft.status !== 'sendt';
  const step = p.step ? p.step.title : th.firstStep || null;
  if (p.session && p.step) {
    const left = Math.max(0, Math.round((p.step.end - t) / MIN));
    const total = Math.max(1, (p.step.end - p.step.at) / MIN);
    const started = p.step.at <= t;
    return h('section', { class: 'now session-now', 'aria-label': 'Nå' },
      h('div', { class: 'now-main' },
        h('p', { class: 'eyebrow' }, `Økt ${started ? 'nå' : `kl. ${hhmm(p.step.at)}`} · ${hhmm(p.step.at)}–${hhmm(p.step.end)}`),
        h('span', { class: 'now-ctx' }, th.title),
        h('h2', { class: 'now-title' }, p.step.title),
        h('p', { class: 'now-why' }, `Du satte av denne tiden. Etterpå kan ${th.title.toLocaleLowerCase('nb')} hvile til neste økt.`)),
      ring({ value: ringValue(started ? left : p.step.estimateMin || total), unit: ringUnit(started ? left : total, started ? 'igjen' : ''), frac: started ? left / total : 1, soon: started && left <= 10, label: started ? `${left} minutter igjen av økta` : `Økta varer ${total} minutter` }),
      h('div', { class: 'actions' },
        button(`Start ${p.startMin} min`, () => app.startFocus({ thingId: th.id, stepId: p.step.id, title: p.step.title, minutes: p.startMin }), { kind: 'primary', icon: 'play', id: 'start-now' }),
        button('Bare 5 min', () => app.startFocus({ thingId: th.id, stepId: p.step.id, title: p.step.title, minutes: 5 }), { kind: 'text' }),
        button('Ikke nå', () => { const r = actions.skipSession(th.id, p.step.id); undoToast(r?.text || 'Flyttet.', r?.logId); }, { kind: 'text' }),
        button('Planen', () => openPlan(th.id), { kind: 'ghost' })));
  }
  return h('section', { class: 'now', 'aria-label': 'Nå' },
    h('div', { class: 'now-main' },
      h('p', { class: 'eyebrow' }, 'Nå'),
      p.context ? h('span', { class: 'now-ctx' }, p.context) : null,
      h('h2', { class: 'now-title' }, p.title),
      h('p', { class: 'now-why' }, p.why)),
    ring({ value: ringValue(n.gapMin), unit: ringUnit(n.gapMin), frac: Math.min(1, n.gapMin / 120), soon: n.gapMin < 15, label: `${n.gapMin} minutter ledig før neste avtale` }),
    !isDraft ? h('p', { class: 'now-step', style: { gridColumn: '1 / -1' } }, h('b', null, 'Første lille steg: '), step || firstSmallStep(th)) : h('p', { class: 'now-step draft-text', style: { gridColumn: '1 / -1' } }, `«${snippet(th.draft.body)}»`),
    h('div', { class: 'actions' },
      isDraft
        ? button('Se utkastet', () => openDraft(th.id), { kind: 'primary', icon: th.draft.channel === 'epost' ? 'mail' : 'message' })
        : button(`Start ${p.startMin} min`, () => app.startFocus({ thingId: th.id, stepId: p.step?.id || null, title: p.title, minutes: p.startMin }), { kind: 'primary', icon: 'play', id: 'start-now' }),
      !isDraft && p.startMin > 5 ? button('Bare 5 min', () => app.startFocus({ thingId: th.id, stepId: p.step?.id || null, title: p.title, minutes: 5 }), { kind: 'text' }) : null,
      button('Ikke nå', () => { const l = actions.notNow(th.id); undoToast(nowState(store.ds()).pick ? 'Greit. Her er neste.' : 'Greit. Ingenting annet haster nå.', l); }, { kind: 'text' }),
      !isDraft ? button('Står fast?', () => openStuck(th.id), { kind: 'ghost' }) : null),
    th.suggestSmaller ? h('p', { class: 'small muted', style: { gridColumn: '1 / -1' } }, 'Denne har ventet en stund. ', h('button', { type: 'button', class: 'btn btn-text btn-small', onClick: () => { const l = actions.makeSmaller(th.id); undoToast('Gjort mindre.', l); } }, 'Gjør den mindre')) : null);
}

/** Det Jarvis har planlagt, og som du ikke trenger å tenke på i dag. */
function waitSection(ds, t) {
  const list = canWait(ds.things, t);
  if (!list.length) return null;
  return h('section', { class: 'section', 'aria-label': 'Kan vente' },
    h('div', { class: 'section-head' }, h('h2', { class: 'h3' }, 'Kan vente'), h('span', { class: 'small muted' }, 'Planen tar seg av dem')),
    h('div', { class: 'list' }, list.slice(0, 4).map((x) => waitingRow(x))));
}

function draftsSection(ds) {
  const list = pendingDrafts(ds).filter((t) => t.draft.status === 'utkast');
  if (!list.length) return null;
  return h('section', { class: 'section', 'aria-label': 'Venter på et ja' },
    h('div', { class: 'section-head' }, h('h2', { class: 'h3' }, 'Venter på et ja'), h('span', { class: 'tag' }, `${list.length} ${list.length === 1 ? 'utkast' : 'utkast'}`)),
    h('div', { class: 'list' }, list.map((th) => h('button', { type: 'button', class: 'row', onClick: () => openDraft(th.id) },
      h('span', { style: { paddingTop: '2px', color: 'var(--accent)' } }, icon(th.draft.channel === 'epost' ? 'mail' : 'message', { size: 20 })),
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, th.title), h('span', { class: 'small muted', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, snippet(th.draft.body))),
      icon('chevron', { size: 18 })))),
    h('p', { class: 'small muted', style: { paddingInline: '4px' } }, 'Jarvis sender aldri selv. Du leser over og trykker send.'));
}

function todaySection(ds, t, n) {
  const events = eventsOf(ds);
  const gap = n.mode === 'ledig' || n.mode === 'tomt' ? { start: t, end: n.gapEnd } : null;
  const rest = events.filter((e) => !e.allDay && e.start > t && startOfDay(e.start) === startOfDay(t));
  return h('section', { class: 'section', 'aria-label': 'Resten av dagen' },
    h('div', { class: 'section-head' }, h('h2', { class: 'h3' }, 'Resten av dagen'), button('Dag', () => app.go('dag'), { kind: 'text', small: true })),
    h('div', { class: 'card', style: { gap: '10px' } },
      strip(events, t, { gap, onClick: () => app.go('dag') }),
      rest.length ? h('p', { class: 'small muted' }, rest.slice(0, 3).map((e) => `${hhmm(e.start)} ${e.planned && !e.deliver ? 'Økt: ' : ''}${e.title}`).join(' · ')) : h('p', { class: 'small muted' }, 'Ingen flere avtaler i dag.')));
}

export function render() {
  const ds = store.ds();
  const t = nowFn();
  const n = nowState(ds, t);
  return h('div', { class: 'screen' },
    topBar(t, { title: 'Nå' }),
    hello(t, n, ds),
    activeCard(ds, t),
    comebackCard(ds, t) || briefCard(ds, t) || wrapCard(ds, t),
    nowCard(ds, t, n),
    surfaceSection(ds, t, n),
    draftsSection(ds),
    waitSection(ds, t),
    todaySection(ds, t, n));
}

