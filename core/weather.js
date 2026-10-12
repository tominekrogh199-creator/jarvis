// Kjerne · vær: WMO-koder til norsk, råd for dagen, og normalisering av svar fra Open-Meteo.
import { HOUR, startOfDay, addDays, atTime, hhmm } from './time.js';

export const CITIES = {
  oslo: { id: 'oslo', name: 'Oslo', lat: 59.9139, lon: 10.7522 },
  bergen: { id: 'bergen', name: 'Bergen', lat: 60.3913, lon: 5.3221 },
  trondheim: { id: 'trondheim', name: 'Trondheim', lat: 63.4305, lon: 10.3951 },
  stavanger: { id: 'stavanger', name: 'Stavanger', lat: 58.97, lon: 5.7331 },
  tromso: { id: 'tromso', name: 'Tromsø', lat: 69.6492, lon: 18.9553 },
  kristiansand: { id: 'kristiansand', name: 'Kristiansand', lat: 58.1467, lon: 7.9956 },
  drammen: { id: 'drammen', name: 'Drammen', lat: 59.7439, lon: 10.2045 },
};

/** WMO-værkode → {desc, kind}. kind brukes til ikon og råd. */
export function describe(code) {
  const c = Number(code);
  if (c === 0) return { desc: 'Klart', kind: 'sol' };
  if (c === 1) return { desc: 'Lettskyet', kind: 'sol' };
  if (c === 2) return { desc: 'Delvis skyet', kind: 'sky-sol' };
  if (c === 3) return { desc: 'Overskyet', kind: 'sky' };
  if (c === 45 || c === 48) return { desc: 'Tåke', kind: 'sky' };
  if (c >= 51 && c <= 57) return { desc: 'Yr', kind: 'regn' };
  if (c === 61 || c === 80) return { desc: 'Lett regn', kind: 'regn' };
  if (c === 63 || c === 81) return { desc: 'Regn', kind: 'regn' };
  if (c === 65 || c === 82) return { desc: 'Kraftig regn', kind: 'regn' };
  if (c === 66 || c === 67) return { desc: 'Underkjølt regn', kind: 'regn' };
  if (c >= 71 && c <= 77) return { desc: 'Snø', kind: 'sno' };
  if (c === 85 || c === 86) return { desc: 'Snøbyger', kind: 'sno' };
  if (c >= 95) return { desc: 'Torden', kind: 'torden' };
  return { desc: 'Skiftende', kind: 'sky' };
}

export const WET = new Set(['regn', 'sno', 'torden']);

/** Gjør et Open-Meteo-svar om til appens format. */
export function fromOpenMeteo(json, place, at) {
  const cur = json.current || {};
  const h = json.hourly || {};
  const hours = (h.time || []).map((iso, i) => ({
    t: new Date(iso).getTime(),
    temp: Math.round(h.temperature_2m?.[i]),
    code: h.weather_code?.[i],
    pop: h.precipitation_probability?.[i] ?? null,
  }));
  const d = describe(cur.weather_code);
  return {
    at,
    place: place.name,
    source: 'open-meteo',
    now: { temp: Math.round(cur.temperature_2m), code: cur.weather_code, desc: d.desc, kind: d.kind, wind: Math.round(cur.wind_speed_10m ?? 0) },
    hours,
  };
}

