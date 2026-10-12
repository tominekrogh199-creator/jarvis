// Jarvis-kjernen · tid og datoer. Ren logikk, ingen DOM. Alle tider er millisekunder (epoch).

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

/** Logisk døgn starter kl. 04:00, så en endring kl. 02 om natten hører til «i går». */
export const DAY_BOUNDARY_HOUR = 4;
/** «Neste morgen» betyr kl. 06:00. */
export const MORNING_HOUR = 6;

export const WEEKDAYS = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];
export const WEEKDAYS_SHORT = ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør'];
export const MONTHS = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'];
export const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];

export function startOfDay(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Legger til hele kalenderdager (tåler sommertid). */
export function addDays(t, n) {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/** Tidspunkt «HH:MM» på samme kalenderdag som dayT. */
export function atTime(dayT, hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  const d = new Date(dayT);
  d.setHours(h || 0, m || 0, 0, 0);
  return d.getTime();
}

export function minutesOf(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function hhmm(t) {
  const d = new Date(t);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 1 = mandag … 7 = søndag */
export function isoWeekday(t) {
  const g = new Date(t).getDay();
  return g === 0 ? 7 : g;
}

export function startOfWeek(t) {
  const s = startOfDay(t);
  return addDays(s, -(isoWeekday(s) - 1));
}

export function sameDay(a, b) {
  return startOfDay(a) === startOfDay(b);
}

/** Start på det logiske døgnet (kl. 04:00) som t tilhører. */
export function logicalDayStart(t) {
  const today4 = atTime(startOfDay(t), `${pad2(DAY_BOUNDARY_HOUR)}:00`);
  return t >= today4 ? today4 : atTime(addDays(startOfDay(t), -1), `${pad2(DAY_BOUNDARY_HOUR)}:00`);
}

export function logicalDayEnd(t) {
  return atTime(addDays(startOfDay(logicalDayStart(t)), 1), `${pad2(DAY_BOUNDARY_HOUR)}:00`);
}

/**
 * Når en løsere avtale trer i kraft: kl. 06:00 morgenen etter det logiske døgnet endringen ble gjort i.
 * Endring mandag 21:00 → tirsdag 06:00. Endring tirsdag 02:00 (fortsatt «mandag kveld») → tirsdag 06:00.
 * Endring tirsdag 05:00 → onsdag 06:00.
 */
export function nextMorning(t) {
  const dayStart = startOfDay(logicalDayStart(t));
  return atTime(addDays(dayStart, 1), `${pad2(MORNING_HOUR)}:00`);
}

export function roundUpTo(t, stepMin) {
  const step = stepMin * MIN;
  return Math.ceil(t / step) * step;
}

export function fmtDate(t) {
  const d = new Date(t);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()}. ${MONTHS_SHORT[d.getMonth()]}`;
}

/** «i dag», «i morgen», «i går» eller «tirsdag 6. okt». */
export function fmtDay(t, now) {
  const diff = Math.round((startOfDay(t) - startOfDay(now)) / DAY);
  if (diff === 0) return 'i dag';
  if (diff === 1) return 'i morgen';
  if (diff === -1) return 'i går';
  return fmtDate(t);
}

export function fmtDayTime(t, now) {
  return `${fmtDay(t, now)} kl. ${hhmm(t)}`;
}

export function fmtDuration(min) {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} t ${r} min` : `${h} t`;
}

/** Nedtelling som «mm:ss» eller «t:mm:ss». */
export function fmtCountdown(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}

export function fmtFactor(f) {
  return f.toFixed(2).replace(/0$/, '').replace('.', ',');
}
