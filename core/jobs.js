// Kjerne · bakgrunnsjobbene. Hver jobb har en tydelig oppgave, en utløser og en logg.
// Rene funksjoner: de returnerer endringer (ops) og en loggtekst. Appen utfører dem og gjør dem angrebare.
import { HOUR, MIN, startOfDay, hhmm } from './time.js';
import { replanThing } from './planwork.js';
import { briefAt } from './sort.js';

export const JOBS = [
  { id: 'morgen', name: 'Morgenjobben', does: 'Lager morgenbriefen med været, første avtale, når du må gå og dagens steg.' },
  { id: 'frist', name: 'Fristjobben', does: 'Holder fristene delt i økter i ledig tid, og flytter økter som glapp eller kolliderer med en ny avtale, uten kjeft.' },
  { id: 'oppfolging', name: 'Oppfølgingsjobben', does: 'Spør om utkast du åpnet ble sendt, og foreslår å gjøre ting mindre når de blir utsatt igjen og igjen.' },
  { id: 'rydding', name: 'Ryddejobben', does: 'Rydder om natten: ting som ikke ble tatt, kommer tilbake i morgenbriefen i stedet for å hope seg opp.' },
];

/** Har jobben allerede kjørt i dag (etter tidspunktet)? */
function ranSince(state, id, t) {
  return (state?.[id]?.lastRun || 0) >= t;
}

export function runMorning({ now, jobState, settings }) {
  const at = briefAt(startOfDay(now), settings);
  if (now < at || ranSince(jobState, 'morgen', at)) return null;
  if (now - at > 10 * HOUR) return { id: 'morgen', ops: [], text: null };
  return { id: 'morgen', ops: [], brief: true, text: `Morgenbriefen for ${hhmm(at)} er klar.` };
}

export function runDeadlines({ now, things, jobState, events = [], activeStepId = null }) {
  // Timeplanlagte økter sjekkes hvert kvarter; gamle dagssteg som før, én gang om morgenen og hver sjette time.
  const timed = things.some((th) => th.status === 'aktiv' && th.steps?.some((s) => s.at && !s.done));
  const last = jobState?.frist?.lastRun || 0;
  if (timed ? last > now - 15 * MIN : (ranSince(jobState, 'frist', startOfDay(now) + 4 * HOUR) && last > now - 6 * HOUR)) return null;
  const ops = [];
  const notes = [];
  for (const th of things) {
    if (th.status !== 'aktiv' || th.kind !== 'frist' || !th.steps?.length || !th.due || th.due <= now) continue;
    const r = replanThing(th, now, events, { skip: activeStepId ? [activeStepId] : [] });
    if (r.changed) ops.push({ id: th.id, patch: { steps: r.steps } });
    if (r.moved) {
      const unit = th.steps.some((s) => s.at) ? (r.moved === 1 ? 'økt' : 'økter') : 'steg';
      notes.push(`${r.moved} ${unit} i «${th.title}»${r.fits ? '' : ' (det blir trangt, vurder å gjøre den mindre)'}`);
    }
  }
  return { id: 'frist', ops, text: notes.length ? `Flyttet ${notes.join(' og ')} til ny ledig tid, så fristen fortsatt holder.` : null };
}

export function runFollowup({ now, things, jobState }) {
  if ((jobState?.oppfolging?.lastRun || 0) > now - 30 * MIN) return null;
  const ops = [];
  const lines = [];
  for (const th of things) {
    if (th.status !== 'aktiv') continue;
    if ((th.snoozes || 0) >= 3 && !th.suggestSmaller && th.kind !== 'frist') {
      ops.push({ id: th.id, patch: { suggestSmaller: true } });
      lines.push(`«${th.title}» er utsatt ${th.snoozes} ganger. Jeg foreslår å gjøre den mindre`);
    }
  }
  return { id: 'oppfolging', ops, text: lines.length ? `${lines.join('. ')}.` : null };
}

export function runTidy({ now, things, jobState, settings }) {
  const night = startOfDay(now) + 4 * HOUR;
  if (now < night || ranSince(jobState, 'rydding', night)) return null;
  const ops = [];
  const brief = briefAt(startOfDay(now), settings);
  let moved = 0;
  for (const th of things) {
    if (th.status !== 'aktiv' || th.kind === 'avtale') continue;
    if (th.ret?.type === 'tid' && th.ret.at < night && now - th.ret.at > 6 * HOUR) {
      ops.push({ id: th.id, patch: { ret: { type: 'tid', at: brief > now ? brief : now } } });
      moved++;
    }
    if (th.ret?.type === 'kveld' && (th.createdAt || 0) < night) {
      ops.push({ id: th.id, patch: { ret: { type: 'tid', at: brief > now ? brief : now } } });
      moved++;
    }
  }
  return { id: 'rydding', ops, text: moved ? `${moved} ${moved === 1 ? 'ting' : 'ting'} fra i går kommer tilbake i morgenbriefen i stedet for å bli liggende.` : null };
}

/** Kjører alle jobber som er klare. Returnerer liste med resultater (bare de som kjørte). */
export function runJobs(ctx) {
  return [runTidy(ctx), runMorning(ctx), runDeadlines(ctx), runFollowup(ctx)].filter(Boolean);
}
