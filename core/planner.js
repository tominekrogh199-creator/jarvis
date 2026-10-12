// Jarvis-kjernen · Planleggeren. Koden bestemmer: kollisjoner, sperretider, tidsfaktor og forslag.
import {
  MIN, DAY, startOfDay, addDays, atTime, isoWeekday, roundUpTo, hhmm, fmtDuration, fmtDay, fmtFactor, minutesOf,
} from './time.js';

export const DEFAULT_DAY = { start: '08:00', end: '22:00' };

export function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/** Om en sperretid gjelder en gitt dag. block.days = [1..7], tom = alle dager. */
function blockAppliesOn(block, dayT) {
  return !block.days || block.days.length === 0 || block.days.includes(isoWeekday(dayT));
}

/**
 * Konkrete intervaller for sperretider rundt en dag. Tar med dagen før,
 * så en nattsperre (23:00–07:00) fra kvelden før dekker morgenen.
 */
export function blockIntervals(blocks, dayT) {
  const out = [];
  for (const offset of [-1, 0]) {
    const d = addDays(startOfDay(dayT), offset);
    for (const b of blocks || []) {
      if (!blockAppliesOn(b, d)) continue;
      const start = atTime(d, b.start);
      let end = atTime(d, b.end);
      if (minutesOf(b.end) <= minutesOf(b.start)) end = atTime(addDays(d, 1), b.end);
      out.push({ kind: 'block', id: b.id, title: b.title, start, end });
    }
  }
  return out;
}

/** Hendelser som opptar tid. En glippet, ryddet eller flyttet økt frigjør tiden sin. */
const ACTIVE_EVENT = (e) => !['ryddet', 'flyttet', 'avlyst', 'glippet'].includes(e.status);

/** Alle kollisjoner for et tidsrom. Hendelser får en buffer, sperretider ikke. */
export function findConflicts({ start, end }, { events = [], blocks = [], ignoreId = null, bufferMin = 0 } = {}) {
  const conflicts = [];
  const buf = bufferMin * MIN;
  for (const e of events) {
    if (e.id === ignoreId || !ACTIVE_EVENT(e)) continue;
    if (overlaps(start, end, e.start - buf, e.end + buf)) {
      conflicts.push({ kind: 'event', id: e.id, title: e.title, start: e.start, end: e.end });
    }
  }
  const days = new Set([startOfDay(start), startOfDay(end - 1)]);
  for (const d of days) {
    for (const iv of blockIntervals(blocks, d)) {
      if (overlaps(start, end, iv.start, iv.end) && !conflicts.some((c) => c.kind === 'block' && c.id === iv.id)) {
        conflicts.push(iv);
      }
    }
  }
  return conflicts;
}

/** Varighet justert med tidsfaktor, rundet opp til nærmeste 5 minutter. */
export function adjustedDuration(min, factor = 1) {
  return Math.max(5, Math.ceil((min * factor) / 5) * 5);
}

/**
 * Tidsfaktor fra planlagt mot faktisk tid i ferdige økter.
 * Vektet snitt av de siste `window` øktene, holdt mellom 0,75 og 2,5.
 */
export function timeFactor(events = [], { minSamples = 3, window = 10 } = {}) {
  const done = events
    .filter((e) => e.kind === 'okt' && e.status === 'ferdig' && e.plannedMin > 0 && e.actualMin > 0)
    .sort((a, b) => (b.endedAt || b.end) - (a.endedAt || a.end))
    .slice(0, window);
  if (done.length < minSamples) {
    return {
      factor: 1,
      samples: done.length,
      why: `For få ferdige økter ennå (${done.length} av ${minSamples}), så jeg regner med 1,0.`,
    };
  }
  const planned = done.reduce((s, e) => s + e.plannedMin, 0);
  // Hver økt teller mellom 0,5 og 3 ganger planlagt, så én avbrutt økt ikke vipper alt.
  const actual = done.reduce((s, e) => s + Math.min(3 * e.plannedMin, Math.max(0.5 * e.plannedMin, e.actualMin)), 0);
  let factor = actual / planned;
  factor = Math.min(2.5, Math.max(0.75, factor));
  factor = Math.round(factor * 20) / 20;
  const pct = Math.round(Math.abs(factor - 1) * 100);
  const why = factor === 1
    ? `De siste ${done.length} øktene tok omtrent så lang tid som planlagt.`
    : `De siste ${done.length} øktene tok ${pct} % ${factor > 1 ? 'lengre' : 'kortere'} tid enn planlagt.`;
  return { factor, samples: done.length, why };
}

/**
 * «Hvor passer dette?» Gir 2–3 ulike tidspunkter med konsekvens og hvorfor.
 * Ingen forslag kolliderer med hendelser (med buffer) eller sperretider, og alle slutter før fristen.
 */
