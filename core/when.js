// Kjerne · tidsuttrykk på norsk for avtaler: «i morgen kveld», «lunsj kl 11:45 på fredag», «16.–20. nov».
import { DAY, MIN, startOfDay, addDays, atTime, isoWeekday, fmtDate, hhmm, pad2 } from './time.js';
import { wordRe } from './search.js';

const WD = { mandag: 1, tirsdag: 2, onsdag: 3, torsdag: 4, fredag: 5, lørdag: 6, søndag: 7 };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];
const MONTH_RE = '(jan|feb|mar|apr|mai|jun|jul|aug|sep|okt|nov|des)[\\p{L}]*';

/** Del av dagen → klokkeslett. */
export const PARTS = {
  'tidlig i morgen': '07:30',
  morgen: '08:00',
  morgenen: '08:00',
  formiddag: '10:00',
  formiddagen: '10:00',
  lunsj: '12:00',
  lunsjen: '12:00',
  ettermiddag: '15:00',
  ettermiddagen: '15:00',
  kveld: '18:00',
  kvelden: '18:00',
  'sent i kveld': '21:00',
};

function nextWeekday(now, wd, includeToday = true) {
  let diff = (wd - isoWeekday(now) + 7) % 7;
  if (diff === 0 && !includeToday) diff = 7;
  return addDays(startOfDay(now), diff);
}

function monthIndex(word) {
  return MONTHS.indexOf(String(word).toLocaleLowerCase('nb').slice(0, 3));
}

function dateFrom(day, month, now) {
  const y = new Date(now).getFullYear();
  let d = new Date(y, month, day).getTime();
  if (d < startOfDay(now) - 31 * DAY) d = new Date(y + 1, month, day).getTime();
  return d;
}

/** Dato-intervall: «16.–20. nov», «16-20 november», «fra 16. til 20. nov». Returnerer {from, to, label, phrase}. */
export function parseRange(text, now) {
  const t = String(text);
  const m = t.match(new RegExp(`(?:fra\\s+)?(\\d{1,2})\\.?\\s*(?:–|-|til)\\s*(\\d{1,2})\\.?\\s*${MONTH_RE}`, 'iu'));
  if (!m) return null;
  const month = monthIndex(m[3]);
  if (month < 0) return null;
  const from = dateFrom(Number(m[1]), month, now);
  const to = dateFrom(Number(m[2]), month, now);
  if (to < from) return null;
  return { from, to: addDays(to, 1), label: `${m[1]}.–${m[2]}. ${MONTHS[month]}`, phrase: m[0] };
}

/** Dag i teksten: i dag, i morgen, ukedag, dato. Returnerer {day, label, phrase} eller null. */
export function parseDay(text, now) {
  const t = String(text);
  let m;
  if ((m = t.match(wordRe('i\\s+overmorgen')))) return { day: addDays(startOfDay(now), 2), label: 'i overmorgen', phrase: m[0] };
  if ((m = t.match(wordRe('i\\s+morgen(?!\\s+tidlig)|i\\s+morra')))) return { day: addDays(startOfDay(now), 1), label: 'i morgen', phrase: m[0] };
  if ((m = t.match(wordRe('i\\s+morgen\\s+tidlig')))) return { day: addDays(startOfDay(now), 1), label: 'i morgen tidlig', phrase: m[0], part: '07:30' };
  if ((m = t.match(wordRe('i\\s+dag|i\\s+kveld|i\\s+ettermiddag|i\\s+formiddag')))) {
    const part = m[0].toLocaleLowerCase('nb').replace(/^i\s+/, '');
    return { day: startOfDay(now), label: m[0].toLocaleLowerCase('nb'), phrase: m[0], part: PARTS[part] || null };
  }
  const exact = explicitDate(t, now);
  if (exact) return exact;
  if ((m = t.match(wordRe('(?:på\\s+|neste\\s+)?(mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag)')))) {
    const name = m[1].toLocaleLowerCase('nb');
    let day = nextWeekday(now, WD[name], true);
    if (/neste/i.test(m[0]) && day - startOfDay(now) < 7 * DAY && isoWeekday(now) < WD[name]) day = addDays(day, 7);
    return { day, label: name, phrase: m[0] };
  }
  if ((m = t.match(wordRe('(?:i|til|denne|neste)\\s+helg(?:a|en)')))) {
    let sat = nextWeekday(now, 6, true);
    if (/neste/i.test(m[0]) && sat - startOfDay(now) < 7 * DAY) sat = addDays(sat, 7);
    return { day: sat, label: 'i helga', phrase: m[0] };
  }
  if ((m = t.match(wordRe('neste\\s+uke')))) {
    const mon = addDays(startOfDay(now), ((8 - isoWeekday(now)) % 7) || 7);
    return { day: mon, label: 'neste uke', phrase: m[0], vague: true };
  }
  return explicitDate(t, now);
}

