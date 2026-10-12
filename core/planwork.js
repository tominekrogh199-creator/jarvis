// Kjerne · Planleggeren. Fra frist til konkrete økter i ledig tid.
// Tenker bakover fra fristen: arbeidet legges samlet i dagene før, med en bufferdag før fristen,
// helst på hverdager og på den tiden av døgnet du jobber best, aldri oppå avtaler.
// Er det langt fram, får du en kikk på oppgaven tidlig, og så får du lov å glemme den til øktene kommer.
// Ren logikk, ingen DOM.
import { MIN, HOUR, DAY, startOfDay, addDays, atTime, hhmm, fmtDate, fmtDuration, WEEKDAYS } from './time.js';
import { freeGaps } from './planner.js';
import { templateFor, replanSteps } from './steps.js';

/** Når på døgnet: [fra, til] i timer. */
export const PARTS = { morgen: [8, 12], ettermiddag: [12, 17], kveld: [17, 21.5] };
export const SIZES = { liten: 90, middels: 240, stor: 420 };
export const DONE_FRACTION = { ingenting: 0, litt: 0.25, halvveis: 0.5, nesten: 0.8 };

const SESSION_MAX = 60;
const WRITE_MAX = 45;
const SESSION_MIN = 25;
const WORK_START = '08:00';
const WORK_END = '21:30';
/** Maks økter og omtrent hvor mye fokusert arbeid en vanlig dag tåler. */
const PER_DAY = 3;
const DAY_BUDGET = 130;
const DELIVER_RE = /lever|send søknaden|pakk sekken/i;

const DELIVER = {
  eksamen: 'Pakk sekken og legg deg tidlig',
  presentasjon: 'Presentasjon i dag. Ta med det du trenger',
  soknad: 'Send søknaden',
  innlevering: 'Sjekk kravene og lever',
  generelt: 'Lever',
};
const KICK = {
  eksamen: 'Kikk på pensumlista i 15 min og noter hva som er størst',
  presentasjon: 'Kikk på oppgaven i 15 min og tenk på hovedbudskapet',
  soknad: 'Kikk på utlysningen i 15 min og noter tre krav',
  innlevering: 'Kikk på oppgaveteksten i 15 min og skriv ned spørsmål',
  generelt: 'Kikk på den i 15 min, så vet du hva du går til',
};

