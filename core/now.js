// Kjerne · «Nå»: hva er det ene, hva skal komme tilbake akkurat nå, og når må du gå.
// Koden bestemmer. Claude kan foreslå, men det er disse reglene som velger.
import { MIN, HOUR, DAY, startOfDay, addDays, atTime, hhmm, fmtDuration } from './time.js';
import { freeGaps } from './planner.js';
import { nextStep } from './steps.js';
import { PLACES } from './sort.js';

export const DAY_WINDOW = { start: '07:00', end: '23:00' };
/** Når morgenbriefen er (timer etter midnatt). Settes fra innstillingene. */
export const BRIEF = { hour: 7.5 };

const isTimed = (e) => !e.allDay && e.status !== 'avlyst';

/** Avtaler fra kalenderen og fra fangster, sortert. */
export function timedEvents(events = []) {
  return events.filter(isTimed).sort((a, b) => a.start - b.start);
}

/** Når du må gå for å rekke en avtale. null hvis reisetid ikke er kjent. */
export function leaveAt(event) {
  if (!event || !event.travelMin) return null;
  return event.start - event.travelMin * MIN;
}

/** Ledige luker resten av dagen, uten heldagsavtaler. */
export function gapsToday(now, events = [], window = DAY_WINDOW) {
  return freeGaps(startOfDay(now), { now, events: timedEvents(events).map((e) => ({ ...e, status: 'aktiv' })), dayStart: window.start, dayEnd: window.end, minMin: 10 });
}

/** En «i morgenbriefen»-ting som er laget før dagens brief, og briefen har vært. */
function pastBrief(th, now, briefHour = BRIEF.hour) {
  const d = new Date(now);
  const brief = startOfDay(now) + briefHour * HOUR;
  return d.getTime() >= brief && (th.createdAt || 0) < brief;
}

function snoozed(th, now) {
  return th.snoozeUntil && th.snoozeUntil > now;
}

/** Enheten du faktisk jobber med: dagens steg i en frist, eller selve tingen. */
export function workUnit(th, now) {
  if (th.kind === 'frist' && th.steps?.length) {
    const s = nextStep(th, now);
    if (!s) return null;
    return { thing: th, step: s, title: s.title, context: th.title, est: s.estimateMin || 30, stepDay: s.day, at: s.at || null, end: s.end || null };
  }
  const est = th.estimateMin || (th.kind === 'melding' || th.kind === 'epost' ? 5 : th.kind === 'handle' ? 15 : 30);
  return { thing: th, step: null, title: th.title, context: null, est, stepDay: null };
}

const CANDIDATE_KINDS = new Set(['oppgave', 'frist', 'melding', 'epost', 'handle']);

function eligible(th, { now, place, persons }) {
  if (th.status !== 'aktiv' || !CANDIDATE_KINDS.has(th.kind) || snoozed(th, now)) return false;
  const r = th.ret || { type: 'ledig' };
  const dueSoon = th.due && th.due - now < DAY;
  if (th.kind === 'frist') {
    const s = nextStep(th, now);
    if (!s) return !!dueSoon;
    // Planlagte økter kommer når økta er der (eller ti minutter før). Før det kan fristen vente.
    if (s.at) return s.at - 10 * MIN <= now || (!!dueSoon && !s.deliver);
    return s.day <= startOfDay(now);
  }
  if (th.kind === 'handle') return (r.type === 'sted' && r.place === place) || !!dueSoon;
  if (dueSoon) return true;
  switch (r.type) {
    case 'ledig': return true;
    case 'morgen': return pastBrief(th, now);
    case 'tid': return r.at <= now;
    case 'sted': return r.place === place;
    case 'person': return persons.has(r.person);
    default: return false;
  }
}