/** «19. oktober», «19.10», «mandag 19. oktober»: en ukedag rett foran en dato er bare en merkelapp. */
function explicitDate(t, now) {
  let m;
  let found = null;
  if ((m = t.match(/(?<![\p{N}.\/])(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?![\p{N}])/u)) && !/kl\.?\s*$/i.test(t.slice(0, m.index))) {
    const d = Number(m[1]);
    const mo = Number(m[2]) - 1;
    if (d >= 1 && d <= 31 && mo >= 0 && mo <= 11) {
      const day = m[3] ? new Date(Number(m[3].length === 2 ? `20${m[3]}` : m[3]), mo, d).getTime() : dateFrom(d, mo, now);
      found = { day, label: fmtDate(day), phrase: m[0], index: m.index };
    }
  }
  if (!found && (m = t.match(wordRe(`(?:den\\s+)?(\\d{1,2})\\.\\s*${MONTH_RE}`)))) {
    const mo = monthIndex(m[2]);
    if (mo >= 0) {
      const day = dateFrom(Number(m[1]), mo, now);
      found = { day, label: fmtDate(day), phrase: m[0], index: m.index };
    }
  }
  if (!found) return null;
  const before = t.slice(0, found.index);
  const wd = before.match(/(?:(?:på|neste)\s+)?(mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag)\s*,?\s*(?:den\s+)?$/iu);
  const phrase = wd ? `${wd[0]}${found.phrase}` : found.phrase;
  return { day: found.day, label: found.label, phrase };
}

/** Klokkeslett: «kl. 11:45», «kl 18», «klokka 9», «11:45». Returnerer {hhmm, phrase} eller null. */
const NUMW = { ett: 1, en: 1, ei: 1, to: 2, tre: 3, fire: 4, fem: 5, seks: 6, sju: 7, syv: 7, åtte: 8, ni: 9, ti: 10, elleve: 11, tolv: 12 };
const NUMW_RE = '(\\d{1,2}|ett|en|to|tre|fire|fem|seks|sju|syv|åtte|ni|ti|elleve|tolv)';
const num = (w) => (/^\d+$/.test(w) ? Number(w) : NUMW[String(w).toLocaleLowerCase('nb')]);

export function parseClock(text) {
  const t = String(text);
  let w = t.match(wordRe(`(?:kl\\.?\\s*|klokka\\s+)?(halv|kvart\\s+over|kvart\\s+på)\\s+${NUMW_RE}`));
  if (w) {
    const base = num(w[2]);
    if (base >= 1 && base <= 12) {
      const kind = w[1].toLocaleLowerCase('nb').replace(/\s+/, ' ');
      const [hh, mm] = kind === 'halv' ? [base - 1, 30] : kind === 'kvart over' ? [base, 15] : [base - 1, 45];
      return { hhmm: `${pad2((hh + 24) % 24)}:${pad2(mm)}`, phrase: w[0], loose: true };
    }
  }
  let m = t.match(/(?:kl\.?|klokka|klokken)\s*(\d{1,2})(?:[:.](\d{2}))?/iu);
  if (!m) m = t.match(/(?<![\p{N}.])(\d{1,2}):(\d{2})(?![\p{N}])/u);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2] || 0);
  if (h > 23 || mi > 59) return null;
  return { hhmm: `${pad2(h)}:${pad2(mi)}`, phrase: m[0] };
}

/** Del av dagen uten dag: «kveld», «ettermiddag» (også «i morgen kveld»). */
export function parsePart(text) {
  // «i morgen» er en dag, ikke «morgen» som del av dagen.
  const t = String(text).toLocaleLowerCase('nb').replace(/i\s+(over)?morgen(?!\s+tidlig)|i\s+morra/g, ' ');
  for (const [k, v] of Object.entries(PARTS).sort((a, b) => b[0].length - a[0].length)) {
    if (wordRe(k).test(t)) return { hhmm: v, phrase: k };
  }
  return null;
}

/**
 * Når skjer det? Kombinerer dag, klokkeslett og del av dagen.
 * Returnerer {start, timeKnown, dayKnown, label, phrases[]} eller null hvis ingenting ble funnet.
 * Uten dag: i dag hvis tidspunktet ikke har passert, ellers i morgen.
 */
const REL_N = { en: 1, et: 1, ett: 1, to: 2, tre: 3, fire: 4, fem: 5, ti: 10, femten: 15, tjue: 20, tretti: 30, førti: 40, femti: 50 };

