// Kjerne · frister og tidsanslag på norsk: «før torsdag», «innen fredag», «1. des», «30 min».
import { startOfDay, addDays, isoWeekday, startOfWeek, fmtDate, MONTHS_SHORT } from './time.js';
import { wordRe } from './search.js';

export const DEFAULT_ESTIMATE = { lesing: 45, skriving: 60, epost: 15, samtale: 10, annet: 30 };

const WD = { mandag: 1, tirsdag: 2, onsdag: 3, torsdag: 4, fredag: 5, lørdag: 6, søndag: 7 };
const WD_RE = '(mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag)';
const MONTH_RE = '(jan|feb|mar|apr|mai|jun|jul|aug|sep|okt|nov|des)[\\p{L}]*';

function nextWeekday(now, wd, includeToday) {
  let diff = (wd - isoWeekday(now) + 7) % 7;
  if (diff === 0 && !includeToday) diff = 7;
  return addDays(startOfDay(now), diff);
}

function endOf(dayT) {
  return addDays(startOfDay(dayT), 1);
}

function dateDue(d, word, phrase) {
  const before = word && word.toLocaleLowerCase('nb') === 'før';
  return before
    ? { due: startOfDay(d), label: `før ${fmtDate(d)}`, phrase }
    : { due: endOf(d), label: `innen ${fmtDate(d)}`, phrase };
}

function dayMonth(t) {
  const d = new Date(t);
  return `${d.getDate()}. ${MONTHS_SHORT[d.getMonth()]}`;
}

/**
 * Finner en frist i teksten. `due` er et eksklusivt tidspunkt: oppgaven må være ferdig før `due`.
 * «før torsdag» → torsdag 00:00. «innen fredag» → lørdag 00:00.
 */
export function parseDue(text, now) {
  const t = String(text);
  let m;
  if ((m = t.match(wordRe(`(før|innen|til|senest)\\s+(neste\\s+)?${WD_RE}`)))) {
    const wd = WD[m[3].toLocaleLowerCase('nb')];
    const before = m[1].toLocaleLowerCase('nb') === 'før';
    let day = nextWeekday(now, wd, !before);
    if (m[2] && day < addDays(startOfWeek(now), 7)) day = addDays(day, 7);
    return before
      ? { due: startOfDay(day), label: `før ${m[3].toLocaleLowerCase('nb')} ${dayMonth(day)}`, phrase: m[0] }
      : { due: endOf(day), label: `innen ${m[3].toLocaleLowerCase('nb')} ${dayMonth(day)}`, phrase: m[0] };
  }
  if ((m = t.match(wordRe('(før|innen)\\s+(helga|helgen)')))) {
    const sat = nextWeekday(now, 6, false);
    return { due: startOfDay(sat), label: `før helga (${dayMonth(sat)})`, phrase: m[0] };
  }
  if ((m = t.match(wordRe('i\\s+overmorgen')))) {
    const d = addDays(now, 2);
    return { due: endOf(d), label: `i overmorgen (${dayMonth(d)})`, phrase: m[0] };
  }
  if ((m = t.match(wordRe('(innen\\s+|før\\s+)?i\\s+morgen(\\s+tidlig)?')))) {
    const d = addDays(now, 1);
    return { due: endOf(d), label: 'i morgen', phrase: m[0] };
  }
  if ((m = t.match(wordRe('i\\s+(dag|kveld)')))) {
    return { due: endOf(now), label: `i ${m[1].toLocaleLowerCase('nb')}`, phrase: m[0] };
  }
  if ((m = t.match(wordRe('neste\\s+uke')))) {
    const nextMon = addDays(startOfWeek(now), 7);
    return { due: addDays(nextMon, 7), label: 'neste uke', phrase: m[0] };
  }
  if ((m = t.match(wordRe('om\\s+(\\d+)\\s+dag(er)?')))) {
    const d = addDays(now, Number(m[1]));
    return { due: endOf(d), label: `om ${m[1]} dager (${dayMonth(d)})`, phrase: m[0] };
  }
  if ((m = t.match(/(?:(før|innen|til|senest)\s+)?(?<![\p{N}])(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?(?![\p{N}])/iu))) {
    const day = Number(m[2]);
    const month = Number(m[3]) - 1;
    if (day >= 1 && day <= 31 && month >= 0 && month <= 11) {
      const year = m[4] ? Number(m[4].length === 2 ? `20${m[4]}` : m[4]) : new Date(now).getFullYear();
      let d = new Date(year, month, day).getTime();
      if (!m[4] && d < startOfDay(now)) d = new Date(year + 1, month, day).getTime();
      return dateDue(d, m[1], m[0]);
    }
  }
  if ((m = t.match(wordRe(`(?:(før|innen|til|senest)\\s+)?(?:den\\s+)?(\\d{1,2})\\.\\s*${MONTH_RE}`)))) {
    const month = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'].indexOf(m[3].toLocaleLowerCase('nb'));
    const year = new Date(now).getFullYear();
    let d = new Date(year, month, Number(m[2])).getTime();
    if (d < startOfDay(now)) d = new Date(year + 1, month, Number(m[2])).getTime();
    return dateDue(d, m[1], m[0]);
  }
  if ((m = t.match(wordRe(`(på\\s+|neste\\s+)?${WD_RE}`)))) {
    let day = nextWeekday(now, WD[m[2].toLocaleLowerCase('nb')], true);
    if (m[1] && /neste/i.test(m[1]) && day - startOfDay(now) < 7 * 86400000 && isoWeekday(now) < WD[m[2].toLocaleLowerCase('nb')]) day = addDays(day, 7);
    return { due: endOf(day), label: `${m[2].toLocaleLowerCase('nb')} ${dayMonth(day)}`, phrase: m[0] };
  }
  return null;
}

export function parseEstimate(text) {
  const t = String(text);
  let m;
  if ((m = t.match(wordRe('(\\d+)\\s*(min|minutt|minutter)')))) return { minutes: Number(m[1]), phrase: m[0] };
  if ((m = t.match(wordRe('(\\d+(?:[.,]\\d+)?)\\s*(t|time|timer)')))) {
    return { minutes: Math.round(Number(m[1].replace(',', '.')) * 60), phrase: m[0] };
  }
  if ((m = t.match(wordRe('en\\s+halvtime|halvtime')))) return { minutes: 30, phrase: m[0] };
  if ((m = t.match(wordRe('et\\s+kvarter')))) return { minutes: 15, phrase: m[0] };
  if ((m = t.match(wordRe('en\\s+time')))) return { minutes: 60, phrase: m[0] };
  return null;
}

export function detectWorkType(text) {
  const t = String(text);
  if (wordRe('ring|ringe|ringer|snakke med|ta en prat').test(t)) return 'samtale';
  if (wordRe('e-post|epost|mail|mailen|e-posten|svare|svar|sende|send|melding').test(t)) return 'epost';
  if (wordRe('les|lese|leser|lesing|kapittel|kap|pensum|artikkel|artikler|boka|boken').test(t)) return 'lesing';
  if (wordRe('skriv|skrive|utkast|essay|rapport|innlevering|refleksjonsnotat|notat|slides|presentasjon|oppgaven').test(t)) return 'skriving';
  return 'annet';
}