/** Poeng med grunner i klartekst. */
export function score(unit, { now, gapMin, energy }) {
  const th = unit.thing;
  const reasons = [];
  let s = 0;
  if (th.due) {
    const h = (th.due - now) / HOUR;
    if (h < 0) { s += 70; reasons.push('fristen har gått ut'); }
    else if (h < 24) { s += 60; reasons.push('fristen er innen et døgn'); }
    else if (h < 48) { s += 40; reasons.push('fristen er i morgen'); }
    else if (h < 24 * 7 && th.kind !== 'frist') { s += 15; reasons.push('fristen er denne uka'); }
  }
  if (unit.step?.deliver) { s += 65; reasons.push(`fristen for «${th.title}» er nå, så det gjenstår å levere`); }
  else if (unit.step?.at) {
    if (unit.step.end < now) { s += 50; reasons.push(`økta ${hhmm(unit.step.at)} glapp, men du kan ta den nå`); }
    else { s += 60; reasons.push(`du satte av ${hhmm(unit.step.at)}–${hhmm(unit.step.end)} til dette i «${th.title}»`); }
  } else if (unit.step) {
    if (unit.stepDay < startOfDay(now)) { s += 50; reasons.push(`steget skulle vært gjort, og «${th.title}» har frist`); }
    else { s += 45; reasons.push(`dagens steg i «${th.title}»`); }
  }
  if (th.ret?.type === 'tid' && th.ret.at <= now) { s += 30; reasons.push(`du ba om å få den ${hhmm(th.ret.at)}`); }
  if (th.ret?.type === 'sted') { s += 35; reasons.push(`du er ${PLACES[th.ret.place] || th.ret.place}`); }
  if (th.ret?.type === 'person') { s += 35; reasons.push(`du har kontakt med ${th.ret.person} snart`); }
  if (th.important) { s += 12; if (!reasons.length) reasons.push('du merket den som viktig'); }
  if (gapMin != null) {
    if (unit.est <= gapMin) { s += 10; reasons.push(`den passer i luka på ${fmtDuration(gapMin)}`); }
    else s -= 15;
  }
  const heavy = unit.est >= 45 || ['lesing', 'skriving'].includes(th.workType);
  if (energy === 'lav' && heavy) s -= 15;
  if (energy === 'lav' && unit.est <= 15) { s += 8; reasons.push('den er lett nok for en dag med lite energi'); }
  if (energy === 'hoy' && heavy) { s += 8; reasons.push('du har energi til noe tungt'); }
  if (th.kind === 'melding' || th.kind === 'epost') { s += 8; reasons.push('utkastet er klart, det tar et par minutter'); }
  else if (unit.est <= 15) { s += 6; reasons.push('den er rask å bli ferdig med'); }
  s -= 6 * (th.snoozes || 0);
  if (!th.due && th.createdAt && now - th.createdAt > 7 * DAY) { s += 3; }
  return { unit, score: s, reasons };
}

function sentence(reasons) {
  const r = [...new Set(reasons)].slice(0, 2);
  if (!r.length) return 'Den står øverst akkurat nå.';
  const t = r.join(', og ');
  return `${t.charAt(0).toLocaleUpperCase('nb')}${t.slice(1)}.`;
}

/** Personer du har kontakt med snart: avtaler med dem innen to timer, eller pågående. */
const ROLE_EVENTS = [
  [/forelesning|seminar/i, ['foreleser', 'foreleseren', 'læreren']],
  [/veiled/i, ['veileder', 'veilederen']],
  [/gruppe/i, ['gruppa', 'gruppen']],
  [/jobb|vakt/i, ['sjefen']],
];

export function personsNear(events = [], now, extra = []) {
  const out = new Set(extra.filter(Boolean));
  for (const e of timedEvents(events)) {
    if (e.start - now >= 2 * HOUR || e.end <= now) continue;
    if (e.person) out.add(e.person);
    for (const [re, roles] of ROLE_EVENTS) if (re.test(e.title)) roles.forEach((r) => out.add(r));
  }
  return out;
}

/**
 * Den ene tingen nå.
 * Returnerer {mode: 'opptatt'|'ledig'|'tomt', event?, next, gapMin, gapEnd, pick?, alternatives}.
 */
export function pickNow({ now, things = [], events = [], energy = null, skip = [], place = null, persons = [], window = DAY_WINDOW }) {
  const timed = timedEvents(events);
  const current = timed.find((e) => !e.planned && e.start <= now && e.end > now) || null;
  const next = timed.find((e) => e.start > now && !(e.planned && e.deliver)) || null;
  const dayEnd = atTime(startOfDay(now), window.end);
  const nextStart = next && next.start < dayEnd ? next.start - ((next.travelMin || 0) + 5) * MIN : dayEnd;
  const gapMin = current ? 0 : Math.max(0, Math.round((nextStart - now) / MIN));
  const near = personsNear(events, now, persons);
  const units = things
    .filter((th) => !skip.includes(th.id) && eligible(th, { now, place, persons: near }))
    .map((th) => workUnit(th, now))
    .filter(Boolean);
  const ranked = units.map((u) => score(u, { now, gapMin: current ? null : gapMin, energy })).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const inSession = best?.unit.at && best.unit.at <= now + 10 * MIN && best.unit.end > now;
  const pick = best ? {
    ...best.unit,
    why: sentence(best.reasons),
    session: !!inSession,
    startMin: inSession
      ? Math.max(5, Math.round((best.unit.end - Math.max(now, best.unit.at)) / MIN))
      : Math.max(5, Math.min(25, best.unit.est, gapMin > 0 ? gapMin - 5 : 25)),
  } : null;
  return {
    mode: current ? 'opptatt' : pick ? 'ledig' : 'tomt',
    event: current,
    next,
    gapMin,
    gapEnd: current ? current.end : nextStart,
    pick,
    alternatives: ranked.slice(1, 4).map((r) => r.unit),
  };
}

/**
 * Det som skal komme tilbake akkurat nå. Returnerer [{thing, reason, type}].
 * tid: tidspunktet har passert. sted: du er der. person: du har kontakt med personen snart. sendt: et åpnet utkast som ikke er bekreftet.
 */
