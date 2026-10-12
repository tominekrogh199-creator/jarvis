// Kjerne · enkel lesing av kalenderfiler (.ics) fra Google, Apple eller Outlook.

function unfold(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

function unescape(v) {
  return String(v).replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim();
}

/** «20261007T114500Z», «20261007T114500» eller «20261007» → tid i ms. */
export function parseIcsDate(value, params = '') {
  const m = String(value).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, hh = '00', mi = '00', ss = '00', z] = m;
  if (z) return Date.UTC(+y, +mo - 1, +d, +hh, +mi, +ss);
  return new Date(+y, +mo - 1, +d, +hh, +mi, +ss).getTime();
}

/** Returnerer [{uid, title, start, end, place, allDay}] fra en .ics-tekst. Gjentakelser utvides ikke. */
export function parseIcs(text, { from = -Infinity, to = Infinity } = {}) {
  const lines = unfold(text).split('\n');
  const out = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') {
      if (cur?.start) {
        const allDay = cur.allDay;
        const end = cur.end || (allDay ? cur.start + 86400000 : cur.start + 3600000);
        if (end >= from && cur.start <= to) out.push({ uid: cur.uid || null, title: cur.title || 'Avtale', start: cur.start, end, place: cur.place || '', allDay });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const head = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const [name, ...params] = head.split(';');
    const p = params.join(';');
    if (name === 'SUMMARY') cur.title = unescape(value);
    else if (name === 'LOCATION') cur.place = unescape(value);
    else if (name === 'UID') cur.uid = value.trim();
    else if (name === 'DTSTART') { cur.start = parseIcsDate(value, p); cur.allDay = /VALUE=DATE(?!-)/.test(p) || /^\d{8}$/.test(value.trim()); }
    else if (name === 'DTEND') cur.end = parseIcsDate(value, p);
  }
  return out.sort((a, b) => a.start - b.start);
}
