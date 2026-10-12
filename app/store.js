// Lagring. Lokalt i nettleseren, og privat per bruker på claude.ai når appen kjører der.
// updatedAt endres bare når noe faktisk endres, så en ny enhet aldri overskriver det som ligger i skyen.
import { clock } from './clock.js';
import { seedDemo } from './demo.js';
import { startOfDay } from '../core/time.js';

const KEY = 'jarvis.v2';

export const DEFAULT_SETTINGS = {
  name: '',
  city: 'oslo',
  mode: 'eksempel',
  onboarded: false,
  theme: 'system',
  motion: 'full',
  glass: 'tonet',
  sky: 'levende',
  font: 'system',
  textScale: 1,
  sound: false,
  nudgeBudget: 5,
  briefTime: '07:30',
  eveningTime: '21:00',
  claude: true,
  checkins: true,
  clockOffset: 0,
  workPrefer: null,
  workWeekend: false,
  askPlan: true,
  agents: { kalenderLes: true, kalenderSkriv: 'spor', postLes: true, postAuto: false, postSend: 'spor', planFlytt: 'selv' },
};

export function emptyData(now) {
  return {
    createdAt: now,
    things: [],
    calendar: [],
    people: [],
    sessions: [],
    log: [],
    jobs: {},
    chat: [],
    comebacks: [],
    place: null,
    energy: null,
    nudges: { day: 0, count: 0, seen: [] },
    seen: {},
    skip: { day: 0, ids: [] },
    lastActiveAt: now,
    inbox: [],
    agents: {},
  };
}

const safe = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
};

function fresh(now) {
  return { v: 2, updatedAt: 0, settings: { ...DEFAULT_SETTINGS }, data: { eksempel: seedDemo(now), ekte: emptyData(now) } };
}

