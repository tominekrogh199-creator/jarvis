// Været. Open-Meteo når nettet er åpent (appen som fil). På claude.ai er nettet stengt for siden, så været
// leses fra et delt dokument en planlagt morgenjobb kan fylle. Eksempelvær bare i eksempeldagen, alltid merket.
import { store } from './store.js';
import { clock } from './clock.js';
import { CITIES, fromOpenMeteo, openMeteoUrl, sampleWeather, fromSimple } from '../core/weather.js';

const FRESH = 30 * 60_000;

export const weather = {
  data: null,
  loading: false,
  source: null,

  city() { return CITIES[store.settings.city] || CITIES.oslo; },

  async refresh(onChange = () => {}, { force = false } = {}) {
    const city = this.city();
    const t = clock.now();
    if (!force && this.data && this.data.place === city.name && t - this.data.at < FRESH && (this.data.source !== 'eksempel' || store.demo)) return this.data;
    if (this.loading) return this.data;
    this.loading = true;
    let w = null;
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 5000);
      const res = await fetch(openMeteoUrl(city), { signal: ctl.signal });
      clearTimeout(timer);
      if (res.ok) w = fromOpenMeteo(await res.json(), city, t);
    } catch { /* stengt nett eller uten dekning */ }
    if (!w && store.weatherDoc) {
      try {
        const snap = await store.weatherDoc(store.settings.city).get();
        const d = snap.exists ? snap.data() : null;
        if (d?.json) {
          const parsed = JSON.parse(d.json);
          if (t - parsed.at < 12 * 3600_000) w = { ...parsed, source: 'morgenjobb' };
        } else if (Array.isArray(d?.hours) && t - (d.at || 0) < 14 * 3600_000) {
          w = fromSimple(d, city, t);
        }
      } catch { /* ingen morgenjobb */ }
    }
    if (!w && store.demo) w = sampleWeather(t, city);
    this.loading = false;
    this.data = w;
    this.source = w?.source || null;
    onChange(w);
    return w;
  },
};

export const SOURCE_LABEL = {
  'open-meteo': 'Open-Meteo',
  morgenjobb: 'morgenjobb',
  yr: 'Yr (NRK og Meteorologisk institutt)',
  eksempel: 'eksempel',
};
