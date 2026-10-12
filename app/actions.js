// Handlinger. Alt som endrer data går hit, og hver endring logges med hvem, hva og hvordan den angres.
import { store } from './store.js';
import { clock } from './clock.js';
import { uid } from './ui/h.js';
import { MIN, DAY, startOfDay, addDays, atTime, hhmm, fmtDate } from '../core/time.js';
import { findConflicts } from '../core/planner.js';
import { retLabel, briefAt, savedLine, PLACES } from '../core/sort.js';
import { comebackPlan } from '../core/brief.js';
import { makeSmaller as smaller } from '../core/smaller.js';
import { JOBS } from '../core/jobs.js';
import { planWork, replanThing, worthPlanning, bestTime } from '../core/planwork.js';
import { AGENT_NAME } from '../core/agents.js';
import { eventsOf, calendarOf, planPrefs } from './model.js';

const now = () => clock.now();
const AGENTS_WHY = {
  post: 'Postagenten leser Gmail og legger forslag i køen. Den sender aldri uten ja.',
  kalender: 'Kalenderagenten leser Google Kalender og skriver bare med ditt ja.',
  paminner: 'Påminneren sier fra morgen og kveld.',
  planlegger: 'Planleggeren legger frister i ledig tid.',
};
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const find = (ds, id) => ds.things.find((t) => t.id === id);

function record(ds, { by = 'du', text, why = '', undo = [] }) {
  const e = { id: uid('l'), at: now(), by, text, why, undo, undone: false };
  ds.log.unshift(e);
  if (ds.log.length > 250) ds.log.length = 250;
  if (by === 'du' || by === 'claude') ds.lastActiveAt = now();
  return e;
}

function applyUndo(ds, op) {
  const coll = ds[op.coll || 'things'];
  if (op.op === 'remove') ds[op.coll || 'things'] = coll.filter((x) => x.id !== op.id);
  else if (op.op === 'restore') { if (!coll.some((x) => x.id === op.item.id)) coll.push(clone(op.item)); }
  else if (op.op === 'patch') {
    const it = coll.find((x) => x.id === op.id);
    if (it) for (const [k, v] of Object.entries(op.before)) { if (v === undefined) delete it[k]; else it[k] = clone(v); }
  } else if (op.op === 'key') ds[op.key] = clone(op.value);
  else if (op.op === 'unperson') ds.people = ds.people.filter((p) => p.name !== op.name);
}

/** Endrer felter og husker hvordan det var. */
function patch(ds, th, p, undo) {
  const before = {};
  for (const k of Object.keys(p)) before[k] = clone(th[k]);
  undo.push({ op: 'patch', id: th.id, before });
  Object.assign(th, clone(p));
}

/** Lager en plan for en frist i ledig tid. Endrer ingenting selv. */
function makePlan(ds, th, { answers = {}, prefer, weekend, custom = null } = {}) {
  const prefs = planPrefs();
  const events = eventsOf(ds).filter((e) => e.thingId !== th.id);
  const keep = (th.steps || []).filter((s) => s.done);
  const p = planWork({ title: th.title, due: th.due, dueHasTime: !!th.dueHasTime, now: now(), events, answers, prefer: prefer === undefined ? prefs.prefer : prefer, weekend: weekend === undefined ? prefs.weekend : weekend, keep, custom });
  const plan = { at: now(), answers, prefer: prefer === undefined ? prefs.prefer : prefer, weekend: weekend === undefined ? prefs.weekend : weekend, buffer: p.buffer, fits: p.fits, tight: p.tight, summary: p.summary, warnings: p.warnings, custom: !!custom?.length };
  return { p, plan };
}

/** Økter som kolliderer med en avtale (eller glapp), flyttes til ny ledig tid. Returnerer tekster. */
function fixConflicts(ds, undo, opts = {}) {
  const notes = [];
  for (const th of ds.things) {
    if (th.status !== 'aktiv' || th.kind !== 'frist' || !th.due || !th.steps?.some((s) => s.at && !s.done)) continue;
    const r = replanThing(th, now(), eventsOf(ds), opts);
    if (r.changed) patch(ds, th, { steps: r.steps }, undo);
    if (r.moved) notes.push(`Flyttet ${r.moved} ${r.moved === 1 ? 'økt' : 'økter'} i «${th.title}» til ny ledig tid${r.fits ? '' : ', men det ble trangt'}.${r.stale ? ' Oppdater Google Kalender fra planen.' : ''}`);
  }
  return notes;
}