/** «om en time», «om 30 min», «om et kvarter». */
export function parseRelative(text, now) {
  const m = String(text).match(wordRe('om\\s+(?:(\\d+|en|et|ett|to|tre|fire|fem|ti|femten|tjue|tretti|førti|femti)\\s+)?(min(?:utt(?:er)?)?|time(?:r)?|t|kvarter|halvtime)'));
  if (!m) return null;
  const n = m[1] ? (/^\d+$/.test(m[1]) ? Number(m[1]) : REL_N[m[1].toLocaleLowerCase('nb')]) : 1;
  const unit = m[2].toLocaleLowerCase('nb');
  const min = unit.startsWith('kvarter') ? 15 * n : unit.startsWith('halvtime') ? 30 * n : unit.startsWith('min') ? n : 60 * n;
  if (!min || min > 24 * 60) return null;
  return { start: now + min * MIN, minutes: min, phrase: m[0] };
}

/** Tidsrom på en dag: «10-16», «fra 10 til 16», «kl 10.30–12». */
export function parseTimeRange(text) {
  const m = String(text).match(/(?:fra\s+)?(?:kl\.?\s*)?(?<![\p{N}.])(\d{1,2})(?:[:.](\d{2}))?\s*(?:-|–|til)\s*(?:kl\.?\s*)?(\d{1,2})(?:[:.](\d{2}))?(?![\p{N}.]|\s*\.?\s*(?:jan|feb|mar|apr|mai|jun|jul|aug|sep|okt|nov|des))/u);
  if (!m) return null;
  const a = Number(m[1]); const b = Number(m[3]);
  if (a > 23 || b > 24 || (b * 60 + Number(m[4] || 0)) <= (a * 60 + Number(m[2] || 0))) return null;
  return { start: `${pad2(a)}:${pad2(Number(m[2] || 0))}`, end: `${pad2(b % 24)}:${pad2(Number(m[4] || 0))}`, phrase: m[0] };
}

export function parseWhen(text, now) {
  const rel = parseRelative(text, now);
  if (rel) return { start: rel.start, day: startOfDay(rel.start), timeKnown: true, dayKnown: true, label: `om ${rel.minutes < 60 ? `${rel.minutes} min` : `${Math.round(rel.minutes / 6) / 10} t`.replace('.', ',')}`, phrases: [rel.phrase] };
  const day = parseDay(text, now);
  let clock = parseClock(text);
  if (clock) {
    // «kl 3» betyr nesten alltid 15:00; «kl 7 i kveld» betyr 19:00.
    let [hh, mm] = clock.hhmm.split(':').map(Number);
    const low = String(text).toLocaleLowerCase('nb');
    if (hh >= 1 && hh <= 6 && !/natt|tidlig|morgen(?!dag)/.test(low)) hh += 12;
    else if (hh < 12 && /kveld|ettermiddag/.test(low)) hh += 12;
    clock = { ...clock, hhmm: `${pad2(hh)}:${pad2(mm)}` };
  }
  const part = clock ? null : parsePart(text);
  if (!day && !clock && !part) return null;
  const time = clock?.hhmm || day?.part || part?.hhmm || null;
  let dayT = day?.day ?? startOfDay(now);
  if (!day && time && atTime(dayT, time) < now - 15 * MIN) dayT = addDays(dayT, 1);
  const start = time ? atTime(dayT, time) : null;
  const label = [day?.label || (dayT === startOfDay(now) ? 'i dag' : 'i morgen'), time ? `kl. ${time}` : null].filter(Boolean).join(' ');
  return {
    start,
    day: dayT,
    timeKnown: !!time,
    dayKnown: !!day,
    vague: !!day?.vague && !time,
    label,
    phrases: [day?.phrase, clock?.phrase, part?.phrase].filter(Boolean),
  };
}

/** Standard varighet for vanlige avtaler (minutter). */
export function defaultDuration(text) {
  const t = String(text).toLocaleLowerCase('nb');
  if (/lunsj/.test(t)) return 45;
  if (/middag|kino|fest|konsert/.test(t)) return 120;
  if (/tren|trening|gym|løp|jiu|yoga|svøm/.test(t)) return 75;
  if (/kaffe|kafé|kafe/.test(t)) return 60;
  if (/møte|veiled|gruppe/.test(t)) return 60;
  if (/time hos|lege|tannlege|frisør/.test(t)) return 45;
  if (/ring|samtale/.test(t)) return 15;
  return 60;
}

export function fmtStart(t, now) {
  const diff = Math.round((startOfDay(t) - startOfDay(now)) / DAY);
  const day = diff === 0 ? 'i dag' : diff === 1 ? 'i morgen' : fmtDate(t);
  return `${day} kl. ${hhmm(t)}`;
}