export const store = {
  state: null,
  listeners: new Set(),
  saveTimer: null,
  remote: null,
  weatherDoc: null,
  storageNote: 'Lagres i denne nettleseren.',

  load() {
    let s = null;
    const raw = safe.get(KEY);
    if (raw) { try { s = JSON.parse(raw); } catch { s = null; } }
    if (!s || s.v !== 2) s = fresh(Date.now());
    s.settings = { ...DEFAULT_SETTINGS, ...s.settings };
    s.data.ekte = { ...emptyData(Date.now()), ...(s.data.ekte || {}) };
    clock.set(s.settings.clockOffset);
    // Eksempeldagen lages på nytt hver dag, så den alltid ser levende ut.
    if (!s.data.eksempel || startOfDay(s.data.eksempel.createdAt) !== startOfDay(clock.now())) {
      // Ting du selv har fanget i eksempeldagen, blir med når eksempelet lages på nytt.
      const own = (s.data.eksempel?.things || []).filter((t) => !String(t.id).includes('-demo-'));
      s.data.eksempel = seedDemo(clock.now());
      s.data.eksempel.things.push(...own);
    }
    this.state = s;
    this.pristine = !s.updatedAt;
    return s;
  },

  get settings() { return this.state.settings; },
  get demo() { return this.state.settings.mode === 'eksempel'; },

  /** Datasettet som vises: eksempeldagen eller dine egne ting. Aldri en blanding. */
  ds() { return this.demo ? this.state.data.eksempel : this.state.data.ekte; },

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  emit() { for (const fn of this.listeners) fn(this.state); },

  update(fn, { render = true } = {}) {
    const r = fn(this.ds(), this.state);
    this.touch();
    if (render) this.emit();
    return r;
  },

  updateSettings(patch, { render = true } = {}) {
    Object.assign(this.state.settings, patch);
    if ('clockOffset' in patch) clock.set(patch.clockOffset);
    this.touch();
    if (render) this.emit();
  },

  touch() {
    this.state.updatedAt = Date.now();
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.persist(), 250);
  },

  /** Lagrer med en gang (når siden lukkes eller skjules). */
  flush() {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.persist();
  },

  persist() {
    this.saveTimer = null;
    safe.set(KEY, JSON.stringify(this.state));
    this.remote?.push(this.state);
  },

  resetDemo() {
    const own = (this.state.data.eksempel?.things || []).filter((t) => !String(t.id).includes('-demo-'));
    this.state.data.eksempel = seedDemo(clock.now());
    this.state.data.eksempel.things.push(...own);
    this.touch();
    this.emit();
  },

  resetOwn() {
    this.state.data.ekte = emptyData(clock.now());
    this.touch();
    this.emit();
  },

  /** Eksport av egne data som JSON. */
  exportJson() {
    return JSON.stringify({ app: 'jarvis', v: 2, exportedAt: new Date().toISOString(), settings: this.state.settings, data: this.state.data.ekte }, null, 2);
  },

  importJson(text) {
    const o = JSON.parse(text);
    if (o?.app !== 'jarvis' || !o.data?.things) throw new Error('Filen ser ikke ut som en Jarvis-eksport.');
    this.state.data.ekte = { ...emptyData(clock.now()), ...o.data };
    this.state.settings.mode = 'ekte';
    this.touch();
    this.emit();
  },

  /** Privat lagring på claude.ai. Skyen vinner hvis den er nyere, eller hvis denne enheten ikke har endret noe. */
  async connectRemote() {
    const c = typeof window !== 'undefined' ? window.claude : null;
    if (!c || typeof c.use !== 'function') return;
    try {
      const [db, user] = await Promise.all([c.use('db'), c.use('user')]);
      if (!db || !user) return;
      const uid = await user.id();
      if (!uid) return;
      // Eget dokument for versjon 2, så data fra den gamle appen aldri blandes inn.
      const doc = db.doc(`data/users/${uid}/jarvis2`);
      this.weatherDoc = (city) => db.doc(`weather/${city}`);
      // Forslag og meldinger fra morgen- og kveldsjobben i skyen.
      this.inboxDoc = db.doc(`data/users/${uid}/innboks`);
      let writing = false;
      let queued = null;
      const write = async (state) => {
        if (writing) { queued = state; return; }
        writing = true;
        try {
          const body = { v: 2, updatedAt: state.updatedAt, settings: state.settings, ekte: state.data.ekte };
          await doc.set({ json: JSON.stringify(body), updatedAt: state.updatedAt });
        } catch { /* lokal lagring holder */ }
        writing = false;
        if (queued) { const q = queued; queued = null; write(q); }
      };
      const snap = await doc.get();
      let cloud = snap.exists ? snap.data() : null;
      try { if (cloud?.json && JSON.parse(cloud.json).v !== 2) cloud = null; } catch { cloud = null; }
      if (cloud?.json && ((cloud.updatedAt || 0) > (this.state.updatedAt || 0) || this.pristine)) {
        const remote = JSON.parse(cloud.json);
        // Ting fanget på denne enheten før skyen svarte, blir med.
        const local = this.state.data.ekte.things || [];
        this.state.settings = { ...DEFAULT_SETTINGS, ...remote.settings };
        this.state.data.ekte = { ...emptyData(Date.now()), ...remote.ekte };
        const ids = new Set(this.state.data.ekte.things.map((t) => t.id));
        const extra = local.filter((t) => !ids.has(t.id));
        if (extra.length) { this.state.data.ekte.things.push(...extra); this.state.updatedAt = Date.now(); write(this.state); }
        if (!extra.length) this.state.updatedAt = remote.updatedAt || cloud.updatedAt;
        clock.set(this.state.settings.clockOffset);
        safe.set(KEY, JSON.stringify(this.state));
        this.emit();
      } else if (this.state.updatedAt > (cloud?.updatedAt || 0)) {
        write(this.state);
      }
      this.remote = { push: write };
      this.storageNote = 'Lagres i nettleseren og privat på claude.ai-kontoen din.';
    } catch {
      this.remote = null;
    }
  },
};