export function openMeteoUrl(place) {
  const q = new URLSearchParams({
    latitude: place.lat, longitude: place.lon,
    current: 'temperature_2m,weather_code,wind_speed_10m',
    hourly: 'temperature_2m,precipitation_probability,weather_code',
    forecast_days: '2', timezone: 'Europe/Oslo', wind_speed_unit: 'ms',
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

/** Oppsummering for resten av dagen: min/maks og når det blir vått. */
export function today(w, now) {
  if (!w) return null;
  const end = addDays(startOfDay(now), 1);
  const rest = (w.hours || []).filter((x) => x.t >= now - HOUR && x.t < end);
  if (!rest.length) return { min: w.now.temp, max: w.now.temp, wetFrom: null };
  const temps = rest.map((x) => x.temp);
  const wet = rest.find((x) => WET.has(describe(x.code).kind) || (x.pop ?? 0) >= 60);
  return { min: Math.min(...temps), max: Math.max(...temps), wetFrom: wet ? wet.t : null };
}

/** Ett råd du faktisk kan bruke: paraply, jakke eller ingenting. */
export function advice(w, now) {
  if (!w) return null;
  const d = today(w, now);
  if (WET.has(w.now.kind)) return 'Ta med paraply eller regnjakke nå.';
  if (d?.wetFrom) return `Ta med paraply: det ser vått ut fra kl. ${hhmm(d.wetFrom)}.`;
  if ((d?.max ?? w.now.temp) <= 2) return 'Kaldt i dag. Lue og votter.';
  if ((w.now.wind ?? 0) >= 10) return 'Mye vind. Ta en jakke som tåler det.';
  if ((d?.max ?? 0) >= 20) return 'Varmt i dag. Husk vannflaska.';
  return null;
}

export function line(w, now) {
  if (!w) return null;
  const d = today(w, now);
  const range = d && d.min !== d.max ? `, ${d.min}–${d.max}° resten av dagen` : '';
  return `${w.now.temp}° og ${w.now.desc.toLocaleLowerCase('nb')} i ${w.place}${range}.`;
}

/** Eksempelvær til demo-modus. Alltid merket som eksempel i appen. */
export function sampleWeather(now, place = CITIES.oslo) {
  const base = startOfDay(now);
  const hours = Array.from({ length: 36 }, (_, i) => {
    const t = base + i * HOUR;
    const hr = new Date(t).getHours();
    const rain = hr >= 15 && hr <= 18;
    return { t, temp: Math.round(6 + 4 * Math.sin(((hr - 9) / 24) * Math.PI * 2)), code: rain ? 61 : hr < 12 ? 2 : 3, pop: rain ? 70 : 10 };
  });
  const cur = hours.find((x) => x.t > now - HOUR) || hours[0];
  const d = describe(cur.code);
  return { at: now, place: place.name, source: 'eksempel', now: { temp: cur.temp, code: cur.code, desc: d.desc, kind: d.kind, wind: 4 }, hours };
}

const KIND_CODE = { sol: 0, klart: 0, delvis: 2, 'sky-sol': 2, sky: 3, skyet: 3, overskyet: 3, yr: 51, regn: 63, 'lett regn': 61, byger: 80, sludd: 66, sno: 71, snø: 71, torden: 95, tåke: 45 };

/**
 * Været fra morgen- og kveldsjobben i skyen (Yr, levert av NRK og Meteorologisk institutt).
 * Enkelt format: {at, place, hours: [{time: "HH:MM", temp, kind, mm}]}, kind på norsk (sol, delvis, sky, regn, snø …).
 */
export function fromSimple(doc, place, at) {
  if (!doc || !Array.isArray(doc.hours) || !doc.hours.length) return null;
  const day = startOfDay(doc.at || at);
  const hours = doc.hours.map((x) => {
    const [hh, mm] = String(x.time || '').split(':').map(Number);
    if (!Number.isFinite(hh) || x.temp == null || x.temp === '') return null;
    const k = String(x.kind || '').toLocaleLowerCase('nb').trim();
    const code = KIND_CODE[k] ?? (/(torden)/.test(k) ? 95 : /(snø|sno)/.test(k) ? 71 : /(regn|yr|byge)/.test(k) ? 61 : /(delvis|lett)/.test(k) ? 2 : /(sky)/.test(k) ? 3 : /(sol|klar)/.test(k) ? 0 : 3);
    const mmRain = Number(x.mm) || 0;
    return { t: atTime(day, `${hh}:${mm || 0}`), temp: Math.round(Number(x.temp)), code, pop: WET.has(describe(code).kind) || mmRain >= 0.3 ? 70 : 10 };
  }).filter((x) => x && Number.isFinite(x.temp)).sort((a, b) => a.t - b.t);
  if (!hours.length) return null;
  const cur = [...hours].reverse().find((x) => x.t <= at) || hours[0];
  const d = describe(cur.code);
  return { at: doc.at || at, place: doc.place || place.name, source: 'yr', now: { temp: cur.temp, code: cur.code, desc: d.desc, kind: d.kind, wind: null }, hours };
}
