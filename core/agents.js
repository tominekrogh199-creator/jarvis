// Kjerne · agentene. Hvem som gjør hva, med hvilke verktøy og hvilke grenser.
// Arkitekturen er den samme som i agent-apper som Grok Bot: en språkmodell i en løkke med verktøy,
// koblinger til kontoene dine, faste rutiner, minne og en godkjenningskø. Her er alt bygget på Claude.
// Ren logikk: register, kommandoer, tilpasning av argumenter til verktøyenes skjema og lesing av svar.

export const AGENTS = [
  {
    id: 'planlegger', name: 'Planleggeren', icon: 'plan',
    role: 'Legger frister inn i ledig tid, bakover fra fristen, og flytter økter som glapp eller kolliderer.',
    tools: ['Kalenderen i appen', 'Fristene dine'],
    rights: 'Gjør selv, du kan angre alt.',
    routine: 'Når du fanger en frist, og hvert kvarter mens appen er åpen.',
  },
  {
    id: 'post', name: 'Postagenten', icon: 'mail',
    role: 'Leser Gmail og finner det som angår deg: frister, beskjeder fra forelesere og e-post som venter på svar. Lager svarutkast.',
    tools: ['Gmail: søk', 'Gmail: les tråd', 'Gmail: send (bare med ja)'],
    rights: 'Leser selv. Sender aldri uten at du trykker Send.',
    routine: 'Når du ber om det («sjekk mailen»), og om morgenen hvis du slår det på.',
    server: 'Gmail',
  },
  {
    id: 'kalender', name: 'Kalenderagenten', icon: 'calendar',
    role: 'Henter Google Kalender inn i dagen din, og legger øktene dine i kalenderen så telefonen varsler deg.',
    tools: ['Google Kalender: les', 'Google Kalender: lag avtale (bare med ja)'],
    rights: 'Leser selv. Skriver bare med ditt ja.',
    routine: 'Når appen åpnes, og hver halvtime mens den er åpen.',
    server: 'Google Calendar',
  },
  {
    id: 'budbringer', name: 'Budbringeren', icon: 'message',
    role: 'Skriver utkast til meldinger og e-post med det du vil si. E-post kan sendes via Gmail når du trykker Send; SMS sender du selv.',
    tools: ['Utkast', 'Gmail: send (bare med ja)'],
    rights: 'Lager utkast. Sender bare når du trykker.',
    routine: 'Når du skriver «si til …» eller «send e-post til …».',
  },
  {
    id: 'paminner', name: 'Påminneren', icon: 'bell',
    role: 'Sier fra når noe skal komme tilbake, når en økt starter og når noe skal leveres. Sender morgen- og kveldsmelding til telefonen.',
    tools: ['Varsler i appen', 'Planlagte oppgaver på claude.ai'],
    rights: 'Maks fem dytt om dagen. Det du ser på, gir ikke dytt.',
    routine: 'Hvert minutt mens appen er åpen, og morgen og kveld fra skyen.',
  },
  {
    id: 'rydding', name: 'Rydderen', icon: 'archive',
    role: 'Rydder om natten og når du kommer tilbake: ting som ble liggende, kommer tilbake i morgenbriefen i stedet for å hope seg opp.',
    tools: ['Tingene dine'],
    rights: 'Gjør selv, sletter aldri, du kan angre alt.',
    routine: 'Kl. 04 hver natt, og etter en pause på over et døgn.',
  },
];

export const AGENT_NAME = Object.fromEntries(AGENTS.map((a) => [a.id, a.name]));

/** Verktøyene appen ber om tilgang til. Eksakte navn fra koblingene på claude.ai. */
export const CONNECTOR_TOOLS = {
  Gmail: ['search_threads', 'get_thread', 'create_draft', 'send_message'],
  'Google Calendar': ['list_events', 'create_event', 'update_event'],
};

