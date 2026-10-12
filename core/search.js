// Jarvis-kjernen · søk i tankestrømmen: «hva tenkte jeg om pitchen på tirsdag?»
import { DAY, startOfDay, addDays, isoWeekday, startOfWeek, fmtDate } from './time.js';

const L = '\\p{L}\\p{N}';
/** Ordgrense som også fungerer med æ, ø og å. */
export function wordRe(pattern, flags = 'iu') {
  return new RegExp(`(?<![${L}])(?:${pattern})(?![${L}])`, flags);
}

export const STOPWORDS = new Set([
  'hva', 'tenkte', 'tenker', 'tenkt', 'jeg', 'om', 'pa', 'på', 'den', 'det', 'de', 'en', 'et', 'ei', 'i', 'og', 'a', 'å',
  'til', 'for', 'med', 'av', 'var', 'som', 'har', 'hadde', 'meg', 'min', 'mitt', 'mine', 'sa', 'sier', 'skrev', 'noe',
  'noen', 'hvor', 'nar', 'når', 'hvordan', 'hvilke', 'hvilken', 'er', 'at', 'ikke', 'sa', 'bare', 'kan', 'skal', 'vil',
  'ma', 'må', 'dette', 'der', 'her', 'fra', 'etter', 'for', 'før', 'hos', 'eller', 'men', 'dag', 'uke', 'forrige',
  'sist', 'siste', 'gang', 'om', 'angaende', 'angående', 'tanke', 'tanker', 'ide', 'idé', 'ideer',
]);

const WEEKDAY_WORDS = { mandag: 1, tirsdag: 2, onsdag: 3, torsdag: 4, fredag: 5, lordag: 6, lørdag: 6, sondag: 7, søndag: 7 };

export function normalizeWord(w) {
  return w.toLocaleLowerCase('nb').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const SUFFIXES = ['ene', 'ane', 'ers', 'er', 'en', 'et', 'a', 'e'];
export function stem(w) {
  const n = normalizeWord(w);
  if (n.length <= 4) return n;
  for (const s of SUFFIXES) {
    if (n.endsWith(s) && n.length - s.length >= 3) return n.slice(0, -s.length);
  }
  return n;
}

export function tokenize(text, { keepStop = false } = {}) {
  return (String(text).match(/[\p{L}\p{N}]+/gu) || [])
    .map((w) => normalizeWord(w))
    .filter((w) => w.length >= 2 && (keepStop || !STOPWORDS.has(w)) && !(w in WEEKDAY_WORDS))
    .map(stem);
}

function tokensMatch(q, t) {
  if (q.length < 3 || t.length < 3) return q === t;
  return t.startsWith(q) || q.startsWith(t);
}

/** Datoreferanse i et spørsmål om fortiden. Returnerer {from, to, label} eller null. */
export function parseSearchDate(query, now) {
  const q = query.toLocaleLowerCase('nb');
  const today = startOfDay(now);
  if (wordRe('i går|igår').test(q)) return { from: addDays(today, -1), to: today, label: 'i går' };
  if (wordRe('i forgårs').test(q)) return { from: addDays(today, -2), to: addDays(today, -1), label: 'i forgårs' };
  if (wordRe('i dag|idag').test(q)) return { from: today, to: addDays(today, 1), label: 'i dag' };
  if (wordRe('forrige uke').test(q)) {
    const w = startOfWeek(now);
    return { from: addDays(w, -7), to: w, label: 'forrige uke' };
  }
  const m = q.match(wordRe('(forrige\\s+)?(mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag)'));
  if (m) {
    const wd = WEEKDAY_WORDS[m[2]];
    let diff = (isoWeekday(now) - wd + 7) % 7;
    if (m[1] && diff === 0) diff = 7;
    const from = addDays(today, -diff);
    return { from, to: addDays(from, 1), label: `${m[2]} ${fmtDate(from).split(' ').slice(1).join(' ')}` };
  }
  return null;
}

/**
 * Finner tanker som passer spørsmålet. Poeng for ordtreff og for riktig dag.
 * Returnerer [{thought, score, why}] sortert.
 */
export function searchThoughts(query, thoughts = [], { now }) {
  const date = parseSearchDate(query, now);
  const qTokens = [...new Set(tokenize(query))];
  if (qTokens.length === 0 && !date) return [];
  const results = [];
  for (const t of thoughts) {
    const tTokens = tokenize(`${t.text} ${t.title || ''}`);
    const hits = qTokens.filter((q) => tTokens.some((tt) => tokensMatch(q, tt)));
    const inDate = date ? t.createdAt >= date.from && t.createdAt < date.to : false;
    if (qTokens.length > 0 && hits.length === 0) continue;
    if (qTokens.length === 0 && !inDate) continue;
    const score = hits.length * 2 + (inDate ? 3 : 0) + (t.createdAt / DAY) * 1e-6;
    const whyParts = [];
    if (hits.length) whyParts.push(`treff på «${hits.join('», «')}»`);
    if (inDate) whyParts.push(`skrevet ${date.label}`);
    else if (date) whyParts.push(`ikke fra ${date.label}, men nærmeste treff`);
    results.push({ thought: t, score, why: whyParts.join(', ') });
  }
  return results.sort((a, b) => b.score - a.score);
}