let seq = 0;
const sid = () => `w${Date.now().toString(36)}${(seq++).toString(36)}`;
const round5 = (m) => Math.max(5, Math.round(m / 5) * 5);
const isWeekend = (d) => [0, 6].includes(new Date(d).getDay());
const cap = (s) => s.charAt(0).toLocaleUpperCase('nb') + s.slice(1);
const low1 = (s) => s.charAt(0).toLocaleLowerCase('nb') + s.slice(1);
const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} og ${xs[xs.length - 1]}`);

/** Kort dag-tekst: «i dag», «i morgen», «onsdag», «mandag 19. okt». */
export function dayWord(t, now) {
  const diff = Math.round((startOfDay(t) - startOfDay(now)) / DAY);
  if (diff === 0) return 'i dag';
  if (diff === 1) return 'i morgen';
  if (diff > 1 && diff < 7) return WEEKDAYS[new Date(t).getDay()];
  return fmtDate(t);
}

/** Hvor mye arbeid som gjenstår, i minutter. Svarene vinner over malen. */
export function workMinutes(title, answers = {}) {
  const t = templateFor(title);
  const fromTemplate = t.steps.filter(([x], i) => !(i === t.steps.length - 1 && DELIVER_RE.test(x))).reduce((s, [, m]) => s + m, 0);
  const base = SIZES[answers.size] || fromTemplate;
  const left = 1 - (DONE_FRACTION[answers.done] ?? 0);
  return Math.max(30, round5(base * left));
}

/**
 * Øktene som skal gjøres, skalert til tiden som gjenstår. Lange steg deles i økter på maks 60 min
 * (45 min for skriving hvis skriving er det vanskeligste). Leveringen holdes utenfor og blir en egen påminnelse.
 */
export function workSteps(title, totalMin, answers = {}) {
  const t = templateFor(title);
  let list = t.steps.map(([s, m]) => ({ title: s, weight: m }));
  if (list.length && DELIVER_RE.test(list[list.length - 1].title)) list.pop();
  const skip = { litt: 1, halvveis: Math.floor(list.length / 2), nesten: list.length - 1 }[answers.done] || 0;
  list = list.slice(Math.min(skip, list.length - 1));
  if (answers.hard === 'starte') list.unshift({ title: 'Bare start: åpne oppgaven og skriv tre stikkord', weight: 0, fixed: 15 });
  if (answers.hard === 'forsta') list.splice(Math.min(1, list.length), 0, { title: 'Les og noter det du ikke forstår ennå', weight: 40 });
  const fixed = list.reduce((s, x) => s + (x.fixed || 0), 0);
  const weights = list.reduce((s, x) => s + x.weight, 0) || 1;
  const out = [];
  for (const x of list) {
    const minutes = x.fixed || round5(Math.max(SESSION_MIN, ((totalMin - fixed) * x.weight) / weights));
    const max = answers.hard === 'skrive' && /skriv/i.test(x.title) ? WRITE_MAX : SESSION_MAX;
    const parts = minutes > max + 10 ? Math.ceil(minutes / max) : 1;
    for (let i = 0; i < parts; i++) {
      out.push({ title: parts > 1 ? `${x.title} (${i + 1}/${parts})` : x.title, minutes: round5(minutes / parts) });
    }
  }
  return { steps: out, deliverTitle: DELIVER[t.id] || DELIVER.generelt, kickTitle: KICK[t.id] || KICK.generelt, template: t };
}

function prefScore(start, prefer) {
  const d = new Date(start);
  const h = d.getHours() + d.getMinutes() / 60;
  if (prefer === 'asap') return 0;
  const part = PARTS[prefer];
  if (part) return h >= part[0] && h < part[1] ? 2 : 0;
  if (h >= 12 && h < 20) return 1;
  if (h >= 9 && h < 12) return 0.6;
  return 0;
}

/** Ledige luker en dag mellom `after` og `until`, med ti minutter luft rundt avtaler og andre økter. */
function slotsFor(dayT, { after = 0, until, events, taken }) {
  const busy = [...events.filter((e) => !e.allDay && e.status !== 'avlyst'), ...taken]
    .map((e) => ({ id: e.id, status: 'aktiv', start: e.start - 10 * MIN, end: e.end + 10 * MIN }));
  return freeGaps(dayT, { now: after, events: busy, dayStart: WORK_START, dayEnd: WORK_END, minMin: 15 })
    .map((g) => ({ ...g, end: Math.min(g.end, until ?? g.end) }))
    .map((g) => ({ ...g, minutes: Math.round((g.end - g.start) / MIN) }))
    .filter((g) => g.minutes >= 15);
}

/** Beste tidspunkt en dag for en økt på `minutes`. Returnerer {start, end} eller null. */
function placeOn(dayT, minutes, opts) {
  const cands = [];
  for (const g of slotsFor(dayT, opts)) {
    if (g.minutes < minutes) continue;
    const first = Math.ceil(g.start / (15 * MIN)) * 15 * MIN;
    for (let start = first; start + minutes * MIN <= g.end; start += 30 * MIN) {
      cands.push({ start, end: start + minutes * MIN, score: prefScore(start, opts.prefer) - (start - first) / (8 * HOUR) });
    }
  }
  cands.sort((a, b) => b.score - a.score || a.start - b.start);
  return cands[0] || null;
}

/** Dager du er borte (ferie, hyttetur, reise …): heldagsavtaler som betyr at du ikke jobber. */
const AWAY = /ferie|hytte|(?<![\p{L}])tur(?![\p{L}])|reise|bortreist|fridag|(?<![\p{L}])fri(?![\p{L}])|syk|bryllup|konfirmasjon|ekskursjon|festival/iu;
function awayDays(events) {
  const out = new Set();
  for (const e of events) {
    if (!e.allDay || e.status === 'avlyst' || !AWAY.test(e.title || '')) continue;
    for (let d = startOfDay(e.start); d < e.end; d = addDays(d, 1)) out.add(d);
  }
  return out;
}

/** Minutter andre frister allerede har planlagt en dag. */
function loadOn(dayT, events) {
  const end = addDays(dayT, 1);
  return events.filter((e) => e.planned && !e.deliver && !e.kick && e.start >= dayT && e.start < end).reduce((m, e) => m + (e.end - e.start) / MIN, 0);
}

function dayList(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Legger øktene i et vindu av dager. Fordeler jevnt, maks `capN` om dagen, i rekkefølge,
 * og flytter det som ikke får plass en dag videre til neste dag i vinduet.
 */
function attempt(sessions, window, capN, ctx, dayMax = Infinity) {
  const n = sessions.length;
  const W = window.length;
  const quota = window.map((_, i) => Math.min(capN, Math.floor(n / W) + (i < n % W ? 1 : 0)));
  const placed = [];
  const taken = [...ctx.taken];
  let i = 0;
  let carry = 0;
  for (let k = 0; k < W && i < n; k++) {
    const d = window[k];
    const want = Math.min(capN, quota[k] + carry);
    let after = ctx.afterFor(d);
    let got = 0;
    let load = loadOn(d, ctx.events);
    while (got < want && i < n) {
      const s = sessions[i];
      if (load + s.minutes > dayMax) break;
      const slot = placeOn(d, s.minutes, { after, until: ctx.untilFor(d), events: ctx.events, taken, prefer: ctx.prefer });
      if (!slot) break;
      placed.push({ ...s, at: slot.start, end: slot.end });
      taken.push({ start: slot.start, end: slot.end });
      after = slot.end + 15 * MIN;
      load += s.minutes;
      got++; i++;
    }
    carry = Math.max(0, quota[k] + carry - got);
  }
  return { placed, complete: i === n };
}

/**
 * Finner dager og tider for øktene. Prøver i denne rekkefølgen:
 * 1) hverdager, med bufferdag før fristen, så nær fristen som mulig
 * 2) hverdager fra i dag   3) alle dager fra i dag   4) fire økter om dagen.
 */
function placeAll(sessions, { now, due, dueHasTime, events, prefer, prepOnly, hard, weekend, taken = [] }) {
  const today = startOfDay(now);
  const dueDay = startOfDay(due - 1);
  const firstDay = now < atTime(today, '20:30') ? today : addDays(today, 1);
  let lastDay = addDays(dueDay, -1);
  if (lastDay < firstDay && !prepOnly) lastDay = dueDay;
  const away = awayDays(events);
  const days = lastDay >= firstDay ? dayList(firstDay, lastDay).filter((d) => !away.has(d)) : [];
  // Når det er trangt, kan også selve fristdagen brukes (fram til en time før, eller kl. 20).
  const tightDays = !prepOnly && dueDay >= firstDay ? dayList(firstDay, dueDay).filter((d) => !away.has(d)) : days;
  const ctx = {
    events, prefer, taken,
    afterFor: (d) => (d === today ? now + 15 * MIN : 0),
    untilFor: (d) => (d === dueDay ? (dueHasTime ? due - HOUR : atTime(d, '20:00')) : atTime(d, WORK_END)),
  };
  const n = sessions.length;
  if (!n) return { placed: [], complete: true, tight: false, buffer: [], free: 0 };
  const free = tightDays.reduce((sum, d) => sum + slotsFor(d, { after: ctx.afterFor(d), until: ctx.untilFor(d), events, taken }).reduce((a, g) => a + g.minutes, 0), 0);
  if (!tightDays.length) return { placed: [], complete: false, tight: true, buffer: [], free };
  const base = weekend ? days : days.filter((d) => !isWeekend(d));
  const totalMin = sessions.reduce((s, x) => s + x.minutes, 0);
  const W0 = Math.max(Math.ceil(n / PER_DAY), Math.ceil(totalMin / DAY_BUDGET)) + (hard === 'rekke' ? 1 : 0);
  const bufferN = prepOnly ? 0 : hard === 'rekke' ? 2 : 1;
  // 1) Samlet før en buffer, så nær fristen som mulig.
  if (base.length >= W0 + bufferN) {
    const pool = base.slice(0, base.length - bufferN);
    for (let w = W0; w <= pool.length; w++) {
      const r = attempt(sessions, pool.slice(-w), PER_DAY, ctx, 180);
      if (r.complete) return { ...r, tight: false, buffer: base.slice(base.length - bufferN), free };
    }
  }
  // 2–5) Trangt: start så tidlig som mulig, og strekk deg mer for hvert trinn.
  let best = { placed: [] };
  for (const [pool, capN, dayMax] of [[base, PER_DAY, 180], [days, PER_DAY, 180], [tightDays, PER_DAY, 240], [tightDays, 8, Infinity]]) {
    if (!pool.length) continue;
    for (let w = Math.min(Math.ceil(n / capN), pool.length); w <= pool.length; w++) {
      const r = attempt(sessions, pool.slice(0, w), capN, ctx, dayMax);
      if (r.complete) {
        const lastUsed = Math.max(...r.placed.map((p) => startOfDay(p.at)));
        return { ...r, tight: true, buffer: days.filter((d) => d > lastUsed), free };
      }
      if (r.placed.length > best.placed.length) best = r;
    }
  }
  return { ...best, complete: false, tight: true, buffer: [], free };
}

/**
 * Når leveringspåminnelsen kommer: fristdagen kl. 10, to timer før et klokkeslett, eller kvelden før en eksamen.
 * Aldri før siste økt er ferdig, og aldri etter fristen.
 */
function deliverTime({ due, dueHasTime, now, prepOnly, lastEnd = 0 }) {
  const dueDay = startOfDay(due - 1);
  let at;
  if (prepOnly) at = atTime(addDays(dueDay, -1), '20:00');
  else if (dueHasTime) {
    at = due - 2 * HOUR;
    if (at < atTime(dueDay, '08:00')) at = atTime(addDays(dueDay, -1), '20:00');
  } else at = atTime(dueDay, '10:00');
  if (at < now) at = now + 5 * MIN;
  if (lastEnd && at < lastEnd + 5 * MIN) at = lastEnd + 5 * MIN;
  return Math.max(now, Math.min(at, due - 5 * MIN));
}

/** Leveringssteget flyttes etter siste økt når øktene flytter seg. */
function fixDeliver(steps, { due, dueHasTime, now, prepOnly }) {
  const lastEnd = Math.max(0, ...steps.filter((s) => s.at && !s.deliver && !s.done).map((s) => s.end || s.at));
  return steps.map((s) => {
    if (!s.deliver || s.done) return s;
    const at = deliverTime({ due, dueHasTime, now: Math.min(now, s.at), prepOnly, lastEnd });
    return at === s.at ? s : { ...s, at, end: at + 15 * MIN, day: startOfDay(at) };
  });
}

/** Dager som tekst: «onsdag og torsdag», «onsdag–fredag». */
export function daysText(dayTs, now) {
  const ds = [...new Set(dayTs.map(startOfDay))].sort((a, b) => a - b);
  if (!ds.length) return '';
  const consecutive = ds.every((d, i) => i === 0 || Math.round((d - ds[i - 1]) / DAY) === 1);
  if (ds.length > 2 && consecutive) return `fra ${dayWord(ds[0], now)} til ${dayWord(ds[ds.length - 1], now)}`;
  if (ds.length === 1) return dayWord(ds[0], now);
  return `${ds.slice(0, -1).map((d) => dayWord(d, now)).join(', ')} og ${dayWord(ds[ds.length - 1], now)}`;
}

/** Linjer for planen: når du gjør hva, og når du kan la den være. */
export function planLines(steps, { now, buffer = [], due }) {
  const work = steps.filter((s) => s.at && !s.done && !s.deliver && !s.kick);
  const kick = steps.find((s) => s.kick && !s.done && s.at);
  const del = steps.find((s) => s.deliver && !s.done);
  const byDay = new Map();
  for (const s of work) {
    const d = startOfDay(s.at);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(s);
  }
  const doLines = [...byDay.entries()].sort((a, b) => a[0] - b[0])
    .map(([d, list]) => ({ day: d, label: cap(dayWord(d, now)), minutes: list.reduce((m, s) => m + (s.estimateMin || 0), 0), text: `${cap(dayWord(d, now))} ${andList(list.map((s) => `${hhmm(s.at)}–${hhmm(s.end)}`))}`, items: list }));
  const firstWork = work.length ? Math.min(...work.map((s) => s.at)) : null;
  const notLines = [];
  if (firstWork && startOfDay(firstWork) > startOfDay(kick?.at || now)) {
    notLines.push(kick
      ? `Etter kikken trenger du ikke tenke på den før ${dayWord(firstWork, now)} kl. ${hhmm(firstWork)}.`
      : `Du trenger ikke tenke på den før ${dayWord(firstWork, now)} kl. ${hhmm(firstWork)}. Jeg sier fra.`);
  }
  const lastWork = work.length ? Math.max(...work.map((s) => s.at)) : null;
  const buf = (buffer || []).filter((d) => (!lastWork || d > startOfDay(lastWork)) && d < startOfDay(due - 1));
  if (buf.length) notLines.push(`${cap(daysText(buf, now))} er buffer hvis noe glipper. Ellers er ${buf.length === 1 ? 'den' : 'de'} fri.`);
  return {
    kick: kick ? `${cap(dayWord(kick.at, now))} ${hhmm(kick.at)}: ${low1(kick.title)}.` : null,
    doLines,
    notLines,
    deliver: del ? `${cap(dayWord(del.at, now))} ${hhmm(del.at)}: ${low1(del.title)}.` : null,
  };
}

/**
 * Lager planen. `due` er eksklusiv (slutten av fristdagen), eller fristens klokkeslett hvis dueHasTime.
 * events: avtaler og andre planlagte økter (blir ikke dobbeltbooket).
 * Returnerer {steps, totalMin, fits, tight, firstAt, window, summary, lines, warnings, template, buffer}.
 */
export function planWork({ title, due, dueHasTime = false, now, events = [], answers = {}, prefer = null, weekend = false, keep = [], custom = null }) {
  const base = workSteps(title, workMinutes(title, answers), answers);
  // Egne steg (for eksempel skreddersydd av Claude): koden bestemmer fortsatt når de gjøres.
  const todo = custom?.length
    ? custom.slice(0, 12).map((x) => ({ title: String(x.title).slice(0, 90), minutes: Math.min(90, Math.max(10, round5(Number(x.minutes) || 30))) }))
    : base.steps;
  const { deliverTitle, kickTitle, template } = base;
  const totalMin = todo.reduce((s, x) => s + x.minutes, 0);
  const prepOnly = !!template.prepOnly;
  const r = placeAll(todo, { now, due, dueHasTime, events, prefer, prepOnly, hard: answers.hard, weekend });
  const today = startOfDay(now);
  const placed = r.placed.map((s) => ({ id: sid(), title: s.title, estimateMin: s.minutes, day: startOfDay(s.at), at: s.at, end: s.end, done: false }));
  // En kikk tidlig når arbeidet ligger langt fram: da vet du hva du går til, og kan spørre i tide.
  let kick = null;
  const firstWork = placed[0]?.at;
  if (firstWork && startOfDay(firstWork) >= addDays(today, 3) && (!answers.done || answers.done === 'ingenting')) {
    const taken = placed.map((p) => ({ start: p.at, end: p.end }));
    const candidates = [today, addDays(today, 1), addDays(today, 2)].filter((d) => weekend || !isWeekend(d)).slice(0, 2);
    for (const d of candidates) {
      const slot = placeOn(d, 15, { after: d === today ? now + 15 * MIN : 0, until: atTime(d, WORK_END), events, taken, prefer });
      if (slot) { kick = { id: sid(), title: kickTitle, estimateMin: 15, day: d, at: slot.start, end: slot.end, done: false, kick: true }; break; }
    }
  }
  const lastEnd = Math.max(0, ...placed.map((p) => p.end));
  const dAt = deliverTime({ due, dueHasTime, now, prepOnly, lastEnd });
  // Eksamen i morgen tidlig eller i dag: «legg deg tidlig» gir ikke mening lenger.
  const examSoon = prepOnly && atTime(addDays(startOfDay(due - 1), -1), '20:00') < now;
  const deliver = { id: sid(), title: examSoon ? 'Eksamen snart. Pakk det du trenger' : deliverTitle, estimateMin: 15, day: startOfDay(dAt), at: dAt, end: dAt + 15 * MIN, done: false, deliver: true };
  const steps = [...keep, ...(kick ? [kick] : []), ...placed, deliver];
  const warnings = [];
  const need = todo.reduce((s, x) => s + x.minutes, 0);
  const got = placed.reduce((s, x) => s + x.estimateMin, 0);
  if (!r.complete) warnings.push(`Det er bare ${fmtDuration(r.free)} ledig før fristen, og den trenger rundt ${fmtDuration(need)}. Jeg fikk plass til ${fmtDuration(got)}. Gjør den mindre${weekend ? '' : ', bruk helga'}, eller be om utsettelse.`);
  else if (r.tight) warnings.push('Det er lite ledig tid før fristen, så øktene starter med en gang.');
  // En dag med mer enn fire timer er mye. Si det ærlig, uten å lage panikk.
  const perDay = new Map();
  for (const x of placed) perDay.set(startOfDay(x.at), (perDay.get(startOfDay(x.at)) || 0) + x.estimateMin);
  const heavy = [...perDay.entries()].filter(([, m]) => m > 240).sort((a, b) => a[0] - b[0])[0];
  if (heavy) warnings.push(`Det blir ${fmtDuration(heavy[1])} ${dayWord(heavy[0], now)}. Det er mye. Ta pauser, og gjør den mindre hvis du kan.`);
  const lines = planLines(steps, { now, buffer: r.buffer, due });
  const window = daysText(placed.map((p) => p.at), now);
  const dueText = `${prepOnly ? 'Eksamen' : 'Lever'} ${dayWord(due - 1, now)}${dueHasTime ? ` kl. ${hhmm(due)}` : ''}.`;
  const summary = placed.length
    ? `Jobb med den ${window}: ${placed.length} ${placed.length === 1 ? 'økt' : 'økter'}, ${fmtDuration(got)} til sammen. ${dueText}`
    : `Jeg fant ingen ledig tid før fristen. ${dueText}`;
  return {
    steps, totalMin, fits: r.complete, tight: r.tight, firstAt: (kick || placed[0])?.at || null, window,
    summary, lines, warnings, template: template.id, buffer: r.buffer,
  };
}

/**
 * Fristjobben: økter som gikk forbi uten å bli gjort, eller som nå kolliderer med en avtale, legges på nytt
 * sammen med de som gjenstår. Gjorte steg og leveringen står. En kikk som glapp, faller bort.
 * opts.force: steg-id-er som skal flyttes uansett. opts.from: tidligste tidspunkt (for «ta det i morgen»).
 * Returnerer {steps, moved, fits}.
 */
export function replanSessions(thing, now, events = [], { force = [], from = null, skip = [] } = {}) {
  const steps = thing.steps || [];
  const same = { steps, moved: 0, changed: false, fits: true, stale: 0 };
  if (!steps.some((s) => s.at) || !thing.due || thing.due <= now) return same;
  const real = events.filter((e) => !e.planned && !e.allDay && e.status !== 'avlyst' && e.thingId !== thing.id);
  const away = awayDays(events);
  const clash = (s) => s.at && (real.some((e) => e.start < s.end && s.at < e.end) || away.has(startOfDay(s.at)));
  // En økt regnes som glippet tjue minutter etter at den skulle vært ferdig, så du rekker å ta den litt sent.
  // Økter som ikke fikk plass før, prøves på nytt.
  const needs = steps.filter((s) => !s.done && !s.deliver && !s.kick && !skip.includes(s.id) && (!s.at || s.end <= now - 20 * MIN || clash(s) || force.includes(s.id)));
  // En kikk er frivillig: glipper den, faller den bort.
  const lostKick = steps.filter((s) => s.kick && !s.done && !skip.includes(s.id) && (s.end < now || clash(s) || force.includes(s.id)));
  if (!needs.length) {
    if (!lostKick.length) return same;
    return { ...same, steps: steps.filter((s) => !lostKick.includes(s)), changed: true };
  }
  // Minst mulig uro: øktene som står fint, blir stående. Bare de som må flytte, får ny tid,
  // så tidlig som mulig (glippet) eller så nær den gamle dagen som mulig (kollisjon).
  const others = events.filter((e) => e.thingId !== thing.id);
  const t = templateFor(thing.title);
  const start = Math.max(now, from || 0);
  const today = startOfDay(start);
  const dueDay = startOfDay(thing.due - 1);
  const lastDay = t.prepOnly ? addDays(dueDay, -1) : dueDay;
  const until = (d) => (d === dueDay ? (thing.dueHasTime ? thing.due - HOUR : atTime(d, '20:00')) : atTime(d, WORK_END));
  const allDays = lastDay >= today ? dayList(today, lastDay).filter((d) => !away.has(d)) : [];
  const weekend = !!thing.plan?.weekend;
  const prefer = thing.plan?.prefer || null;
  const taken = steps.filter((s) => s.at && !s.done && !s.deliver && !needs.includes(s) && !lostKick.includes(s))
    .map((s) => ({ start: s.at, end: skip.includes(s.id) ? Math.max(s.end, now + 30 * MIN) : s.end }));
  const placedNew = new Map();
  const ownLoad = (d) => taken.filter((x) => x.start >= d && x.start < addDays(d, 1)).reduce((m, x) => m + (x.end - x.start) / MIN, 0);
  let complete = true;
  for (const s of needs) {
    const minutes = s.estimateMin || 30;
    const missed = !s.at || s.end <= now - 20 * MIN || force.includes(s.id);
    const origin = missed ? today : Math.max(today, startOfDay(s.at));
    const order = [...allDays.filter((d) => d >= origin), ...allDays.filter((d) => d < origin).reverse()];
    let slot = null;
    for (const pass of [false, true]) {
      for (const d of order) {
        if (!pass && !weekend && isWeekend(d)) continue;
        if (d === dueDay && !pass && allDays.some((x) => x < dueDay)) continue; // fristdagen bare når det er trangt
        if (loadOn(d, others) + ownLoad(d) + minutes > 240) continue;
        slot = placeOn(d, minutes, { after: d === today ? start + 15 * MIN : 0, until: until(d), events: others, taken, prefer });
        if (slot) break;
      }
      if (slot) break;
    }
    if (slot) { taken.push({ start: slot.start, end: slot.end }); placedNew.set(s.id, slot); } else complete = false;
  }
  const byId = new Map([...placedNew.entries()].map(([id, x]) => [id, { at: x.start, end: x.end }]));
  const needIds = new Set(needs.map((x) => x.id));
  let moved = 0;
  let stale = 0;
  let out = steps
    .filter((s) => !lostKick.includes(s))
    .map((s) => {
      if (s.done || s.deliver || s.kick || skip.includes(s.id) || !needIds.has(s.id)) return s;
      const p = byId.get(s.id);
      const next = p ? { ...s, at: p.at, end: p.end, day: startOfDay(p.at) } : { ...s, at: null, end: null, day: startOfDay(start) };
      if (next.at !== s.at) {
        moved++;
        // Lå den i Google Kalender, står den der med feil tid til du oppdaterer.
        if (s.gcal) { next.gcal = false; next.gcalStale = true; stale++; }
      }
      return next;
    });
  out = fixDeliver(out, { due: thing.due, dueHasTime: !!thing.dueHasTime, now, prepOnly: !!t.prepOnly });
  out.sort((a, b) => (a.deliver ? 1 : 0) - (b.deliver ? 1 : 0) || (a.done === b.done ? 0 : a.done ? -1 : 1) || (a.at || a.day || 0) - (b.at || b.day || 0));
  const changed = moved > 0 || lostKick.length > 0 || JSON.stringify(out) !== JSON.stringify(steps);
  return { steps: changed ? out : steps, moved, changed, fits: complete, stale };
}

/** Én inngang for jobbene: tidsplanlagte frister får nye økter, gamle frister med dagssteg fordeles som før. */
export function replanThing(thing, now, events = [], opts = {}) {
  if (thing.steps?.some((s) => s.at)) return replanSessions(thing, now, events, opts);
  const r = replanSteps(thing.steps || [], thing.due, now, thing.template);
  return { steps: r.steps, moved: r.moved, changed: r.moved > 0, fits: !r.tight, stale: 0 };
}

/** Beste tid i dag eller i morgen for noe som tar `minutes`: «i dag 14:15 (ledig til 15:30)». */
export function bestTime(minutes, { now, events = [], prefer = 'asap' }) {
  const today = startOfDay(now);
  for (const d of [today, addDays(today, 1)]) {
    const slot = placeOn(d, Math.max(10, minutes), { after: d === today ? now + 10 * MIN : 0, until: atTime(d, WORK_END), events, taken: [], prefer });
    if (slot) {
      const gap = slotsFor(d, { after: d === today ? now + 10 * MIN : 0, until: atTime(d, WORK_END), events, taken: [] }).find((g) => g.start <= slot.start && g.end >= slot.end);
      return { at: slot.start, end: slot.end, gapEnd: gap?.end || slot.end, text: `${dayWord(slot.start, now)} ${hhmm(slot.start)}${gap && gap.end - slot.end >= 20 * MIN ? ` (ledig til ${hhmm(gap.end)})` : ''}` };
    }
  }
  return null;
}

/** Planlagte økter som hendelser (for Dag, Nå og ledig tid). */
export function sessionEvents(things = []) {
  const out = [];
  for (const th of things) {
    if (th.status !== 'aktiv' || !th.steps) continue;
    for (const s of th.steps) {
      if (!s.at || s.done) continue;
      out.push({
        id: `okt-${s.id}`, title: s.deliver ? `${s.title}: ${th.title}` : s.title, start: s.at, end: s.end || s.at + (s.estimateMin || 30) * MIN,
        thingId: th.id, stepId: s.id, planned: true, deliver: !!s.deliver, kick: !!s.kick, context: th.title, status: 'aktiv',
      });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Frister som kan vente i dag: «Arbeidskrav: neste økt onsdag 16:00». */
export function canWait(things = [], now) {
  const today = startOfDay(now);
  const out = [];
  for (const th of things) {
    if (th.status !== 'aktiv' || th.kind !== 'frist' || !th.steps?.some((s) => s.at)) continue;
    const todayOpen = th.steps.some((s) => !s.done && s.at && startOfDay(s.at) <= today && !(s.kick && s.end < now));
    const next = th.steps.filter((s) => !s.done && s.at && startOfDay(s.at) > today).sort((a, b) => a.at - b.at)[0];
    if (!todayOpen && next) out.push({ thing: th, next, text: `${th.title}: ${next.deliver ? low1(next.title) : 'neste økt'} ${dayWord(next.at, now)} ${hhmm(next.at)}` });
  }
  return out.sort((a, b) => a.next.at - b.next.at);
}

/** Ord som betyr «dette er et arbeid som tar flere økter». Hele ord, så «lesesal» og «prosjektmøte» ikke teller. */
export const BIG_WORK = /(?<![\p{L}])(eksamen\p{L}*|hjemmeeksamen|innlevering\p{L}*|arbeidskrav\p{L}*|\p{L}*oppgave(n|r|ne)?|essay|rapport(en)?|bachelor\p{L}*|søknad(en)?|presentasjon(en)?|pitch(en)?|refleksjonsnotat\p{L}*|prosjekt(et|oppgave\p{L}*)?|lese|skrive|midtveis\p{L}*)(?![\p{L}])|(?<![\p{L}])(prøve|test|quiz)(en)?\s+(i|på)\s+\p{L}/iu;

/** Om en ting er stor nok til at Jarvis planlegger den i økter. */
export function worthPlanning(item) {
  if (!item || !item.due || !['frist', 'oppgave'].includes(item.kind)) return false;
  return BIG_WORK.test(item.title || '') || (item.kind === 'frist' && !!item.steps?.length);
}

/** Spørsmålene Jarvis stiller. Hopper over det den allerede vet. */
export function questionsFor(thing, { prefer = null } = {}) {
  const qs = [];
  qs.push({ id: 'done', q: 'Hvor mye har du gjort?', options: [['ingenting', 'Ingenting'], ['litt', 'Litt'], ['halvveis', 'Halvveis'], ['nesten', 'Nesten ferdig']] });
  qs.push({ id: 'size', q: 'Hvor stor er den, tror du?', options: [['liten', 'Liten, 1–2 t'], ['middels', 'Middels, 3–5 t'], ['stor', 'Stor, 6 t +'], ['vet-ikke', 'Vet ikke']] });
  qs.push({ id: 'hard', q: 'Hva blir vanskeligst?', options: [['starte', 'Komme i gang'], ['forsta', 'Forstå stoffet'], ['skrive', 'Skrive'], ['rekke', 'Rekke det']] });
  if (!prefer) qs.push({ id: 'prefer', q: 'Når på dagen jobber du best?', options: [['morgen', 'Morgen'], ['ettermiddag', 'Ettermiddag'], ['kveld', 'Kveld']] });
  return qs;
}
