// Kjerne · Sortereren. Én fangst blir til ting med type, tittel og en regel for når den kommer tilbake.
// Spørsmål blir svar, ikke oppgaver. Kommandoer («flytt», «ferdig med», «jeg er på butikken») blir handlinger.
// Ren logikk, ingen DOM. Brukes alene uten nett, og til å kontrollere det Claude foreslår.
import { MIN, DAY, startOfDay, addDays, atTime, hhmm, fmtDate, WEEKDAYS } from './time.js';
import { wordRe } from './search.js';
import { parseWhen, parseDay, parseTimeRange, defaultDuration } from './when.js';
import { parseDue, parseEstimate, detectWorkType, DEFAULT_ESTIMATE } from './due.js';
import { planSteps } from './steps.js';

export const KINDS = {
  oppgave: 'Oppgave',
  frist: 'Frist',
  avtale: 'Avtale',
  melding: 'Melding',
  epost: 'E-post',
  handle: 'Ærend',
  ide: 'Idé',
  notat: 'Notat',
};

/** Steder du kan si at du er. Nøkkel → hvordan det sies i en setning. */
export const PLACES = {
  butikken: 'på butikken',
  apotek: 'på apoteket',
  posten: 'på posten',
  bi: 'på BI',
  hjemme: 'hjemme',
  jobb: 'på jobb',
  byen: 'i byen',
};

export const RET_TYPES = ['tid', 'morgen', 'kveld', 'ledig', 'sted', 'person', 'uke', 'etter', 'arkiv'];

export const DEFAULT_SETTINGS = { briefTime: '07:30', eveningTime: '21:00' };

const cap = (s) => {
  const t = String(s || '').trim();
  return t.charAt(0).toLocaleUpperCase('nb') + t.slice(1);
};
const endSentence = (s) => {
  const t = String(s || '').trim();
  return !t || /[.!?…]$/.test(t) ? t : `${t}.`;
};
const tidy = (s) => String(s || '').replace(/\s{2,}/g, ' ').replace(/\s+([.,!?])/g, '$1').replace(/^[\s,.:;–-]+|[\s,;:–-]+$/g, '').trim();

function removePhrases(text, phrases) {
  let t = String(text);
  // Lengste først, så «torsdag 22. oktober» fjernes før «22. oktober».
  for (const p of [...(phrases || [])].filter(Boolean).sort((a, b) => b.length - a.length)) t = t.replace(p, ' ');
  t = t.replace(/(?<![\p{L}])(neste uke|til helga|i helga)(?![\p{L}])/giu, ' ');
  return tidy(t.replace(/\b(på|i|kl\.?|klokka|den|til|innen|før)\s*$/i, ''));
}

/** Når-tekst for en tilbakekomstregel, slik brukeren leser den. */
export function retLabel(ret, now) {
  if (!ret) return 'ingen plan';
  switch (ret.type) {
    case 'tid': {
      const diff = Math.round((startOfDay(ret.at) - startOfDay(now)) / DAY);
      const day = diff === 0 ? 'i dag' : diff === 1 ? 'i morgen' : diff > 1 && diff < 7 ? WEEKDAYS[new Date(ret.at).getDay()] : diff === -1 ? 'i går' : fmtDate(ret.at);
      return `${day} kl. ${hhmm(ret.at)}`;
    }
    case 'morgen': return 'i morgenbriefen';
    case 'kveld': return 'i kveldsavslutningen';
    case 'ledig': return 'når du har ledig tid';
    case 'sted': return `når du er ${PLACES[ret.place] || ret.place}`;
    case 'person': return `når du har kontakt med ${ret.person}`;
    case 'uke': return 'søndag i Uka di';
    case 'etter': return 'etter økta';
    case 'arkiv': return 'bare når du søker';
    default: return 'ingen plan';
  }
}

/** Morgenbriefen for en dag som tidspunkt. */
export function briefAt(dayT, settings = DEFAULT_SETTINGS) {
  return atTime(dayT, settings.briefTime || DEFAULT_SETTINGS.briefTime);
}

// ---------------- Steder og personer ----------------

const PLACE_WORDS = [
  ['apotek', /apotek|medisin|plaster|paracet|ibux|resept/i],
  ['posten', /pakke|posten|returner|sende pakke|hentelapp/i],
  ['bi', /bibliotek|låne bok|låne boka|skrive ut|printe|campus|\bBI\b|skolen/i],
  ['hjemme', /ta med|lade|vaske|klesvask|rydde rommet|hjemme/i],
  ['byen', /sentrum|byen|klær|gave til/i],
];

export function guessPlace(text) {
  for (const [k, re] of PLACE_WORDS) if (re.test(text)) return k;
  return 'butikken';
}

const PLACE_ALIASES = {
  butikken: 'butikken', butikk: 'butikken', kiwi: 'butikken', rema: 'butikken', meny: 'butikken', coop: 'butikken', extra: 'butikken', joker: 'butikken', spar: 'butikken', matbutikken: 'butikken',
  apoteket: 'apotek', apotek: 'apotek', posten: 'posten', postkontoret: 'posten',
  bi: 'bi', skolen: 'bi', campus: 'bi', biblioteket: 'bi', forelesning: 'bi',
  jobb: 'jobb', jobben: 'jobb', jobbe: 'jobb', kontoret: 'jobb',
  byen: 'byen', sentrum: 'byen', senteret: 'byen', storsenteret: 'byen',
  hjemme: 'hjemme', hjem: 'hjemme',
};