export function resurface({ now, things = [], events = [], place = null, persons = [], limit = 4 }) {
  const near = personsNear(events, now, persons);
  const out = [];
  for (const th of things) {
    if (th.status !== 'aktiv' || snoozed(th, now)) continue;
    const r = th.ret || {};
    if (th.draft?.status === 'apnet' && th.draft.openedAt && now - th.draft.openedAt > 20 * MIN) {
      out.push({ thing: th, type: 'sendt', reason: `Du åpnet utkastet til ${th.draft.to} kl. ${hhmm(th.draft.openedAt)}. Ble det sendt?`, at: th.draft.openedAt });
      continue;
    }
    if (th.kind === 'avtale') continue;
    if (th.kind === 'frist' && th.steps?.some((x) => x.at)) {
      const st = nextStep(th, now);
      if (st?.deliver && st.at <= now) { out.push({ thing: th, step: st, type: 'lever', reason: `${st.title}. Fristen er ${th.dueHasTime ? `kl. ${hhmm(th.due)}` : 'i dag'}.`, at: st.at }); continue; }
      if (st?.at && !st.deliver && st.at <= now && st.end > now) { out.push({ thing: th, step: st, type: 'okt', reason: `Økta di er nå, ${hhmm(st.at)}–${hhmm(st.end)}: ${st.title}.`, at: st.at }); continue; }
      if (st?.at && !st.deliver && st.at > now && st.at - now <= 10 * MIN) { out.push({ thing: th, step: st, type: 'okt', reason: `Økta di starter ${hhmm(st.at)}: ${st.title}.`, at: st.at }); continue; }
    }
    if (r.type === 'tid' && r.at <= now && now - r.at < 18 * HOUR) out.push({ thing: th, type: 'tid', reason: `Du ba om å få den kl. ${hhmm(r.at)}.`, at: r.at });
    else if (r.type === 'morgen' && pastBrief(th, now)) out.push({ thing: th, type: 'morgen', reason: 'Fra morgenbriefen. Bestem hva den skal være.', at: startOfDay(now) });
    else if (th.kind === 'handle' && th.due && th.due - now < DAY) out.push({ thing: th, type: 'frist', reason: th.due < now ? `Fristen har gått ut. Du må innom ${PLACES[r.place] ? PLACES[r.place].replace(/^(på|i) /, '') : 'stedet'}.` : `Frist ${th.due - now < 12 * HOUR ? 'i dag' : 'i morgen'}. Du må innom ${PLACES[r.place] ? PLACES[r.place].replace(/^(på|i) /, '') : 'stedet'}.`, at: th.due });
    else if (r.type === 'sted' && place && r.place === place) out.push({ thing: th, type: 'sted', reason: `Du er ${PLACES[place] || place}.`, at: 0 });
    else if (r.type === 'person' && near.has(r.person)) {
      const ev = timedEvents(events).find((e) => e.person === r.person && e.end > now);
      out.push({ thing: th, type: 'person', reason: ev ? `Du skal møte ${r.person} kl. ${hhmm(ev.start)}.` : `Du har kontakt med ${r.person} nå.`, at: ev?.start || 0 });
    }
  }
  return out.sort((a, b) => a.at - b.at).slice(0, limit);
}

/** Ledig tid som tekst: «Ledig til 16:00 · 1 t 28 min» eller «Opptatt til 14:00». */
export function timeStatus(n, now) {
  if (n.mode === 'opptatt') return { title: `Opptatt til ${hhmm(n.event.end)}`, sub: n.event.title, remainingMin: Math.round((n.event.end - now) / MIN) };
  if (!n.next || n.gapEnd >= atTime(startOfDay(now), DAY_WINDOW.end)) return { title: n.gapMin > 0 ? `Ledig resten av dagen` : 'Dagen er over', sub: n.gapMin > 0 ? `${fmtDuration(n.gapMin)} til ${DAY_WINDOW.end}` : 'Sov godt.', remainingMin: n.gapMin };
  const go = leaveAt(n.next);
  return {
    title: `Ledig i ${fmtDuration(n.gapMin)}`,
    sub: go ? `Gå ${hhmm(go)} for å rekke ${n.next.title} ${hhmm(n.next.start)}` : `Neste: ${n.next.title} ${hhmm(n.next.start)}`,
    remainingMin: n.gapMin,
  };
}

/** Agenda for en dag som korte linjer. */
export function agendaLines(dayT, events = []) {
  const s = startOfDay(dayT);
  const e = addDays(s, 1);
  return events
    .filter((ev) => ev.status !== 'avlyst' && ev.start < e && ev.end > s)
    .sort((a, b) => a.start - b.start)
    .map((ev) => (ev.allDay ? `Hele dagen: ${ev.title}` : `${hhmm(ev.start)}–${hhmm(ev.end)} ${ev.title}`));
}