/** «sjekk mailen», «hent kalenderen», «legg øktene i kalenderen». Hele setningen må være kommandoen. Returnerer {agent, task} eller null. */
const FILL = '(?:\\s+(?:min|mine|for meg|nå|i dag|takk|da|igjen|kjapt|raskt|fort))*';
const ASK = '(?:(?:kan|vil|kunne) du\\s+)?';
const MAILW = '(?:mailen|mailene|mail|e-?posten|e-?postene|innboksen|gmail(?:en)?|inboxen)';
const AGENT_RULES = [
  [new RegExp(`^${ASK}(?:sjekke?|se på|se gjennom|gå gjennom|lese?|oppsummere?|rydde? i)\\s+${MAILW}${FILL}$`), { agent: 'post', task: 'sjekk' }],
  [new RegExp(`^(?:har jeg fått|er det kommet|fikk jeg|kom det)\\s+(?:(?:noen|noe|ny|nye|viktige?)\\s+)*(?:mail|mailer|e-?post(?:er)?)${FILL}$`), { agent: 'post', task: 'sjekk' }],
  [new RegExp(`^(?:noe nytt|nytt|noe viktig)\\s+(?:på|i)\\s+${MAILW}${FILL}$`), { agent: 'post', task: 'sjekk' }],
  [new RegExp(`^${ASK}se om jeg har fått (?:noen\\s+|noe\\s+)?(?:mail|mailer|e-?post(?:er)?)${FILL}$`), { agent: 'post', task: 'sjekk' }],
  [new RegExp(`^${ASK}(?:hent|hente|synk|synke|synkroniser|synkronisere|oppdater|oppdatere|les inn|lese inn)\\s+(?:inn\\s+)?(?:google[\\s-]+)?(?:kalenderen|kalender)(?:\\s+min)?${FILL}$`), { agent: 'kalender', task: 'hent' }],
  [new RegExp(`^${ASK}(?:legg|legge|sett|sette|før|føre)\\s+(?:alle\\s+)?(?:øktene|planen|planene|arbeidsøktene)(?:\\s+mine)?\\s+(?:inn\\s+)?i\\s+(?:google[\\s-]+)?kalender(?:en)?${FILL}$`), { agent: 'kalender', task: 'skriv' }],
  [new RegExp(`^${ASK}(?:planlegg|planlegge|gå gjennom)\\s+(?:alle\\s+)?(?:fristene|frister)(?:\\s+mine)?${FILL}$`), { agent: 'planlegger', task: 'uke' }],
  [new RegExp(`^${ASK}(?:planlegg|planlegge)\\s+(?:uka|uken)(?:\\s+min)?${FILL}$`), { agent: 'planlegger', task: 'uke' }],
];

export function agentCommand(text) {
  const t = String(text || '').trim().toLocaleLowerCase('nb').replace(/\s+/g, ' ').replace(/[?.!]+$/, '').trim();
  for (const [re, cmd] of AGENT_RULES) if (re.test(t)) return { ...cmd };
  return null;
}

const SYN = {
  query: ['query', 'q', 'search_query', 'searchQuery', 'search'],
  max: ['max_results', 'maxResults', 'page_size', 'pageSize', 'limit', 'max'],
  threadId: ['thread_id', 'threadId', 'replyThreadId'],
  to: ['to', 'recipients', 'recipient', 'to_recipients', 'toRecipients'],
  subject: ['subject'],
  body: ['body', 'body_text', 'bodyText', 'plain_text_body', 'text', 'content', 'message'],
  calendarId: ['calendar_id', 'calendarId'],
  timeMin: ['time_min', 'timeMin', 'start_time', 'startTime', 'start_date', 'min_time', 'from'],
  timeMax: ['time_max', 'timeMax', 'end_time', 'endTime', 'end_date', 'max_time', 'until'],
  summary: ['summary', 'title', 'name'],
  description: ['description', 'details', 'notes'],
  start: ['start', 'start_time', 'startTime', 'start_datetime', 'startDateTime'],
  end: ['end', 'end_time', 'endTime', 'end_datetime', 'endDateTime'],
  timeZone: ['time_zone', 'timeZone', 'timezone'],
  eventId: ['event_id', 'eventId', 'id'],
  reminders: ['overrideReminders', 'override_reminders', 'reminders'],
  format: ['messageFormat', 'message_format'],
};

function typeOf(prop) {
  const t = prop?.type || prop?.anyOf?.find((x) => x.type && x.type !== 'null')?.type || prop?.oneOf?.find((x) => x.type && x.type !== 'null')?.type;
  return Array.isArray(t) ? t.find((x) => x !== 'null') : t;
}

/** Velger objekt-varianten i anyOf/oneOf når verdien er en tidsstreng. */
function objectVariant(prop) {
  if (prop?.properties) return prop;
  return (prop?.anyOf || prop?.oneOf || []).find((x) => x?.type === 'object' && x.properties) || null;
}