export function placeFromWord(w) {
  return PLACE_ALIASES[String(w || '').toLocaleLowerCase('nb')] || null;
}

const INSTITUTIONS = /^(lånekassen|nav|bi|sio|skatteetaten|banken|posten|studentkonsulenten|eksamenskontoret|biblioteket)$/i;
const FAMILY = ['mamma', 'pappa', 'mormor', 'morfar', 'farmor', 'farfar', 'bestemor', 'bestefar', 'bror', 'søster', 'tante', 'onkel', 'kjæresten'];
const ROLES = ['foreleser', 'foreleseren', 'læreren', 'veileder', 'veilederen', 'sjefen', 'gruppa', 'gruppen', 'klassen', 'studentkonsulenten', 'utleier', 'utleieren'];
const NOT_NAMES = new Set(['BI', 'NHH', 'UiO', 'NTNU', 'OsloMet', 'Oslo', 'Bergen', 'Trondheim', 'Norge', 'Canvas', 'Itslearning', 'Inspera', 'Teams', 'Zoom', 'Vipps', 'Google', 'Apple', 'Jarvis', 'Kiwi', 'Rema', 'Meny', 'Coop', 'Extra', 'Joker', 'Spar', 'Posten', 'Ruter', 'Vy', 'Entur', 'Lånekassen', 'NAV', 'Instagram', 'TikTok', 'Snap', 'Snapchat', 'Messenger', 'Word', 'Excel', 'PowerPoint', 'Gmail',
  'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag', 'Januar', 'Februar', 'Mars', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Desember', 'Jeg', 'Du', 'Hun', 'Han', 'Vi', 'De', 'Hei', 'Husk', 'Ikke']);

/** Finner en person i teksten: kjente navn, familie, roller, eller et navn med stor forbokstav (ikke først i setningen). */
export function detectPerson(text, people = []) {
  const t = String(text);
  for (const p of people) {
    const name = typeof p === 'string' ? p : p?.name;
    if (name && wordRe(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(t)) return name;
  }
  const fam = t.match(wordRe(`(${FAMILY.join('|')})`));
  if (fam) return fam[1].toLocaleLowerCase('nb') === fam[1] ? cap(fam[1]) : fam[1];
  const words = t.match(/[\p{L}]+/gu) || [];
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (/^[A-ZÆØÅ][a-zæøåé]+$/.test(w) && !NOT_NAMES.has(w)) return w;
  }
  return null;
}

/** «emma» → «Emma», «foreleseren» → «foreleseren», «mamma» → «Mamma». */
function cleanRecipient(raw, people = []) {
  let r = tidy(String(raw || '').replace(/^(til|for)\s+/i, ''));
  r = r.split(/\s+/).slice(0, 3).join(' ');
  const known = people.map((p) => (typeof p === 'string' ? p : p?.name)).find((n) => n && n.toLocaleLowerCase('nb') === r.toLocaleLowerCase('nb'));
  if (known) return known;
  const low = r.toLocaleLowerCase('nb');
  if (ROLES.includes(low)) return low;
  return r.split(' ').map((w) => cap(w)).join(' ');
}

/** «hun må sende notatene» til Emma → «du må sende notatene». Lar teksten være hvis noen andre nevnes. */
function toSecondPerson(text) {
  if (/(?<![\p{L}])[A-ZÆØÅ][a-zæøå]+/u.test(String(text).slice(1)) || /\b(sa|sier|skrev)\b/i.test(text)) return String(text);
  return String(text)
    .replace(wordRe('hun|han|hen', 'giu'), (m) => (m[0] === m[0].toUpperCase() ? 'Du' : 'du'))
    .replace(wordRe('henne|ham', 'giu'), 'deg')
    .replace(wordRe('hennes|hans', 'giu'), 'din');
}

/** Leddsetning til hovedsetning: «jeg ikke kommer» → «jeg kommer ikke». */
function mainClause(text) {
  return String(text).replace(/^(jeg|vi|du|han|hun|de|det)\s+(ikke|aldri|nok|bare|også)\s+([\p{L}]+)/iu, '$1 $3 $2');
}

// ---------------- Utkast ----------------

export const DRAFTS = {
  hello: (name) => `Hei ${name}! Hvordan går det?`,
  tell: (name, that) => `Hei ${name}! ${endSentence(cap(mainClause(toSecondPerson(that))))}`,
  topic: (name, topic) => `Hei ${name}! Om ${tidy(topic).replace(/[?.!]+$/, '')}: [skriv det du vil si]`,
  ask: (name, topic) => `Hei ${name}! Et spørsmål om ${tidy(topic).replace(/[?.!]+$/, '')}: [skriv spørsmålet]`,
  email(to, subject, userName) {
    const greet = to && /^[A-ZÆØÅ][a-zæøå]+$/.test(to) && !ROLES.includes(String(to).toLocaleLowerCase('nb')) && !/[@.]/.test(to) && !INSTITUTIONS.test(to) ? `Hei ${to},` : 'Hei,';
    const s = tidy(subject || '').replace(/[?.!]+$/, '');
    const low = s.toLocaleLowerCase('nb');
    let body;
    if (/^utsettelse/.test(low)) body = `Jeg vil spørre om det er mulig å få ${low}. [Skriv kort hvorfor, og hvilken dato du ber om.]`;
    else if (/^fravær|^sykdom|^syk/.test(low)) body = `Jeg gir beskjed om ${low}. [Skriv hvilke dager det gjelder.]`;
    else if (s) body = `Jeg skriver angående ${low}. [Skriv det viktigste i én setning.]`;
    else body = '[Skriv det viktigste i én setning.]';
    return `${greet}\n\n${body}\n\nVennlig hilsen\n${userName || '[navnet ditt]'}`;
  },
};

// ---------------- Spørsmål og kommandoer ----------------

const QUESTION_START = /^(hva|hvordan|hvorfor|hvem|hvor|hvilke|hvilken|når|kan jeg|har jeg|skal jeg|må jeg|bør jeg|er det|er jeg|blir det|trenger jeg|rekker jeg|husker du|vet du|lurer på|jeg lurer på)(?![\p{L}])/iu;
/** «kan du minne meg på …?» er en bestilling, ikke et spørsmål. */
export const POLITE = /^(?:kan|kunne|vil|gidder)\s+du\s+(?:være\s+så\s+snill\s+(?:å\s+)?)?(?=(?:minne|si|sende|skrive|legge|lage|sette|huske|flytte|avlyse|ringe|notere|lagre|planlegge|fortelle|gi|spørre|send|skriv|legg|lag|sett|husk|flytt|avlys|noter|minn)\b)/i;

/** Tolker et spørsmål. Returnerer {answer, …} eller null. */
export function parseQuestion(text, now) {
  const t = String(text).trim();
  const low = t.toLocaleLowerCase('nb');
  if (POLITE.test(low)) return null;
  const isQ = /\?\s*$/.test(t) || QUESTION_START.test(low);
  if (!isQ) return null;
  const pd = parseDay(t, now);
  const day = pd ? startOfDay(pd.day) : startOfDay(now);
  if (/glemt|venter på meg|hva mangler|hva skulle jeg|hva har jeg lovet/.test(low)) return { answer: 'glemt' };
  if (/hva (tenkte|sa|skrev|noterte) jeg|hvor (la|skrev|noterte) jeg|husker du/.test(low)) {
    const q = t.replace(/^(hva|hvor)\s+(tenkte|sa|skrev|noterte|la)\s+jeg\s+(om|på|med)?\s*/i, '').replace(/^husker du\s+(hva\s+)?/i, '').replace(/[?]+$/, '');
    return { answer: 'sok', query: q || t };
  }
  if (/vær|regn|paraply|kaldt|kald\b|varmt|snø|jakke|grader/.test(low)) return { answer: 'vaer', day };
  if (/når (må|skal|bør) jeg (gå|dra|reise|komme meg)/.test(low)) return { answer: 'ga' };
  if (/når har jeg (tid|ledig)|har jeg tid|ledig tid|hvor mye tid/.test(low)) return { answer: 'ledig', day };
  if (/hva (skal|bør|burde|må) jeg (gjøre|ta|begynne)( nå)?\??$|hva nå|hvor (skal|bør) jeg begynne|hva er viktigst/.test(low) && !/(i morgen|på \p{L}+dag)/u.test(low)) return { answer: 'na' };
  if (/hva (har|skjer|står)|hvordan ser (dagen|morgendagen|uka)|planen|timeplan|hva er det (i dag|i morgen)|har jeg noe|hva (skal|må) jeg (gjøre )?(i dag|i morgen|på)|(har jeg|jeg har) (noe|forelesning|time|timer|møte|avtale|jobb)|er jeg (ledig|opptatt)/u.test(low)) return /ledig|tid\b/.test(low) ? { answer: 'ledig', day } : { answer: 'agenda', day };
  return { answer: 'apen', text: t };
}

/** Tolker en kommando. Returnerer {cmd, …} eller null. */
export function parseCommand(text) {
  const t = String(text).trim();
  const low = t.toLocaleLowerCase('nb').replace(/[.!?]+$/, '').trim();
  let m;
  if ((m = low.match(/^(?:jeg\s+)?(?:er|kom(?:mer)?)\s+(?:nå\s+)?(?:fram\s+)?(?:på|i|til)\s+([\p{L}]+)/u)) && placeFromWord(m[1])) return { cmd: 'sted', place: placeFromWord(m[1]) };
  if (/^(?:jeg\s+)?er\s+(?:nå\s+)?hjemme\b|^(?:jeg\s+)?(?:kom|kommer)\s+hjem\b/.test(low)) return { cmd: 'sted', place: 'hjemme' };
  if ((m = low.match(/^(?:nå\s+)?(?:på|i)\s+([\p{L}]+)(?:\s+nå)?$/u)) && placeFromWord(m[1])) return { cmd: 'sted', place: placeFromWord(m[1]) };
  if (/^(ferdig|gjort|done)$/.test(low)) return { cmd: 'ferdig', query: '' };
  if (/sitter fast|står fast|kommer ikke i gang|klarer ikke å (starte|begynne)|får ikke (til å )?start/.test(low)) return { cmd: 'fast' };
  if (/dårlig tid|rekker ikke|for mye (å gjøre|på en gang)|stressa|stresset|har det travelt/.test(low)) return { cmd: 'travelt' };
  if (/(er|føler meg) (så )?(sliten|utslitt|tom|helt ferdig)|orker ikke/.test(low)) return { cmd: 'hvile' };
  if ((m = low.match(/^(?:jeg\s+)?(?:er\s+)?ferdig\s+med\s+(.+)/)) || (m = low.match(/^gjort:?\s+(.+)/))) return { cmd: 'ferdig', query: m[1] };
  if ((m = low.match(/^(?:jeg\s+)?har\s+(?:nå\s+|akkurat\s+)?(?:gjort|levert|sendt|ringt|kjøpt|lest|skrevet|betalt|fikset|ordnet|svart)\s+(.+)/)) && !/^(at|om|på at)\b/.test(m[1])) return { cmd: 'ferdig', query: m[1], loose: true };
  if ((m = low.match(/^(?:kan du\s+)?(?:flytt(?:e)?|utsett(?:e)?)\s+(.+?)\s+(?:til|på)\s+(.+)$/))) return { cmd: 'flytt', query: m[1], when: m[2] };
  if ((m = low.match(/^(?:kan du\s+)?(?:avlys(?:e)?|slett(?:e)?|fjern(?:e)?)\s+(.+)/))) return { cmd: 'avlys', query: m[1] };
  if ((m = low.match(/^(?:start|begynn|kjør)\s+(?:en\s+)?(?:fokus(?:økt)?|økt)\b(?:\s+(?:på|med)\s+(.+?))?(?:\s+i\s+(\d+)\s*min\w*)?$/))) return { cmd: 'fokus', query: m[1] || null, minutes: m[2] ? Number(m[2]) : null };
  if (/^(?:vis\s+)?(?:uka (?:mi|min)|tilbakeblikk)/.test(low)) return { cmd: 'uke' };
  return null;
}

// ---------------- Ting ----------------

const TASK_VERBS = 'les|lese|skriv|skrive|gjør|gjøre|fiks|fikse|ordne|ordn|bestill|bestille|betal|betale|rydd|rydde|vask|vaske|svar|svare|book|booke|sjekk|sjekke|lag|lage|øv|øve|forbered|forberede|søk|søke|meld|melde|oppdater|oppdatere|print|printe|planlegg|planlegge|send|sende|ring|ringe|fullfør|fullføre|start|starte|finn|finne|kontakt|kontakte|avtal|avtale|registrer|registrere|lever|levere|skaff|skaffe|bytt|bytte|husk|tren|trene|gå|ta|sett|sette|legg|legge|hør|høre|spør|spørre|se gjennom|gå gjennom|sove|legge meg|legg deg|spise|drikke|dusje|stå opp|slappe av|ta en pause|jobbe med';
const TASK_START = new RegExp(`^(?:${TASK_VERBS})\\b`, 'iu');
const EVENT_WORDS = /lunsj|middag|frokost|kaffe|kafé|kafe|møte|trening|tren(e|ing)?\b|time hos|tannlege|legen|lege\b|frisør|forelesning|seminar|kino|fest|konsert|date|vakt|kamp|øving|gruppearbeid|gruppemøte|veiledning|bursdag|avtale|besøk|jiu|yoga|gym|teater|intervju|kurs|samling|øvelse/i;
const DEADLINE_WORDS = /innlevering|innleveringsfrist|eksamen|hjemmeeksamen|frist|arbeidskrav|prøve\b|søknad|søknadsfrist|leveres|levere|deadline|presentasjon|pitch/i;
const BIG_WORK = /eksamen|innlever|arbeidskrav|oppgave|essay|rapport|bachelor|søknad|presentasjon|pitch|prøve\b/i;
const ERRAND_START = /^(?:kjøp|kjøpe|handle|handl|hent|hente|lever\s+tilbake|levere\s+tilbake|pant|pante|returner|returnere|plukk\s+opp|plukke\s+opp|send(?:e)?\s+pakke)\b/i;
const GROCERY = /^(melk|brød|egg|smør|ost|bananer|epler|havregryn|dopapir|tannkrem|sjampo|vaskemiddel|pasta|ris)\b/i;
const IDEA_START = /^(idé|ide|ny idé|tanke|kanskje|hva om|tenk om|tenk på|kunne vært|det hadde vært|ideen)(?=[\s:]|$)[:\s]*/i;
const STRIP_PREFIX = /^(?:husk|huske|ikke glem)\s+at\s+(?:jeg\s+)?(?:må|skal|bør)?\s*|^(?:jeg\s+)?(?:må|skal|burde|bør|trenger å)\s+(?:huske\s+(?:å\s+)?)?|^(?:husk|huske)\s+(?:å\s+)?|^ikke glem\s+(?:å\s+)?|^minne?\s+meg\s+(?:på|om)\s+(?:å\s+)?|^påminnelse:?\s*|^(?:jeg\s+)?(?:har\s+)?lovet\s+(?:å\s+)?/i;

function timeRet(when, now, settings) {
  if (!when) return null;
  if (when.timeKnown && when.start) return { type: 'tid', at: when.start };
  if (when.dayKnown) {
    const at = briefAt(when.day, settings);
    if (at > now) return { type: 'tid', at };
  }
  return null;
}

function messageItem(t0, ctx) {
  let m;
  // «send en melding til Emma om middagen», «si til emma at jeg er sen», «gi beskjed til gruppa: …»
  const re = /^(?:si|fortell|gi\s+beskjed|send(?:e)?(?:\s+(?:en\s+)?(?:melding|sms|tekstmelding|snap))?|skriv(?:e)?(?:\s+(?:en\s+)?(?:melding|sms))?|sms(?:e)?)\s+(?:til\s+)?([\p{L}][\p{L}-]*)(?:\s+(?!(?:om|at)\s)([\p{L}][\p{L}-]*))?(?:\s+(om at|at|om)\s+|\s*[:,]\s*)(.+)$/iu;
  const reBare = /^(?:send(?:e)?|skriv(?:e)?)\s+(?:en\s+)?(?:melding|sms)\s+til\s+([\p{L}][\p{L}-]*)(?:\s+([A-ZÆØÅ][\p{L}-]*))?$/u;
  const reSendName = /^send(?:e)?\s+([\p{L}][\p{L}-]*)\s+(?:en\s+)?(?:melding|sms)(?:\s+(at|om)\s+(.+))?$/iu;
  if ((m = t0.match(re)) && !/^(en|et|ei|meg|deg|det|noe|melding|sms)$/i.test(m[1])) {
    // Andre ord i navnet bare hvis det har stor forbokstav («Emma Hansen»), aldri «om» eller «at».
    const second = m[2] && /^[A-ZÆØÅ]/.test(m[2]) && !/^(om|at)$/i.test(m[2]) ? ` ${m[2]}` : '';
    if (m[2] && !second) return null;
    const to = cleanRecipient(`${m[1]}${second}`, ctx.people);
    const sep = (m[3] || '').toLowerCase();
    const body = sep === 'om' ? DRAFTS.topic(to, m[4]) : DRAFTS.tell(to, m[4]);
    return { kind: 'melding', title: `Melding til ${to}`, person: to, draft: { channel: 'sms', to, body, status: 'utkast' }, ret: { type: 'ledig' }, why: `Du ville si noe til ${to}. Utkastet venter på at du trykker send.` };
  }
  if ((m = t0.match(reBare))) {
    const to = cleanRecipient(`${m[1]}${m[2] ? ` ${m[2]}` : ''}`, ctx.people);
    return { kind: 'melding', title: `Melding til ${to}`, person: to, draft: { channel: 'sms', to, body: DRAFTS.hello(to), status: 'utkast' }, ret: { type: 'ledig' }, why: `Du ba om en melding til ${to}.` };
  }
  if ((m = t0.match(reSendName))) {
    const to = cleanRecipient(m[1], ctx.people);
    const body = m[3] ? (m[2] === 'at' ? DRAFTS.tell(to, m[3]) : DRAFTS.topic(to, m[3])) : DRAFTS.hello(to);
    return { kind: 'melding', title: `Melding til ${to}`, person: to, draft: { channel: 'sms', to, body, status: 'utkast' }, ret: { type: 'ledig' }, why: `Du ba om en melding til ${to}.` };
  }
  return null;
}

function emailItem(t0, ctx) {
  const m = t0.match(/^(?:send(?:e)?|skriv(?:e)?|lag(?:e)?|svar(?:e)?\s+på)\s+(?:en\s+)?(?:e-?post(?:en)?|epost(?:en)?|mail(?:en)?|mejl)\s+(?:til\s+|fra\s+)?(.+?)(?:\s+(?:om|angående|ang\.?|med spørsmål om)\s+(.+))?$/iu);
  if (!m) return null;
  const rawTo = m[1].trim();
  const address = /^\S+@\S+\.\S+$/.test(rawTo) ? rawTo : '';
  const to = address ? address : cleanRecipient(rawTo, ctx.people);
  const subject = m[2] ? cap(tidy(m[2])) : '';
  return {
    kind: 'epost', title: `E-post til ${to}${subject ? `: ${subject}` : ''}`, person: to,
    draft: { channel: 'epost', to, address, subject, body: DRAFTS.email(to, subject, ctx.userName), status: 'utkast' },
    ret: { type: 'ledig' }, why: 'Utkastet er klart. Fyll inn det som står i klammer, og send når du vil.',
  };
}

/** Én setning → én ting. ctx = {now, people, userName, settings}. */
export function sortClause(clause, ctx) {
  const { now } = ctx;
  const settings = { ...DEFAULT_SETTINGS, ...(ctx.settings || {}) };
  const t = tidy(String(clause).replace(POLITE, '').replace(/\s*\?+\s*$/, ''));
  const t0 = t.charAt(0).toLocaleLowerCase('nb') + t.slice(1);
  const low = t.toLocaleLowerCase('nb');
  let m;

  // Meldinger og e-post
  const mail = emailItem(t0, ctx);
  if (mail) return mail;
  const msg = messageItem(t0, ctx);
  if (msg) return msg;

  // «spør Emma om notatene» → kommer tilbake når du har kontakt med Emma
  if ((m = t0.match(/^(?:husk\s+(?:å\s+)?)?(?:spør|spørre|minn)\s+([\p{L}]+)\s+(?:om\s+)?(.+)$/iu)) && !/^meg$/i.test(m[1])) {
    const person = cleanRecipient(m[1], ctx.people);
    return { kind: 'oppgave', title: `Spør ${person} om ${tidy(m[2])}`, person, estimateMin: 5, workType: 'samtale', ret: { type: 'person', person }, why: `Den kommer tilbake neste gang du har kontakt med ${person}.` };
  }

  // Idé
  if (IDEA_START.test(t)) {
    const title = cap(tidy(t.replace(IDEA_START, ''))) || cap(t);
    return { kind: 'ide', title, ret: { type: 'uke' }, why: 'Idéer kommer tilbake søndag, når du har ro til å se på dem.' };
  }

  // Ærend
  const errandText = t.replace(STRIP_PREFIX, '');
  if (ERRAND_START.test(errandText) || GROCERY.test(errandText) || /(?<![\p{L}])(hentes|kjøpes|leveres tilbake|pantes)(?![\p{L}])/iu.test(errandText)) {
    const due = parseDue(errandText, now);
    const place = guessPlace(errandText);
    const title = cap(removePhrases(errandText, [due?.phrase]));
    return { kind: 'handle', title, place, due: due?.due || null, ret: { type: 'sted', place }, why: `Ærend, så det kommer når du er ${PLACES[place]}.` };
  }

  const travel = t.match(/,?\s*(\d+)\s*min(?:utter)?\s+(?:reise|reisetid|å gå|å kjøre|gange)/i);
  const tt = travel ? tidy(t.replace(travel[0], ' ')) : t;
  const when = parseWhen(tt, now);
  const dueRaw = parseDue(tt, now);
  // En frist krever et fristord («før», «innen», «senest») eller et ord som innlevering/eksamen.
  const due = dueRaw && (/\b(før|innen|senest|til)\b/i.test(dueRaw.phrase) || DEADLINE_WORDS.test(low)) ? dueRaw : null;
  const est = parseEstimate(tt);

  // «gruppemøte neste uke»: ingen dag ennå, så den kommer tilbake mandag morgen
  if (when?.vague && !TASK_START.test(t0.replace(STRIP_PREFIX, ''))) {
    return { kind: 'notat', title: cap(removePhrases(tt, when.phrases)), ret: { type: 'tid', at: briefAt(when.day, settings) }, why: `Ingen dag ennå. Den kommer tilbake ${retLabel({ type: 'tid', at: briefAt(when.day, settings) }, now)}, så du kan bestemme den da.` };
  }

  // Informasjon og usikre planer: «Emma sa at eksamen er flyttet», «lurer på om vi skal ta kaffe»
  if (/(?<![\p{L}])(sa|sier|skrev|fortalte|hørte|leste|las) at(?![\p{L}])|(?<![\p{L}])(lurer på|tror|kanskje|vurderer|usikker på|hvis)(?![\p{L}])/iu.test(low) && !STRIP_PREFIX.test(t)) {
    const who = detectPerson(t, ctx.people);
    return { kind: 'notat', title: cap(t), person: who || null, ret: who ? { type: 'person', person: who } : { type: 'morgen' }, why: who ? `Lagret som et notat. Det kommer tilbake neste gang du har kontakt med ${who}.` : 'Lagret som et notat. Du får bestemme hva det er i morgenbriefen.' };
  }

  // Frist med steg
  const words = t.split(/\s+/).length;
  if ((DEADLINE_WORDS.test(low) && (due || when?.dayKnown) && !TASK_START.test(t0.replace(STRIP_PREFIX, '')) && words <= 14) || (/^(eksamen|innlevering|hjemmeeksamen|frist)\b/i.test(t) && (due || when?.dayKnown))) {
    const dueHasTime = !!(when?.timeKnown && when.start > now);
    const dueT = dueHasTime ? when.start : due?.due ?? addDays(startOfDay(when.day), 1);
    const title = cap(removePhrases(tt.replace(STRIP_PREFIX, ''), [due?.phrase, ...(when?.phrases || [])]).replace(/^(er|på|den)\s+/i, '')) || 'Frist';
    const big = BIG_WORK.test(low) && dueT - now > 2 * DAY;
    const plan = big ? planSteps(title, dueT, now) : null;
    return {
      kind: 'frist', title, due: dueT, dueHasTime, steps: plan?.steps || [], template: plan?.template || null,
      ret: { type: 'ledig' }, important: true,
      why: plan ? (plan.tight ? `Fristen er delt i ${plan.steps.length} steg. Det blir trangt, så noen dager får to.` : plan.spacing > 1 ? `Fristen er delt i ${plan.steps.length} steg, spredt fram mot fristen. Hvert steg kommer tilbake på sin dag.` : `Fristen er delt i ${plan.steps.length} steg, ett om dagen.`) : 'Frist lagt inn. Den blir viktigere jo nærmere den kommer.',
    };
  }

  // Avtale
  const knownRe = (ctx.people || []).map((p) => (typeof p === 'string' ? p : p?.name)).filter(Boolean).join('|');
  const withName = tt.match(new RegExp(`(?:med|hos)\\s+([A-ZÆØÅ][\\p{Ll}]+|mamma|pappa|mormor|morfar|farmor|farfar|gruppa|gruppen|klassen${knownRe ? `|${knownRe.toLocaleLowerCase('nb')}` : ''})`, 'u'));
  const range = parseTimeRange(tt);
  const shift = /(?<![\p{L}])(jobb|jobben|vakt|skift)(?![\p{L}])/iu.test(low) && range;
  if (range && (when?.dayKnown || shift || EVENT_WORDS.test(low))) {
    const dayT = when?.dayKnown ? startOfDay(when.day) : startOfDay(now);
    let start = atTime(dayT, range.start);
    if (!when?.dayKnown && start < now) start = atTime(addDays(dayT, 1), range.start);
    const end = atTime(startOfDay(start), range.end);
    const title = cap(removePhrases(tt, [...(when?.phrases || []).filter((p) => !range.phrase.includes(p)), range.phrase]).replace(/^(jeg\s+)?(skal|har|må)\s+(på\s+)?/i, '').replace(/\s+(fra|kl\.?)$/i, '')) || 'Avtale';
    return { kind: 'avtale', title, start, end, person: withName && !['gruppa', 'gruppen', 'klassen'].includes(withName[1]) ? cap(withName[1]) : null, ret: start - 15 * MIN > now ? { type: 'tid', at: start - 15 * MIN } : { type: 'ledig' }, why: `Lagt inn ${fmtDate(start)} ${range.start}–${range.end}. Du får beskjed 15 minutter før.` };
  }
  if (when && (when.timeKnown || when.dayKnown) && !when.vague && (EVENT_WORDS.test(low) || withName) && !TASK_START.test(t0.replace(STRIP_PREFIX, ''))) {
    const durM = est?.minutes || defaultDuration(tt);
    const title = cap(removePhrases(tt, [...when.phrases, est?.phrase]).replace(/^(jeg\s+)?(skal|har|må)\s+(på\s+)?/i, '')) || 'Avtale';
    const person = withName && !['gruppa', 'gruppen', 'klassen'].includes(withName[1]) ? cap(withName[1]) : null;
    if (!when.timeKnown) {
      return { kind: 'avtale', title, start: startOfDay(when.day), end: addDays(startOfDay(when.day), 1), allDay: true, person, ret: timeRet(when, now, settings) || { type: 'morgen' }, why: `Lagt inn ${when.label}. Du har ikke sagt klokkeslett, så den står som hele dagen.` };
    }
    const travelMin = travel ? Number(travel[1]) : null;
    const remind = when.start - ((travelMin || 0) + 15) * MIN;
    return {
      kind: 'avtale', title, start: when.start, end: when.start + durM * MIN, person, travelMin,
      ret: remind > now ? { type: 'tid', at: remind } : { type: 'ledig' },
      why: `Lagt inn ${when.label}. Du får beskjed ${travelMin ? 'når du må gå' : '15 minutter før'}.`,
    };
  }

  // Oppgave
  const stripped = tt.replace(STRIP_PREFIX, '');
  const isReminder = /^(minne? meg|påminnelse|husk|ikke glem)/i.test(t);
  const looksTask = TASK_START.test(stripped) || STRIP_PREFIX.test(t) || isReminder;
  if (/^(?:husk|ikke glem)\s+at\b/i.test(t) && !TASK_START.test(stripped)) {
    const who = detectPerson(stripped, ctx.people) || (ctx.people || []).map((p) => (typeof p === 'string' ? p : p?.name)).find((n) => n && new RegExp(`(?<![\\p{L}])${n}(?![\\p{L}])`, 'iu').test(stripped));
    if (who) return { kind: 'notat', title: cap(stripped), person: who, ret: { type: 'person', person: who }, why: `Den kommer tilbake neste gang du har kontakt med ${who}.` };
  }
  if (looksTask) {
    const phrases = [...(when?.phrases || []), due?.phrase, est?.phrase];
    let title = cap(removePhrases(stripped, phrases));
    const workType = detectWorkType(t);
    const call = stripped.match(/^ring(?:e)?\s+(?:til\s+)?(.+)$/i);
    const person = detectPerson(call ? `x ${call[1]}` : stripped, ctx.people);
    if (call) title = cap(removePhrases(`Ring ${call[1]}`, phrases));
    let ret = null;
    if (when?.timeKnown) ret = timeRet(when, now, settings);
    else if (isReminder && when?.dayKnown) ret = timeRet(when, now, settings);
    else if (due) ret = due.due - now > 2 * DAY ? { type: 'tid', at: briefAt(addDays(startOfDay(due.due - 1), -1), settings) } : { type: 'ledig' };
    else if (when?.dayKnown) ret = timeRet(when, now, settings);
    if (!ret && /i kveld/.test(low)) ret = { type: 'kveld' };
    if (!ret) ret = { type: 'ledig' };
    const why = ret.type === 'tid' ? `Den kommer tilbake ${retLabel(ret, now)}.`
      : ret.type === 'morgen' ? 'Den kommer tilbake i morgenbriefen.'
        : ret.type === 'kveld' ? 'Den kommer tilbake i kveld.'
          : due ? `Frist ${due.label}. Den blir foreslått når du har ledig tid.` : 'Ingen tid nevnt, så den blir foreslått når du har ledig tid.';
    return {
      kind: 'oppgave', title, due: due?.due || null, estimateMin: est?.minutes || (call ? 10 : DEFAULT_ESTIMATE[workType] || 30), workType,
      person: person || null, important: /viktig|haster|må bare/i.test(low), ret, why,
    };
  }

  // Noe om en person uten verb: «Jonas har laderen min»
  const person = detectPerson(t, ctx.people);
  if (person && t.split(/\s+/).length <= 14) {
    return { kind: 'notat', title: cap(t), person, ret: { type: 'person', person }, why: `Den kommer tilbake neste gang du har kontakt med ${person}.` };
  }

  // Resten er notater du får bestemme over i morgenbriefen
  return { kind: 'notat', title: cap(t), ret: { type: 'morgen' }, why: 'Ingen plan ennå. Du får bestemme hva den er i morgenbriefen.' };
}

/** Deler teksten i setninger, og på «og» bare når neste del starter med et verb. */
export function splitClauses(text) {
  const parts = String(text || '').split(/(?<=[\p{L})][.!?]|[!?])\s+|(?<=\p{N}\.)\s+(?=\p{Lu})|\n+|;\s*/u).map((s) => s.trim()).filter(Boolean);
  const verb = new RegExp(`^(?:${TASK_VERBS}|kjøp|kjøpe|handle|hent|hente|si|fortell|spør|husk|minn|må|skal|jeg må|jeg skal)(?![\\p{L}])`, 'iu');
  const out = [];
  for (const p of parts) {
    const sub = p.split(/,?\s+og\s+(?:så\s+)?|,\s+(?=(?:si|send|kjøp|ring|husk|spør)\b)/i);
    let cur = sub[0];
    for (let i = 1; i < sub.length; i++) {
      if (verb.test(sub[i])) { out.push(cur); cur = sub[i]; } else cur += ` og ${sub[i]}`;
    }
    out.push(cur);
  }
  return out.map((s) => s.replace(/[.!]+$/, '').trim()).filter(Boolean);
}

/**
 * Sorterer en hel fangst. Returnerer {items, commands, questions}.
 * Spørsmål og kommandoer tas ut først; resten blir ting.
 */
export function sortCapture(text, ctx) {
  const items = [];
  const commands = [];
  const questions = [];
  const raw = String(text || '').trim();
  const whole = POLITE.test(raw) ? raw.replace(POLITE, '').replace(/\s*\?+\s*$/, '') : raw;
  if (!whole) return { items, commands, questions };
  const wc = parseCommand(whole);
  if (wc && !/\b(og|så)\s+(husk|kjøp|si|send|ring)\b/i.test(whole)) return { items, commands: [wc], questions };
  const q = parseQuestion(whole, ctx.now);
  if (q && !/\b(og|så)\s+(husk|kjøp|si|send|ring)\b/i.test(whole)) return { items, commands, questions: [q] };
  for (const clause of splitClauses(whole)) {
    const c = parseCommand(clause);
    if (c) { commands.push(c); continue; }
    const cq = parseQuestion(clause, ctx.now);
    if (cq) { questions.push(cq); continue; }
    const item = sortClause(clause, ctx);
    if (item) items.push({ ...item, text: clause });
  }
  return { items, commands, questions };
}

/** Tekst brukeren skriver for å endre tilbakekomst: «i morgen kl 9», «når jeg er på butikken», «søndag». */
export function parseRetText(text, now, settings = DEFAULT_SETTINGS) {
  const t = String(text || '').trim();
  const low = t.toLocaleLowerCase('nb');
  let m;
  if ((m = low.match(/(?:når|neste gang)\s+jeg\s+(?:er|kommer)\s+(?:på|i|til)\s+([\p{L}]+)/u)) && placeFromWord(m[1])) return { type: 'sted', place: placeFromWord(m[1]) };
  if (/(?:når|neste gang)\s+jeg\s+(?:er|kommer)\s+hjem/.test(low)) return { type: 'sted', place: 'hjemme' };
  if ((m = t.match(/(?:snakker|møter|skriver)\s+(?:med|til)?\s*([\p{L}]+)/iu))) return { type: 'person', person: cleanRecipient(m[1]) };
  if (/morgenbrief|i morgen tidlig/.test(low)) return { type: 'morgen' };
  if (/i kveld|kveldsavslutning/.test(low) && !/kl/.test(low)) return { type: 'kveld' };
  if (/ledig|når jeg har tid/.test(low)) return { type: 'ledig' };
  if (/arkiv|aldri|bare søk/.test(low)) return { type: 'arkiv' };
  if (/^søndag$|uka di|ukesoppsummering/.test(low)) return { type: 'uke' };
  const when = parseWhen(t, now);
  const r = timeRet(when, now, settings);
  if (r?.type === 'tid' && r.at <= now) return null;
  return r;
}

/** Finn tingen brukeren mener («middagen med Sara», «kap 4»). */
export function findThing(query, things = [], { minScore = 2 } = {}) {
  const q = String(query || '').toLocaleLowerCase('nb').replace(/^(den|det|med|på)\s+/, '').trim();
  if (!q) return null;
  const words = q.split(/\s+/).filter((w) => w.length > 2 && !['med', 'den', 'det', 'til', 'for', 'min', 'mitt'].includes(w));
  let best = null;
  let bestScore = 0;
  for (const th of things) {
    if (th.status !== 'aktiv') continue;
    const title = `${th.title} ${th.person || ''}`.toLocaleLowerCase('nb');
    let score = title.includes(q) ? 10 : 0;
    for (const w of words) if (title.includes(w.replace(/(en|et|a|ene)$/, ''))) score += 2;
    if (score > bestScore) { best = th; bestScore = score; }
  }
  return bestScore >= minScore ? best : null;
}

/** Kort menneskelig tekst om hva som ble lagret. Sier aldri «Gjort» om noe som ikke er gjort. */
export function savedLine(item, now) {
  const r = retLabel(item.ret, now);
  switch (item.kind) {
    case 'melding': return `Utkast til ${item.person} er klart. Det sendes ikke før du trykker.`;
    case 'epost': return `E-postutkast til ${item.person} er klart. Det sendes ikke før du trykker.`;
    case 'avtale': return item.allDay ? `${item.title} står i kalenderen ${fmtDate(item.start)}.` : `${item.title} står i kalenderen ${fmtDate(item.start)} kl. ${hhmm(item.start)}.`;
    case 'frist': return `${item.title} er lagt inn med frist ${fmtDate(item.due - 1)}${item.steps?.length ? ` og ${item.steps.length} steg` : ''}.`;
    case 'handle': return `«${item.title}» kommer ${r}.`;
    case 'ide': return `Idéen er lagret. Den kommer ${r}.`;
    default: return `«${item.title}» kommer ${r}.`;
  }
}