export function findSlots({
  now,
  durationMin,
  events = [],
  blocks = [],
  due = null,
  factor = 1,
  count = 3,
  dayStart = DEFAULT_DAY.start,
  dayEnd = DEFAULT_DAY.end,
  stepMin = 15,
  horizonDays = 7,
  bufferMin = 10,
  ignoreId = null,
}) {
  const dur = adjustedDuration(durationMin, factor);
  const earliest = roundUpTo(now + 5 * MIN, stepMin);
  const horizonEnd = atTime(addDays(startOfDay(now), horizonDays), dayEnd);
  const latestEnd = due ? Math.min(due, horizonEnd) : horizonEnd;
  const candidates = [];

  for (let d = startOfDay(now); d <= latestEnd; d = addDays(d, 1)) {
    const winStart = Math.max(atTime(d, dayStart), earliest);
    const winEnd = Math.min(atTime(d, dayEnd), latestEnd);
    for (let s = roundUpTo(winStart, stepMin); s + dur * MIN <= winEnd; s += stepMin * MIN) {
      const e = s + dur * MIN;
      const c = findConflicts({ start: s, end: e }, { events, blocks, ignoreId, bufferMin });
      if (c.length === 0) candidates.push({ start: s, end: e });
    }
    if (candidates.length > 400) break;
  }

  if (candidates.length === 0) {
    return {
      slots: [],
      durationMin: dur,
      why: due
        ? `Fant ingen ledig tid på ${fmtDuration(dur)} før fristen. Vi kan gjøre oppgaven mindre eller dele den opp.`
        : `Fant ingen ledig tid på ${fmtDuration(dur)} den neste uka.`,
    };
  }

  // Velg ulike forslag: snarest, en rolig formiddag, og seneste trygge tid før frist.
  const picked = [];
  const farEnough = (c) => picked.every((p) => Math.abs(p.start - c.start) >= 2 * 60 * MIN);
  const add = (c, label) => {
    if (c && farEnough(c) && picked.length < count) picked.push({ ...c, label });
  };
  add(candidates[0], 'Snarest');
  add(
    candidates.find((c) => startOfDay(c.start) > startOfDay(candidates[0].start) && new Date(c.start).getHours() < 12),
    'Rolig formiddag',
  );
  const safeLast = due
    ? [...candidates].reverse().find((c) => due - c.end >= DAY) || candidates[candidates.length - 1]
    : candidates.find((c) => startOfDay(c.start) >= addDays(startOfDay(now), 2));
  add(safeLast, !due ? 'Senere i uka' : safeLast && due - safeLast.end >= DAY ? 'Senest trygge' : 'Senest mulig');
  for (const c of candidates) add(c, 'Alternativ');

  const slots = picked
    .sort((a, b) => a.start - b.start)
    .map((s) => ({
      ...s,
      durationMin: dur,
      consequence: slotConsequence(s, { now, due, events, durationMin, dur }),
      why: factor !== 1
        ? `${fmtDuration(dur)} i stedet for ${fmtDuration(durationMin)}, fordi tidsfaktoren din er ${fmtFactor(factor)}.`
        : 'Ledig tid uten kollisjoner eller sperretider.',
    }));
  return { slots, durationMin: dur, why: `Sjekket kalender og sperretider for ${fmtDuration(dur)}.` };
}

function slotConsequence(slot, { now, due, events }) {
  const parts = [];
  if (due) {
    const marginH = Math.round((due - slot.end) / (60 * MIN));
    if (marginH >= 48) parts.push(`Ferdig ${Math.floor(marginH / 24)} dager før fristen`);
    else if (marginH >= 24) parts.push('Ferdig dagen før fristen');
    else parts.push(`Bare ${Math.max(0, marginH)} t slakk før fristen`);
  }
  const next = events
    .filter((e) => ACTIVE_EVENT(e) && e.start >= slot.end && e.start - slot.end <= 45 * MIN)
    .sort((a, b) => a.start - b.start)[0];
  if (next) parts.push(`rett før ${next.title.toLowerCase()} kl. ${hhmm(next.start)}`);
  const h = new Date(slot.start).getHours();
  if (h >= 20) parts.push('tar litt av kvelden');
  const sameDayOkter = events.filter((e) => e.kind === 'okt' && ACTIVE_EVENT(e) && startOfDay(e.start) === startOfDay(slot.start) && e.status === 'planlagt').length;
  if (sameDayOkter >= 2) parts.push(`${fmtDay(slot.start, now)} får ${sameDayOkter + 1} økter`);
  if (parts.length === 0) parts.push(`${fmtDay(slot.start, now)} blir lett`);
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1) + '.';
}

