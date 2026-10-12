// Kjerne · påminnelser utenfor appen: en lenke som legger tingen i Google Kalender, og en .ics-fil med alarm.
// Det er den ærlige måten en nettapp kan nå låseskjermen på: telefonens egen kalender varsler.
import { MIN } from './time.js';

const z = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Lenke som åpner Google Kalender med hendelsen ferdig utfylt. Brukeren trykker Lagre selv. */
export function googleCalendarLink({ title, start, end = null, details = '' }) {
  const e = end || start + 15 * MIN;
  const q = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${z(start)}/${z(e)}`, details });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

function esc(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\;');
}

/** .ics med alarm. iPhone åpner den i Kalender. */
export function icsFor({ title, start, end = null, alarmMin = 0, description = '', uid = null }) {
  const e = end || start + 15 * MIN;
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Jarvis//NO', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:${uid || `${start}-${Math.random().toString(36).slice(2, 8)}`}@jarvis`,
    `DTSTAMP:${z(Date.now())}`, `DTSTART:${z(start)}`, `DTEND:${z(e)}`,
    `SUMMARY:${esc(title)}`, description ? `DESCRIPTION:${esc(description)}` : null,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(title)}`, `TRIGGER:-PT${Math.max(0, alarmMin)}M`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}