function coerce(prop, value, key) {
  const ov = objectVariant(prop);
  if (ov && typeof value === 'string' && ['start', 'end'].includes(key)) {
    const inner = ov.properties;
    if ('dateTime' in inner || 'date_time' in inner) return { ['dateTime' in inner ? 'dateTime' : 'date_time']: value, ...('timeZone' in inner ? { timeZone: 'Europe/Oslo' } : 'time_zone' in inner ? { time_zone: 'Europe/Oslo' } : {}) };
  }
  const type = typeOf(prop);
  if (type === 'array') {
    if (Array.isArray(value)) return value;
    if (key === 'to') return String(value).split(/[,;]\s*/).filter(Boolean);
    return [value];
  }
  if (type === 'integer' || type === 'number') return Number(value);
  if (type === 'object' && typeof value === 'string') {
    const inner = prop.properties || {};
    if ('dateTime' in inner || 'date_time' in inner) return { ['dateTime' in inner ? 'dateTime' : 'date_time']: value, ...('timeZone' in inner ? { timeZone: 'Europe/Oslo' } : 'time_zone' in inner ? { time_zone: 'Europe/Oslo' } : {}) };
  }
  if (type === 'string' && Array.isArray(value)) return value.join(', ');
  return value;
}

/**
 * Tilpasser det appen vil sende, til verktøyets eget skjema (fra describeTool).
 * wanted: {query, max, threadId, to, subject, body, calendarId, timeMin, timeMax, summary, description, start, end, timeZone}
 * Returnerer {args, missing}: missing er påkrevde felt appen ikke kunne fylle.
 * Uten skjema brukes det vanligste navnet (snake_case).
 */
export function fitArgs(schema, wanted) {
  const props = schema?.properties;
  const out = {};
  if (!props) {
    for (const [k, v] of Object.entries(wanted)) if (v != null) out[(SYN[k] || [k])[0]] = v;
    return { args: out, missing: [], guessed: true };
  }
  const used = new Set();
  for (const [key, value] of Object.entries(wanted)) {
    if (value == null) continue;
    const name = (SYN[key] || [key]).find((n) => n in props && !used.has(n));
    if (!name) continue;
    used.add(name);
    out[name] = coerce(props[name], value, key);
  }
  const missing = (schema.required || []).filter((r) => !(r in out));
  return { args: out, missing, guessed: false };
}

/** Lokal tid uten forskyvning, slik Google Kalender-koblingen vil ha det: 2026-10-14T12:00:00. */
export function isoNaive(t) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

/** Lokal tid med UTC-forskyvning: 2026-10-14T12:00:00+02:00. */
export function isoLocal(t) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00${off >= 0 ? '+' : '-'}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
}