/** Rangerer åpne oppgaver: frist, kobling til mål og aktivt prosjekt, og liten størrelse. */
export function rankTasks(tasks = [], { now, projects = [], goals = [] } = {}) {
  const projectById = new Map(projects.map((p) => [p.id, p]));
  return tasks
    .filter((t) => t.status !== 'ferdig')
    .map((t) => {
      let score = 0;
      const why = [];
      if (t.due) {
        const days = (t.due - now) / DAY;
        if (days < 0) { score += 50; why.push('fristen har passert'); }
        else if (days < 2) { score += 40; why.push('fristen er snart'); }
        else if (days < 7) { score += 20; why.push('frist denne uka'); }
      }
      const p = t.projectId ? projectById.get(t.projectId) : null;
      if (p?.active) { score += 15; why.push(`hører til ${p.title}`); }
      if (p?.goalId && goals.some((g) => g.id === p.goalId)) { score += 10; why.push('støtter et mål'); }
      if ((t.estimateMin || 30) <= 20) { score += 5; why.push('kort å gjøre'); }
      return { task: t, score, why: why.length ? why.join(', ') : 'åpen oppgave' };
    })
    .sort((a, b) => b.score - a.score || (a.task.due || Infinity) - (b.task.due || Infinity));
}

/** Hendelser og sperretider for én dag, sortert. */
export function dayAgenda(dayT, { events = [], blocks = [] } = {}) {
  const s = startOfDay(dayT);
  const e = addDays(s, 1);
  const items = events
    .filter((ev) => ev.status !== 'ryddet' && overlaps(ev.start, ev.end, s, e))
    .map((ev) => ({ ...ev, type: 'event' }));
  for (const b of blockIntervals(blocks, dayT)) {
    if (overlaps(b.start, b.end, s, e)) {
      items.push({ ...b, type: 'block', start: Math.max(b.start, s), end: Math.min(b.end, e) });
    }
  }
  return items.sort((a, b) => a.start - b.start);
}

/**
 * Ledige luker en dag (fra nå hvis det er i dag), mellom dagstart og dagslutt.
 * Hendelser og sperretider tar tid; glippede, flyttede og ferdige økter i fortiden gjør ikke.
 */
export function freeGaps(dayT, { now = 0, events = [], blocks = [], dayStart = DEFAULT_DAY.start, dayEnd = DEFAULT_DAY.end, minMin = 10 } = {}) {
  const s = Math.max(atTime(dayT, dayStart), now);
  const e = atTime(dayT, dayEnd);
  if (e <= s) return [];
  const busy = [];
  for (const ev of events) {
    if (!ACTIVE_EVENT(ev)) continue;
    if (overlaps(ev.start, ev.end, s, e)) busy.push([Math.max(ev.start, s), Math.min(ev.end, e)]);
  }
  for (const b of blockIntervals(blocks, dayT)) {
    if (overlaps(b.start, b.end, s, e)) busy.push([Math.max(b.start, s), Math.min(b.end, e)]);
  }
  busy.sort((a, b) => a[0] - b[0]);
  const gaps = [];
  let cur = s;
  for (const [bs, be] of busy) {
    if (bs > cur) gaps.push({ start: cur, end: bs });
    cur = Math.max(cur, be);
  }
  if (cur < e) gaps.push({ start: cur, end: e });
  return gaps
    .map((g) => ({ ...g, minutes: Math.round((g.end - g.start) / MIN) }))
    .filter((g) => g.minutes >= minMin);
}

/** Neste hendelse som ikke er ferdig, fra nå. */
export function nextEvent(events = [], now) {
  return events
    .filter((e) => ACTIVE_EVENT(e) && e.end > now && !['ferdig'].includes(e.status))
    .sort((a, b) => a.start - b.start)[0] || null;
}

/** Planlagte timer resten av dagen mot ledige timer. */
export function dayLoad(dayT, { now, events = [], blocks = [], dayStart = DEFAULT_DAY.start, dayEnd = DEFAULT_DAY.end } = {}) {
  const s = Math.max(atTime(dayT, dayStart), now || 0);
  const e = atTime(dayT, dayEnd);
  const planned = events
    .filter((ev) => ev.kind === 'okt' && ACTIVE_EVENT(ev) && ev.status !== 'ferdig' && overlaps(ev.start, ev.end, s, e))
    .reduce((sum, ev) => sum + (Math.min(ev.end, e) - Math.max(ev.start, s)), 0) / (60 * MIN);
  const free = freeGaps(dayT, { now, events, blocks, dayStart, dayEnd, minMin: 0 }).reduce((sum, g) => sum + g.minutes, 0) / 60;
  return { plannedH: Math.round(planned * 10) / 10, availableH: Math.round((planned + free) * 10) / 10 };
}

export { ACTIVE_EVENT };
