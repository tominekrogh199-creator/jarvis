// Kjerne · morgenbrief, kveldsavslutning, Uka di og comeback. Korte tekster uten skam.
import { HOUR, DAY, startOfDay, addDays, hhmm, fmtDate, startOfWeek } from './time.js';
import { today as wxToday, advice as wxAdvice, WET } from './weather.js';
import { timedEvents, leaveAt, pickNow } from './now.js';
import { nextStep } from './steps.js';
import { replanThing, canWait } from './planwork.js';
import { briefAt } from './sort.js';

export function greeting(now, name) {
  const h = new Date(now).getHours();
  const part = h < 5 ? 'God natt' : h < 10 ? 'God morgen' : h < 17 ? 'Hei' : h < 22 ? 'God kveld' : 'God natt';
  return name ? `${part}, ${name}.` : `${part}.`;
}

/**
 * Været gjort om til handling: «Regn fra 16. Ta paraply når du går 15:40.»
 * Bruker første avtale med kjent reisetid hvis den finnes.
 */
export function weatherAction(w, now, events = []) {
  if (!w) return null;
  const d = wxToday(w, now);
  const out = timedEvents(events).find((e) => e.start > now && e.travelMin && startOfDay(e.start) === startOfDay(now));
  const go = out ? leaveAt(out) : null;
  if (d?.wetFrom && go && go >= d.wetFrom - HOUR) return `Vått fra ${hhmm(d.wetFrom)}. Ta paraply når du går ${hhmm(go)}.`;
  if (WET.has(w.now.kind) && go) return `Det er vått nå. Ta paraply når du går ${hhmm(go)}.`;
  return wxAdvice(w, now);
}

/** Morgenbriefen. Én skjerm, rundt ett minutt å lese. */
export function morningBrief({ now, weather = null, events = [], things = [], energy = null, place = null, settings = {} }) {
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const todays = timedEvents(events).filter((e) => e.start >= today && e.start < tomorrow);
  const first = todays.find((e) => e.end > now) || null;
  const steps = things
    .filter((th) => th.status === 'aktiv' && th.kind === 'frist')
    .flatMap((th) => {
      const timed = (th.steps || []).filter((s) => !s.done && s.at && startOfDay(s.at) === today);
      if (timed.length) return timed.map((s) => ({ thing: th, step: s }));
      const s = nextStep(th, now);
      return s && !s.at && s.day <= today ? [{ thing: th, step: s }] : [];
    })
    .sort((a, b) => (a.step.at || 0) - (b.step.at || 0));
  const waiting = canWait(things, now);
  const comingBack = things
    .filter((th) => th.status === 'aktiv' && th.ret?.type === 'tid' && th.ret.at >= today && th.ret.at < tomorrow && th.kind !== 'avtale')
    .sort((a, b) => a.ret.at - b.ret.at);
  const undecided = things.filter((th) => th.status === 'aktiv' && th.ret?.type === 'morgen' && th.kind !== 'avtale');
  const deadlines = things
    .filter((th) => th.status === 'aktiv' && th.due && th.due > now && th.due - now < 3 * DAY)
    .sort((a, b) => a.due - b.due);
  const one = pickNow({ now: Math.max(now, first && first.start <= now ? first.end : now), things, events, energy, place });
  const lines = [];
  if (weather) {
    const d = wxToday(weather, now);
    lines.push({ kind: 'vaer', text: `${weather.now.temp}° og ${weather.now.desc.toLocaleLowerCase('nb')}${d && d.min !== d.max ? `, ${d.min}–${d.max}° i dag` : ''}.`, action: weatherAction(weather, now, events), source: weather.source });
  }
  if (first) {
    const go = leaveAt(first);
    lines.push({ kind: 'forst', text: `Første avtale: ${first.title} kl. ${hhmm(first.start)}.`, action: go ? `Gå senest ${hhmm(go)}.` : null });
  } else lines.push({ kind: 'forst', text: 'Ingen avtaler i kalenderen i dag.', action: null });
  for (const d of deadlines.slice(0, 2)) lines.push({ kind: 'frist', text: `Frist ${fmtDate(d.due - 1)}: ${d.title}.`, action: null });
  return { greeting: greeting(now, settings.name), lines, first, steps, waiting, comingBack, undecided, one: one.pick, todays };
}

