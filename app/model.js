// Utvalg fra datasettet som flere skjermer trenger.
import { store } from './store.js';
import { clock } from './clock.js';
import { startOfDay, HOUR } from '../core/time.js';
import { pickNow, resurface, BRIEF } from '../core/now.js';
import { sessionEvents } from '../core/planwork.js';

/** Ekte avtaler: importert kalender og avtaler du har fanget. */
export function calendarOf(ds) {
  const fromThings = ds.things
    .filter((t) => t.kind === 'avtale' && t.status === 'aktiv' && t.start)
    .map((t) => ({ id: t.id, title: t.title, start: t.start, end: t.end, allDay: !!t.allDay, person: t.person || null, travelMin: t.travelMin || null, place: t.place || null, thingId: t.id }));
  return [...ds.calendar.filter((e) => e.status !== 'avlyst'), ...fromThings].sort((a, b) => a.start - b.start);
}

/** Avtaler pluss øktene Planleggeren har satt av til fristene dine. */
export function eventsOf(ds) {
  return [...calendarOf(ds), ...sessionEvents(ds.things)].sort((a, b) => a.start - b.start);
}

/** Planinnstillinger: når du jobber best, og om helga kan brukes. */
export function planPrefs() {
  return { prefer: store.settings.workPrefer || null, weekend: !!store.settings.workWeekend };
}

/** Stedet du sa at du er på. Gjelder i tre timer. */
export function currentPlace(ds, now = clock.now()) {
  return ds.place && now - ds.place.at < 3 * HOUR ? ds.place.key : null;
}

export function energyToday(ds, now = clock.now()) {
  return ds.energy && ds.energy.day === startOfDay(now) ? ds.energy.level : null;
}

export function skipToday(ds, now = clock.now()) {
  return ds.skip?.day === startOfDay(now) ? ds.skip.ids : [];
}

/** Navnet på personen du skriver til akkurat nå (åpent utkast), for person-regler. */
export const focusPerson = { name: null };

function syncBrief() {
  const [h, m] = (store.settings.briefTime || '07:30').split(':').map(Number);
  BRIEF.hour = h + (m || 0) / 60;
}

export function nowState(ds = store.ds(), now = clock.now()) {
  syncBrief();
  return pickNow({ now, things: ds.things, events: eventsOf(ds), energy: energyToday(ds, now), skip: skipToday(ds, now), place: currentPlace(ds, now), persons: [focusPerson.name] });
}

export function surfacing(ds = store.ds(), now = clock.now()) {
  syncBrief();
  return resurface({ now, things: ds.things, events: eventsOf(ds), place: currentPlace(ds, now), persons: [focusPerson.name] });
}

/** Utkast som venter på at du trykker send. */
export function pendingDrafts(ds = store.ds()) {
  return ds.things.filter((t) => t.status === 'aktiv' && t.draft && t.draft.status !== 'sendt');
}

export function activeThings(ds = store.ds()) {
  return ds.things.filter((t) => t.status === 'aktiv');
}