function ensurePerson(ds, name, undo) {
  if (!name || /^(foreleser|foreleseren|læreren|veileder|veilederen|sjefen|gruppa|gruppen|klassen)$/i.test(name)) return;
  if (ds.people.some((p) => p.name.toLocaleLowerCase('nb') === name.toLocaleLowerCase('nb'))) return;
  undo.push({ op: 'unperson', name });
  ds.people.push({ name, phone: '', email: '' });
}

export const actions = {
  /** UI kobler seg på her (åpne fokus, vise kort). */
  effects: { onSessionEnd: () => {} },

  undo(logId) {
    return store.update((ds) => {
      const e = ds.log.find((x) => x.id === logId);
      if (!e || e.undone || !e.undo?.length) return false;
      for (const op of [...e.undo].reverse()) applyUndo(ds, op);
      e.undone = true;
      return true;
    });
  },

  // ---------------- Fangst ----------------

  /** Lagrer sorterte ting. Returnerer {things, logId, lines}. */
  addItems(items, { by = 'du', source = '' } = {}) {
    return store.update((ds) => {
      const undo = [];
      const things = [];
      const lines = [];
      const plans = [];
      const events = calendarOf(ds);
      for (const it of items) {
        const th = {
          id: uid('t'), status: 'aktiv', createdAt: now(), snoozes: 0,
          kind: it.kind, title: it.title, text: it.text || source || it.title,
          ret: it.ret || { type: 'ledig' }, why: it.why || '',
        };
        for (const k of ['due', 'dueHasTime', 'start', 'end', 'allDay', 'person', 'place', 'travelMin', 'estimateMin', 'workType', 'steps', 'template', 'draft', 'important']) {
          if (it[k] !== undefined && it[k] !== null) th[k] = clone(it[k]);
        }
        let line = savedLine(th, now());
        // Store frister planlegges med en gang: økter i ledig tid, bakover fra fristen.
        if (worthPlanning(th) && th.due > now()) {
          if (th.kind === 'oppgave') { th.kind = 'frist'; th.important = true; th.ret = { type: 'ledig' }; }
          const { p, plan } = makePlan(ds, th);
          th.steps = p.steps;
          th.template = p.template;
          th.plan = plan;
          th.why = p.summary;
          line = `Planla «${th.title}». ${p.summary}${p.lines.notLines[0] ? ` ${p.lines.notLines[0]}` : ''}`;
          plans.push({ id: th.id, plan: p });
        } else if (th.kind === 'oppgave' && th.ret?.type === 'ledig') {
          const bt = bestTime(th.estimateMin || 30, { now: now(), events: eventsOf(ds) });
          if (bt) { th.bestAt = bt.at; line += ` Passer ${bt.text}.`; }
        }
        if (th.kind === 'avtale' && !th.allDay) {
          const c = findConflicts({ start: th.start, end: th.end }, { events: events.filter((e) => !e.allDay).map((e) => ({ ...e, status: 'aktiv' })) });
          if (c.length) { th.conflict = c.map((x) => x.title).join(', '); line += ` Obs: samtidig med ${th.conflict}.`; }
        }
        ds.things.push(th);
        undo.push({ op: 'remove', id: th.id });
        ensurePerson(ds, th.person, undo);
        things.push(th);
        lines.push(line);
      }
      if (things.some((t) => t.kind === 'avtale')) {
        const notes = fixConflicts(ds, undo);
        if (notes.length && lines.length) lines[lines.length - 1] += ` ${notes.join(' ')}`;
      }
      const text = things.length === 1 ? `Fanget «${things[0].title}». ${things[0].plan ? things[0].plan.summary : retLine(things[0])}` : `Fanget ${things.length} ting: ${things.map((t) => `«${t.title}»`).join(', ')}.`;
      const e = record(ds, { by, text, why: by === 'claude' ? 'Sortert av Claude, kontrollert av appen.' : plans.length ? 'Sortert av appen. Planleggeren la øktene i ledig tid, bakover fra fristen.' : 'Sortert av appen.', undo });
      return { things, logId: e.id, lines, plans };
    });
  },

  // ---------------- Ting ----------------

  setRet(id, ret, { by = 'du', quiet = false } = {}) {
    return store.update((ds) => {
      const th = find(ds, id);
      if (!th) return null;
      const undo = [];
      patch(ds, th, { ret, snoozeUntil: null }, undo);
      if (th.status === 'arkiv' && ret.type !== 'arkiv') patch(ds, th, { status: 'aktiv' }, undo);
      if (ret.type === 'arkiv') patch(ds, th, { status: 'arkiv' }, undo);
      const e = record(ds, { by, text: `«${th.title}» kommer ${retLabel(ret, now())}.`, undo });
      return quiet ? null : e.id;
    });
  },

  /** Samme tilbakekomst for flere ting, som én handling (ett «Angre»). */
  setRetMany(ids, ret, text) {
    return store.update((ds) => {
      const undo = [];
      for (const id of ids) { const th = find(ds, id); if (th) patch(ds, th, { ret, snoozeUntil: null }, undo); }
      return record(ds, { text: text || `${ids.length} ting kommer ${retLabel(ret, now())}.`, undo }).id;
    });
  },

  /** «Senere»: ny tilbakekomst, og vi teller at den ble utsatt (uten å si noe om det). */
  later(id, ret) {
    return store.update((ds) => {
      const th = find(ds, id);
      if (!th) return null;
      const undo = [];
      patch(ds, th, { ret, snoozes: (th.snoozes || 0) + 1, snoozeUntil: null }, undo);
      return record(ds, { text: `«${th.title}» kommer ${retLabel(ret, now())}.`, undo }).id;
    });
  },

  /** «Ikke nå» på Nå-kortet: neste kandidat i dag, uten å flytte noe. */
  notNow(id) {
    return store.update((ds) => {
      const day = startOfDay(now());
      const undo = [{ op: 'key', key: 'skip', value: clone(ds.skip) }];
      ds.skip = ds.skip?.day === day ? { day, ids: [...ds.skip.ids, id] } : { day, ids: [id] };
      const th = find(ds, id);
      if (th) patch(ds, th, { snoozes: (th.snoozes || 0) + 1 }, undo);
      return record(ds, { text: `Hoppet over «${th?.title}» for nå. Den er ikke borte.`, undo }).id;
    });
  },

  done(id, { by = 'du' } = {}) {
    return store.update((ds) => {
      const th = find(ds, id);
      if (!th) return null;
      const undo = [];
      patch(ds, th, { status: 'ferdig', doneAt: now() }, undo);
      if (th.draft && th.draft.status !== 'sendt') patch(ds, th, { draft: { ...th.draft, status: 'sendt', sentAt: now() } }, undo);
      return record(ds, { by, text: `Ferdig: «${th.title}».`, undo }).id;
    });
  },

  reopen(id) {
    return store.update((ds) => {
      const th = find(ds, id);
      if (!th) return null;
      const undo = [];
      patch(ds, th, { status: 'aktiv', doneAt: null }, undo);
      return record(ds, { text: `Åpnet «${th.title}» igjen.`, undo }).id;
    });
  },

  stepDone(id, stepId, value = true) {
    return store.update((ds) => {
      const th = find(ds, id);
      if (!th?.steps) return null;
      const undo = [];
      const steps = th.steps.map((s) => (s.id === stepId ? { ...s, done: value, doneAt: value ? now() : null } : s));
      patch(ds, th, { steps }, undo);
      const s = th.steps.find((x) => x.id === stepId);
      const all = steps.every((x) => x.done);
      return record(ds, { text: value ? `Steg gjort: «${s?.title}»${all ? `. Alle steg i «${th.title}» er gjort` : ''}.` : `Åpnet steget «${s?.title}» igjen.`, undo }).id;
    });
  },

  edit(id, p, text = null) {
    return store.update((ds) => {
      const th = find(ds, id);
      if (!th) return null;
      const undo = [];
      patch(ds, th, p, undo);
      return record(ds, { text: text || `Endret «${th.title}».`, undo }).id;
    });
  },

  archive(id) {
    return this.setRet(id, { type: 'arkiv' });
  },

  remove(id) {
    return store.update((ds) => {
      const th = find(ds, id);
      if (!th) return null;
      ds.things = ds.things.filter((t) => t.id !== id);
      return record(ds, { text: `Slettet «${th.title}».`, undo: [{ op: 'restore', item: clone(th) }] }).id;
    });
  },

  makeSmaller(id, stepId = null) {
    return store.update((ds) => {
      const th = find(ds, id);
      if (!th) return null;
      const r = smaller(th, stepId, () => uid('s'));
      if (!r) return null;
      const undo = [];
      patch(ds, th, r.patch, undo);
      return record(ds, { by: 'assistent', text: r.text, why: 'Mindre steg er lettere å starte på.', undo }).id;
    });
  },

  // ---------------- Planleggeren ----------------

  /** Forhåndsvisning av en plan med andre svar. Lagrer ingenting. */
  previewPlan(id, opts = {}) {
    const ds = store.ds();
    const th = find(ds, id);
    if (!th?.due) return null;
    return makePlan(ds, th, opts).p;
  },

  /** Ny plan for en frist (etter kjappe spørsmål, eller skreddersydde steg). */
  applyPlan(id, opts = {}) {
    return store.update((ds) => {
      const th = find(ds, id);
      if (!th?.due) return null;
      const undo = [];
      const { p, plan } = makePlan(ds, th, opts);
      patch(ds, th, { steps: p.steps, template: p.template, plan: { ...plan, auto: false, tuned: true }, why: p.summary }, undo);
      const e = record(ds, { by: 'planlegger', text: `Ny plan for «${th.title}»: ${p.summary}`, why: 'Du svarte på spørsmålene, og planen ble lagt på nytt i ledig tid.', undo });
      return { logId: e.id, plan: p };
    });
  },

  /** «Ikke nå» på en økt: den flyttes til neste ledige tid, minst en time fram. */
  skipSession(id, stepId) {
    return store.update((ds) => {
      const th = find(ds, id);
      if (!th?.steps) return null;
      const undo = [];
      const step = th.steps.find((x) => x.id === stepId);
      if (step?.kick) {
        patch(ds, th, { steps: th.steps.filter((x) => x.id !== stepId) }, undo);
        return { text: 'Greit, vi dropper kikken. Øktene står som før.', logId: record(ds, { by: 'planlegger', text: `Droppet kikken på «${th.title}».`, why: 'Du sa ikke nå.', undo }).id };
      }
      const r = replanThing(th, now(), eventsOf(ds), { force: [stepId], from: now() + 60 * MIN });
      patch(ds, th, { steps: r.steps, snoozes: (th.snoozes || 0) + 1 }, undo);
      const s = r.steps.find((x) => x.id === stepId);
      const text = s?.at ? `Økta er flyttet til ${fmtDate(s.at)} kl. ${hhmm(s.at)}.` : 'Fant ingen ny tid før fristen. Den står uten tid; se planen.';
      return { text, logId: record(ds, { by: 'planlegger', text: `«${s?.title || 'Økta'}»: ${text}`, why: 'Du sa ikke nå.', undo }).id };
    });
  },

  /** Gir en oppgave en frist, og planlegger den. */
  setDue(id, due, dueHasTime = false) {
    return store.update((ds) => {
      const th = find(ds, id);
      if (!th) return null;
      const undo = [];
      patch(ds, th, { kind: 'frist', due, dueHasTime, ret: { type: 'ledig' }, important: true }, undo);
      let plan = null;
      if (worthPlanning(th) || th.kind === 'frist') {
        const r = makePlan(ds, th);
        patch(ds, th, { steps: r.p.steps, template: r.p.template, plan: r.plan, why: r.p.summary }, undo);
        plan = r.p;
      }
      const e = record(ds, { by: 'planlegger', text: `«${th.title}» har frist ${fmtDate(due - 1)}.${plan ? ` ${plan.summary}` : ''}`, undo });
      return { logId: e.id, plan };
    });
  },

  /** Ikke spør om planen for denne igjen. */
  planSeen(id, value = 'ok') {
    store.update((ds) => { const th = find(ds, id); if (th?.plan) th.plan = { ...th.plan, asked: value }; }, { render: false });
  },

  // ---------------- Utkast ----------------

  draftEdit(id, p) {
    store.update((ds) => {
      const th = find(ds, id);
      if (th?.draft) th.draft = { ...th.draft, ...p };
    }, { render: false });
  },

  draftOpened(id) {
    return store.update((ds) => {
      const th = find(ds, id);
      if (!th?.draft) return null;
      const undo = [];
      patch(ds, th, { draft: { ...th.draft, status: 'apnet', openedAt: now() } }, undo);
      return record(ds, { text: `Åpnet utkastet til ${th.draft.to} i ${th.draft.channel === 'epost' ? 'e-post' : 'Meldinger'}. Ikke sendt før du sier fra.`, undo }).id;
    });
  },

  draftSent(id) {
    return store.update((ds) => {
      const th = find(ds, id);
      if (!th?.draft) return null;
      const undo = [];
      patch(ds, th, { draft: { ...th.draft, status: 'sendt', sentAt: now() }, status: 'ferdig', doneAt: now() }, undo);
      return record(ds, { text: `Du sendte ${th.draft.channel === 'epost' ? 'e-posten' : 'meldingen'} til ${th.draft.to}.`, undo }).id;
    });
  },

  draftNotYet(id) {
    return store.update((ds) => {
      const th = find(ds, id);
      if (!th?.draft) return null;
      const undo = [];
      patch(ds, th, { draft: { ...th.draft, status: 'utkast', openedAt: null } }, undo);
      return record(ds, { text: `Utkastet til ${th.draft.to} venter fortsatt.`, undo }).id;
    });
  },

  // ---------------- Avtaler ----------------

  moveEvent(id, start) {
    return store.update((ds) => {
      const th = find(ds, id);
      const cal = ds.calendar.find((e) => e.id === id);
      const target = th || cal;
      if (!target) return null;
      const dur = target.end - target.start;
      const undo = [];
      const p = { start, end: start + dur, allDay: false };
      if (th) {
        if (th.ret?.type === 'tid') p.ret = { type: 'tid', at: start - ((th.travelMin || 0) + 15) * MIN };
        patch(ds, th, p, undo);
      } else {
        undo.push({ op: 'patch', coll: 'calendar', id, before: { start: cal.start, end: cal.end, allDay: cal.allDay } });
        Object.assign(cal, p);
      }
      const notes = fixConflicts(ds, undo);
      return record(ds, { text: `Flyttet «${target.title}» til ${fmtDate(start)} kl. ${hhmm(start)}.${notes.length ? ` ${notes.join(' ')}` : ''}`, undo }).id;
    });
  },

  cancelEvent(id) {
    return store.update((ds) => {
      const th = find(ds, id);
      const cal = ds.calendar.find((e) => e.id === id);
      const undo = [];
      if (th) patch(ds, th, { status: 'avlyst' }, undo);
      else if (cal) { undo.push({ op: 'patch', coll: 'calendar', id, before: { status: cal.status } }); cal.status = 'avlyst'; } else return null;
      return record(ds, { text: `Avlyste «${(th || cal).title}».`, undo }).id;
    });
  },

  importCalendar(events, label = 'kalenderfil') {
    return store.update((ds) => {
      const undo = [];
      const known = new Set(ds.calendar.map((e) => e.uid).filter(Boolean));
      let added = 0;
      for (const e of events) {
        if (e.uid && known.has(e.uid)) continue;
        const id = uid('ev');
        ds.calendar.push({ id, uid: e.uid || null, title: e.title, start: e.start, end: e.end, allDay: !!e.allDay, place: e.place || null, source: 'ics' });
        undo.push({ op: 'remove', coll: 'calendar', id });
        added++;
      }
      const notes = added ? fixConflicts(ds, undo) : [];
      return { added, notes, logId: record(ds, { text: `La inn ${added} avtaler fra ${label}.${notes.length ? ` ${notes.join(' ')}` : ''}`, undo }).id };
    });
  },

  // ---------------- Deg ----------------

  setPlace(key) {
    return store.update((ds) => {
      const undo = [{ op: 'key', key: 'place', value: clone(ds.place) }];
      ds.place = key ? { key, at: now() } : null;
      return record(ds, { text: key ? `Du er ${PLACES[key] || key}.` : 'Sted fjernet.', undo }).id;
    });
  },

  setEnergy(level) {
    return store.update((ds) => {
      const undo = [{ op: 'key', key: 'energy', value: clone(ds.energy) }];
      ds.energy = { day: startOfDay(now()), level };
      const word = { lav: 'lav', middels: 'middels', hoy: 'høy' }[level];
      return record(ds, { text: `Energi i dag: ${word}. Nå-kortet tar hensyn til det.`, undo }).id;
    });
  },

  markSeen(key, value = startOfDay(now())) {
    store.update((ds) => { ds.seen = { ...ds.seen, [key]: value }; }, { render: false });
  },

  /** «Har dårlig tid?»: alt som ikke haster i dag, kommer tilbake i morgenbriefen. */
  triage() {
    return store.update((ds) => {
      const t = now();
      const tomorrow = briefAt(addDays(startOfDay(t), 1), store.settings);
      const undo = [];
      let moved = 0;
      for (const th of ds.things) {
        if (th.status !== 'aktiv' || th.kind === 'avtale' || th.kind === 'ide' || th.kind === 'notat') continue;
        const urgent = (th.due && th.due - t < DAY) || th.important;
        // Bare det som ikke har et tidspunkt du har valgt selv. Påminnelser med klokkeslett står.
        const flexible = th.ret?.type === 'ledig' && !th.draft;
        if (!urgent && flexible && th.kind !== 'frist') { patch(ds, th, { ret: { type: 'tid', at: tomorrow } }, undo); moved++; }
        if (th.kind === 'frist' && th.steps && !(th.due - t < 2 * DAY)) {
          if (th.steps.some((s) => s.at)) {
            const today = th.steps.filter((s) => !s.done && !s.deliver && s.at && s.at < addDays(startOfDay(t), 1)).map((s) => s.id);
            if (today.length) {
              const r = replanThing(th, t, eventsOf(ds), { force: today, from: atTime(addDays(startOfDay(t), 1), '08:00') });
              if (r.changed) { patch(ds, th, { steps: r.steps }, undo); moved++; }
            }
          } else {
            const steps = th.steps.map((s) => (!s.done && s.day <= startOfDay(t) ? { ...s, day: addDays(startOfDay(t), 1) } : s));
            if (JSON.stringify(steps) !== JSON.stringify(th.steps)) { patch(ds, th, { steps }, undo); moved++; }
          }
        }
      }
      const e = record(ds, { by: 'assistent', text: moved ? `Ryddet dagen: ${moved} ${moved === 1 ? 'ting' : 'ting'} kommer tilbake i morgen tidlig. Det som haster, står igjen.` : 'Ingenting å flytte. Det som står igjen, haster.', why: 'Du sa at du har dårlig tid.', undo });
      return { moved, logId: e.id };
    });
  },

  // ---------------- Agentene ----------------

  /** Et forslag fra en agent havner i godkjenningskøen. Ingenting skjer før du sier ja. */
  propose(p, { by }) {
    return store.update((ds) => {
      ds.inbox = ds.inbox || [];
      const dup = ds.inbox.find((x) => x.key && x.key === p.key && (x.status === 'venter' || now() - (x.doneAt || x.at) < 14 * DAY));
      if (dup) return dup.id;
      const item = { id: uid('f'), at: now(), status: 'venter', agent: by, ...clone(p) };
      ds.inbox.unshift(item);
      if (ds.inbox.length > 60) ds.inbox.length = 60;
      record(ds, { by, text: `${AGENT_NAME[by] || 'Jarvis'} foreslår: ${p.title}`, why: 'Venter på ja fra deg.', undo: [{ op: 'remove', coll: 'inbox', id: item.id }] });
      return item.id;
    });
  },

  /** Godkjent, avvist eller feilet. */
  resolveProposal(id, status, note = '') {
    return store.update((ds) => {
      const it = (ds.inbox || []).find((x) => x.id === id);
      if (!it) return null;
      const undo = [{ op: 'patch', coll: 'inbox', id, before: { status: it.status, doneAt: it.doneAt, note: it.note } }];
      Object.assign(it, { status, doneAt: now(), note });
      const verb = { godkjent: 'Du sa ja', avvist: 'Du sa nei', feilet: 'Det gikk ikke' }[status] || status;
      return record(ds, { by: it.agent, text: `${verb}: ${it.title}${note ? `. ${note}` : '.'}`, undo }).id;
    });
  },

  /** Du endrer teksten i et forslag før du sier ja. */
  editProposal(id, p) {
    store.update((ds) => {
      const it = (ds.inbox || []).find((x) => x.id === id);
      if (it) it.payload = { ...it.payload, ...p };
    }, { render: false });
  },

  /** En agent har kjørt. */
  agentRan(agentId, text, extra = {}) {
    return store.update((ds) => {
      ds.agents = { ...(ds.agents || {}), [agentId]: { ...(ds.agents?.[agentId] || {}), lastRun: now(), lastText: text || null, ...extra } };
      return text ? record(ds, { by: agentId, text, why: AGENTS_WHY[agentId] || '' }).id : null;
    }, { render: true });
  },

  /** Avtaler fra Google Kalender for et tidsrom erstatter forrige henting for samme tidsrom. */
  importGoogle(events, from, to) {
    return store.update((ds) => {
      const undo = [{ op: 'key', key: 'calendar', value: clone(ds.calendar) }];
      const keep = ds.calendar.filter((e) => !(e.source === 'gcal' && e.start < to && e.end > from) && !(e.source === 'gcal' && e.end < from - 2 * DAY));
      const old = new Map(ds.calendar.filter((e) => e.source === 'gcal').map((e) => [e.uid, e]));
      const fresh = events.map((e) => ({ id: old.get(e.uid)?.id || uid('ev'), uid: e.uid, title: e.title, start: e.start, end: e.end, allDay: !!e.allDay, place: e.place || null, source: 'gcal', status: old.get(e.uid)?.status === 'avlyst' ? 'avlyst' : undefined, travelMin: old.get(e.uid)?.travelMin || null }));
      const before = JSON.stringify(ds.calendar.filter((e) => e.source === 'gcal' && e.start < to && e.end > from).map((e) => [e.uid, e.start, e.end, e.title]).sort());
      const after = JSON.stringify(fresh.map((e) => [e.uid, e.start, e.end, e.title]).sort());
      if (before === after) return { changed: false, count: fresh.length, notes: [] };
      ds.calendar = [...keep, ...fresh];
      const notes = fixConflicts(ds, undo);
      const e = record(ds, { by: 'kalender', text: `Hentet ${fresh.length} ${fresh.length === 1 ? 'avtale' : 'avtaler'} fra Google Kalender.${notes.length ? ` ${notes.join(' ')}` : ''}`, why: 'Kalenderagenten leser kalenderen din, så planen tar hensyn til den.', undo });
      return { changed: true, count: fresh.length, notes, logId: e.id };
    });
  },

  /** Merker økter som lagt i Google Kalender (med id, så de kan oppdateres når de flyttes). */
  markGcal(thingId, done) {
    store.update((ds) => {
      const th = find(ds, thingId);
      const byId = new Map(done.map((x) => (typeof x === 'string' ? [x, null] : [x.id, x.gcalId])));
      if (th?.steps) th.steps = th.steps.map((s) => (byId.has(s.id) ? { ...s, gcal: true, gcalStale: false, gcalId: byId.get(s.id) || s.gcalId || null } : s));
      // Forslag om å oppdatere denne fristen er nå gjort.
      const left = th?.steps?.some((s) => s.at && !s.done && (!s.gcal || s.gcalStale) && s.at > now());
      for (const it of ds.inbox || []) if (it.kind === 'kalender' && it.status === 'venter' && it.payload?.thingId === thingId && !left) Object.assign(it, { status: 'godkjent', doneAt: now(), note: 'Gjort.' });
    });
  },

  // ---------------- Fokus ----------------

  startSession(thingId, minutes, { stepId = null, title = '', pause = false } = {}) {
    if (store.ds().active) this.finishSession({ done: false });
    return store.update((ds) => {
      const t = now();
      ds.active = { id: uid('s'), thingId, stepId, title, pause, start: t, end: t + minutes * MIN, plannedMin: minutes, pausedAt: null, pausedTotal: 0 };
      ds.lastActiveAt = t;
      return ds.active;
    });
  },

  pauseSession() {
    store.update((ds) => { if (ds.active && !ds.active.pausedAt) ds.active.pausedAt = now(); });
  },

  resumeSession() {
    store.update((ds) => {
      const a = ds.active;
      if (!a?.pausedAt) return;
      const d = now() - a.pausedAt;
      a.end += d;
      a.pausedTotal += d;
      a.pausedAt = null;
    });
  },

  extendSession(min = 5) {
    store.update((ds) => { if (ds.active) ds.active.end = Math.max(ds.active.end, now()) + min * MIN; });
  },

  /** Avslutter økta. done = ting/steg ferdig. */
  finishSession({ done = false } = {}) {
    return store.update((ds) => {
      const a = ds.active;
      if (!a) return null;
      const t = now();
      const actualMin = Math.max(1, Math.round((Math.min(t, a.pausedAt || t) - a.start - a.pausedTotal) / MIN));
      ds.active = null;
      if (a.pause) return { actualMin, logId: null, done: false };
      ds.sessions.unshift({ id: a.id, title: a.title, thingId: a.thingId, stepId: a.stepId, start: a.start, plannedMin: a.plannedMin, actualMin });
      if (ds.sessions.length > 400) ds.sessions.length = 400;
      const undo = [];
      const th = find(ds, a.thingId);
      if (done && th) {
        if (a.stepId && th.steps) patch(ds, th, { steps: th.steps.map((s) => (s.id === a.stepId ? { ...s, done: true, doneAt: t } : s)) }, undo);
        else patch(ds, th, { status: 'ferdig', doneAt: t }, undo);
      }
      const e = record(ds, { text: `Økt på ${actualMin} min med «${a.title}»${done ? ', ferdig' : ''}.`, undo });
      return { actualMin, logId: e.id, done };
    });
  },

  /** Tanker fanget i en økt som aldri ble avsluttet, får sin vanlige tilbakekomst. */
  releaseHeld() {
    const ds = store.ds();
    if (ds.active || !ds.things.some((t) => t.ret?.type === 'etter')) return;
    store.update((d) => {
      for (const t of d.things) if (t.ret?.type === 'etter') { t.ret = t.heldRet || { type: 'ledig' }; t.heldRet = null; }
    }, { render: false });
  },

  // ---------------- Jobber og comeback ----------------

  applyJobs(results) {
    if (!results.length) return [];
    return store.update((ds) => {
      const out = [];
      for (const r of results) {
        const undo = [];
        for (const op of r.ops || []) {
          const th = find(ds, op.id);
          if (th) patch(ds, th, op.patch, undo);
        }
        ds.jobs = { ...ds.jobs, [r.id]: { lastRun: now(), lastText: r.text || ds.jobs?.[r.id]?.lastText || null } };
        if (r.text) out.push(record(ds, { by: r.id, text: r.text, why: JOBS.find((j) => j.id === r.id)?.does || '', undo }));
      }
      return out;
    }, { render: true });
  },

  comeback() {
    return store.update((ds) => {
      const t = now();
      const plan = comebackPlan({ now: t, things: ds.things, settings: store.settings, events: eventsOf(ds) });
      const undo = [{ op: 'key', key: 'comebacks', value: clone(ds.comebacks) }];
      for (const op of plan.ops) {
        const th = find(ds, op.id);
        if (th) patch(ds, th, op.patch, undo);
      }
      ds.comebacks = [...(ds.comebacks || []), { at: t }];
      ds.seen = { ...ds.seen, comeback: t, comebackText: plan.text };
      const e = record(ds, { by: 'rydding', text: `Velkommen tilbake. ${plan.text}`, why: 'Du hadde vært borte en stund.', undo });
      ds.lastActiveAt = t;
      return { ...plan, logId: e.id };
    });
  },

  // ---------------- Samtale ----------------

  chat(role, text, cards = null) {
    store.update((ds) => {
      ds.chat.push({ role, text, at: now(), cards });
      if (ds.chat.length > 60) ds.chat.splice(0, ds.chat.length - 60);
    }, { render: false });
  },

  /** Brukeren så den allerede på Nå-skjermen: ikke dytt senere, og ikke bruk av budsjettet. */
  markNudged(key) {
    const ds = store.ds();
    const day = startOfDay(now());
    const n = ds.nudges?.day === day ? ds.nudges : { day, count: 0, seen: [] };
    if (n.seen.includes(key)) return;
    store.update((d) => { d.nudges = { ...n, seen: [...n.seen, key] }; }, { render: false });
  },

  /** Teller dytt mot stillhetsbudsjettet. Returnerer false hvis budsjettet er brukt opp. */
  spendNudge(key) {
    const ds = store.ds();
    const day = startOfDay(now());
    const n = ds.nudges?.day === day ? ds.nudges : { day, count: 0, seen: [] };
    if (n.seen.includes(key)) return false;
    if (n.count >= store.settings.nudgeBudget) return false;
    store.update((d) => { d.nudges = { day, count: n.count + 1, seen: [...n.seen, key] }; }, { render: false });
    return true;
  },
};

function retLine(th) {
  if (th.kind === 'avtale') return th.allDay ? `Står i kalenderen ${fmtDate(th.start)}.` : `Står i kalenderen ${fmtDate(th.start)} kl. ${hhmm(th.start)}.`;
  if (th.draft) return 'Utkastet venter på at du trykker send.';
  return `Kommer tilbake ${retLabel(th.ret, now())}.`;
}