/** Kveldsavslutning: hva ble gjort, hva flyttes til i morgen. */
export function eveningWrap({ now, things = [], sessions = [] }) {
  const today = startOfDay(now);
  const done = things.filter((th) => th.doneAt && th.doneAt >= today);
  const stepsDone = things.flatMap((th) => (th.steps || []).filter((s) => s.doneAt && s.doneAt >= today).map((s) => ({ thing: th, step: s })));
  const focusMin = sessions.filter((s) => s.start >= today).reduce((sum, s) => sum + (s.actualMin || 0), 0);
  const unfinished = things.filter((th) => th.status === 'aktiv' && th.kind !== 'avtale' && (
    (th.ret?.type === 'tid' && th.ret.at < now && th.ret.at >= today) || th.ret?.type === 'kveld'
  ));
  const tomorrow = addDays(today, 1);
  const tomorrowSessions = things
    .filter((th) => th.status === 'aktiv' && th.kind === 'frist')
    .flatMap((th) => (th.steps || []).filter((s) => !s.done && s.at && startOfDay(s.at) === tomorrow).map((s) => ({ thing: th, step: s })))
    .sort((a, b) => a.step.at - b.step.at);
  return { done, stepsDone, focusMin, unfinished, tomorrowSessions };
}

/** Uka di: det du fikk til, aldri det som glapp. */
export function weekReview({ now, things = [], sessions = [], comebacks = [] }) {
  const from = startOfWeek(now);
  const done = things.filter((th) => th.doneAt && th.doneAt >= from);
  const stepsDone = things.reduce((n, th) => n + (th.steps || []).filter((s) => s.doneAt && s.doneAt >= from).length, 0);
  const focus = sessions.filter((s) => s.start >= from);
  const focusMin = focus.reduce((sum, s) => sum + (s.actualMin || 0), 0);
  const backs = comebacks.filter((c) => c.at >= from).length;
  const ideas = things.filter((th) => th.status === 'aktiv' && th.kind === 'ide');
  const days = new Set([...done.map((d) => startOfDay(d.doneAt)), ...focus.map((s) => startOfDay(s.start))]).size;
  return { from, done, stepsDone, focusMin, sessions: focus.length, comebacks: backs, ideas, activeDays: days };
}

/** Har du vært borte lenge nok til at et comeback-kort hjelper? */
export function needsComeback(lastActiveAt, now, hours = 36) {
  return !!lastActiveAt && now - lastActiveAt >= hours * HOUR;
}

/**
 * Comeback: rydder uten å telle det som glapp.
 * Returnerer {ops: [{id, patch}], moved, archived, replanned, text}.
 */
export function comebackPlan({ now, things = [], settings = {}, events = [] }) {
  const ops = [];
  let moved = 0;
  let archived = 0;
  let replanned = 0;
  const tomorrowBrief = briefAt(addDays(startOfDay(now), 1), settings);
  for (const th of things) {
    if (th.status !== 'aktiv') continue;
    if (th.kind === 'frist' && th.steps?.length && th.due > now) {
      const r = replanThing(th, now, events);
      if (r.changed) ops.push({ id: th.id, patch: { steps: r.steps } });
      replanned += r.moved;
      continue;
    }
    if (th.kind === 'avtale') continue;
    if (th.ret?.type === 'tid' && th.ret.at < now - 12 * HOUR) {
      ops.push({ id: th.id, patch: { ret: (th.estimateMin || 30) <= 15 ? { type: 'ledig' } : { type: 'tid', at: tomorrowBrief } } });
      moved++;
    } else if ((th.kind === 'notat') && th.ret?.type === 'morgen' && now - (th.createdAt || now) > 4 * DAY) {
      ops.push({ id: th.id, patch: { ret: { type: 'arkiv' } } });
      archived++;
    }
  }
  const parts = [];
  if (moved) parts.push(`flyttet ${moved} ${moved === 1 ? 'ting' : 'ting'} til et nytt tidspunkt`);
  if (replanned) parts.push(`la ${replanned} steg på nytt så fristene fortsatt holder`);
  if (archived) parts.push(`la ${archived} gamle notater i arkivet, der du finner dem med søk`);
  const text = parts.length ? `Jeg har ${parts.join(', ')}. Ingenting er slettet.` : 'Alt ligger der det skal. Ingenting er slettet.';
  return { ops, moved, archived, replanned, text };
}