function parseTime(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v > 1e12 ? { t: v, allDay: false } : { t: v * 1000, allDay: false };
  if (typeof v === 'object') {
    const dt = v.dateTime || v.date_time || v.datetime;
    if (dt) return parseTime(dt);
    // Heldag: «date» kan komme som 2026-10-10 eller 2026-10-10T00:00:00Z. Datoen gjelder, ikke klokka.
    const m = String(v.date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? { t: new Date(+m[1], +m[2] - 1, +m[3]).getTime(), allDay: true } : null;
  }
  const s = String(v).trim();
  const d = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (d) return { t: new Date(+d[1], +d[2] - 1, +d[3]).getTime(), allDay: true };
  const t = Date.parse(s);
  return Number.isFinite(t) ? { t, allDay: false } : null;
}

/**
 * Finner avtaler i et svar fra en kalenderkobling, uansett hvordan svaret er pakket inn.
 * Returnerer [{uid, title, start, end, allDay, place}], sortert.
 */
export function findEvents(payload) {
  const out = [];
  const seen = new Set();
  const walk = (x, depth) => {
    if (!x || depth > 6) return;
    if (typeof x === 'string') { try { if (/^[[{]/.test(x.trim())) walk(JSON.parse(x), depth + 1); } catch { /* ikke JSON */ } return; }
    if (Array.isArray(x)) { for (const y of x) walk(y, depth + 1); return; }
    if (typeof x !== 'object') return;
    const title = x.summary ?? x.title ?? x.name;
    const s = parseTime(x.start ?? x.start_time ?? x.startTime ?? x.start_date ?? x.startDate);
    if (typeof title === 'string' && s) {
      const e = parseTime(x.end ?? x.end_time ?? x.endTime ?? x.end_date ?? x.endDate);
      const uid = String(x.id ?? x.event_id ?? x.eventId ?? x.iCalUID ?? `${title}@${s.t}`);
      const self = Array.isArray(x.attendees) ? x.attendees.find((a) => a && a.self) : null;
      const declined = String(x.responseStatus || x.response_status || self?.responseStatus || self?.response_status || '').toLowerCase() === 'declined';
      if (!seen.has(uid) && String(x.status || '').toLowerCase() !== 'cancelled' && !declined) {
        seen.add(uid);
        const end = e ? e.t : s.t + (s.allDay ? 86400000 : 3600000);
        out.push({ uid, title: title.trim() || 'Avtale', start: s.t, end: end > s.t ? end : s.t + 3600000, allDay: s.allDay, place: typeof x.location === 'string' ? x.location : null });
      }
      return;
    }
    for (const v of Object.values(x)) if (v && typeof v === 'object') walk(v, depth + 1); else if (typeof v === 'string' && v.length > 20) walk(v, depth + 1);
  };
  walk(payload, 0);
  return out.sort((a, b) => a.start - b.start);
}

/** Avtaler Jarvis selv har lagt i Google Kalender, skal ikke hentes tilbake som nye avtaler. */
export const isOwnEvent = (e) => /^jarvis:/i.test(e.title || '');

/** Gjør et verktøysvar lite nok til å sendes tilbake til Claude. */
export function compact(payload, max = 12000) {
  let s;
  try { s = typeof payload === 'string' ? payload : JSON.stringify(payload); } catch { s = String(payload); }
  return s.length > max ? `${s.slice(0, max)} …(kortet ned)` : s;
}

/** Skjema for Claude-verktøy må være små (maks 4 KB). Fjerner beskrivelser til det passer. */
export function trimSchema(schema, fallback) {
  if (!schema || schema.type !== 'object') return fallback;
  let s = JSON.parse(JSON.stringify(schema));
  if (JSON.stringify(s).length <= 3800) return s;
  const strip = (o) => { if (o && typeof o === 'object') { delete o.description; delete o.examples; delete o.title; for (const v of Object.values(o)) strip(v); } };
  strip(s);
  if (JSON.stringify(s).length <= 3800) return s;
  s = { type: 'object', properties: Object.fromEntries(Object.entries(s.properties || {}).slice(0, 12).map(([k, v]) => [k, { type: typeOf(v) || 'string' }])), required: s.required || [] };
  return JSON.stringify(s).length <= 3800 ? s : fallback;
}

/** Kontrollerer et forslag Claude la i køen. Returnerer et rent forslag eller null. */
export function validateProposal(kind, input, now) {
  const str = (v, n) => String(v ?? '').trim().slice(0, n);
  if (kind === 'ting') {
    const k = ['frist', 'oppgave', 'avtale'].includes(input.kind) ? input.kind : 'oppgave';
    const title = str(input.title, 120);
    if (!title) return null;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(input.date || '')) ? String(input.date) : null;
    const time = /^\d{1,2}:\d{2}$/.test(String(input.time || '')) ? String(input.time).padStart(5, '0') : null;
    let at = null;
    if (date) {
      const [y, m, d] = date.split('-').map(Number);
      const [hh, mm] = (time || '00:00').split(':').map(Number);
      at = new Date(y, m - 1, d, hh, mm).getTime();
      if (!Number.isFinite(at) || at < now - 86400000 || at > now + 400 * 86400000) at = null;
    }
    if ((k === 'frist' || k === 'avtale') && !at) return { kind: 'oppgave', title, why: str(input.why, 240), from: str(input.from, 80), date: null, time: null };
    return { kind: k, title, at, hasTime: !!time, why: str(input.why, 240), from: str(input.from, 80) };
  }
  if (kind === 'epost') {
    const to = str(input.to, 200);
    const body = str(input.body, 4000);
    if (!/@/.test(to) || !body) return null;
    return { to, subject: str(input.subject, 160), body, threadId: str(input.thread_id || input.threadId, 120) || null, why: str(input.why, 240) };
  }
  return null;
}
