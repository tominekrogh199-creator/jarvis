// Jarvis · skallet: himmelen, dokken med skrivefeltet, tre steder (Nå, Dag, Tanker), ark og varsler.
import { h, icon, clear } from './ui/h.js';
import { app } from './ui/appref.js';
import { initLayers, toast, topSheet, closeAllSheets } from './ui/sheet.js';
import { openThread, openRetPicker, openDraft, openSettings, openOnboarding, replyText, afterHandle, undoToast, openWeek } from './ui/flows.js';
import { openFocus, closeFocus, isFocusOpen, tick as focusTick } from './ui/focus.js';
import * as na from './screens/na.js';
import * as dag from './screens/dag.js';
import * as tanker from './screens/tanker.js';
import * as agenter from './screens/agenter.js';
import { openPlan, openAskDue } from './ui/plan.js';
import { agentsRuntime } from './agents.js';
import { BIG_WORK } from '../core/planwork.js';
import { store } from './store.js';
import { clock } from './clock.js';
import { actions } from './actions.js';
import { brain } from './brain.js';
import { weather } from './weather.js';
import { voice, chime } from './voice.js';
import { paintSky } from './sky.js';
import { eventsOf, surfacing } from './model.js';
import { runJobs } from '../core/jobs.js';
import { needsComeback } from '../core/brief.js';
import { leaveAt } from '../core/now.js';
import { MIN, startOfDay, hhmm } from '../core/time.js';

const TABS = [
  { id: 'na', label: 'Nå', icon: 'na', screen: na },
  { id: 'dag', label: 'Dag', icon: 'plan', screen: dag },
  { id: 'tanker', label: 'Tanker', icon: 'strom', screen: tanker },
  { id: 'agenter', label: 'Agenter', icon: 'staben', screen: agenter },
];


const root = document.documentElement;
const hostTheme = root.getAttribute('data-theme');
const els = {};
const scroll = {};
let route = 'na';
let booted = false;

// ---------------- Innstillinger på siden ----------------

app.applySettings = function applySettings() {
  const s = store.settings;
  if (s.theme === 'system') { if (hostTheme) root.setAttribute('data-theme', hostTheme); else root.removeAttribute('data-theme'); } else root.setAttribute('data-theme', s.theme);
  root.dataset.motion = s.motion;
  root.dataset.glass = s.glass;
  root.dataset.sky = s.sky;
  root.dataset.font = s.font;
  root.style.setProperty('--scale', String(s.textScale || 1));
  if (s.font === 'atkinson' && !document.getElementById('font-atk')) {
    document.head.append(h('link', { id: 'font-atk', rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Next:wght@400..700&display=swap' }));
  }
  paintSky(new Date(clock.now()), s.sky);
};

// ---------------- Navigasjon og tegning ----------------

app.go = function go(id) {
  if (!TABS.some((t) => t.id === id)) id = 'na';
  scroll[route] = window.scrollY;
  route = id;
  try { history.replaceState(null, '', `#${id}`); } catch { /* ingen historikk */ }
  render();
  window.scrollTo(0, scroll[id] || 0);
  els.screen.focus({ preventScroll: true });
};

function renderTabs() {
  clear(els.tabs);
  for (const t of TABS) {
    const waiting = t.id === 'agenter' ? (store.ds().inbox || []).filter((x) => x.status === 'venter').length : 0;
    els.tabs.append(h('button', { type: 'button', class: 'tab', 'aria-current': route === t.id ? 'page' : null, 'aria-label': waiting ? `${t.label}, ${waiting} venter på ja` : null, onClick: () => app.go(t.id) }, icon(t.icon, { size: 18 }), t.label, waiting ? h('span', { class: 'badge', 'aria-hidden': 'true' }, String(waiting)) : null));
  }
}

function render() {
  const tab = TABS.find((t) => t.id === route) || TABS[0];
  const active = document.activeElement;
  const keep = active && els.screen.contains(active) && active.id ? active.id : null;
  const next = tab.screen.render();
  next.id = 'screen';
  next.tabIndex = -1;
  els.screen.replaceWith(next);
  els.screen = next;
  if (keep) document.getElementById(keep)?.focus({ preventScroll: true });
  renderTabs();
  renderAside();
}
app.render = () => { if (booted) render(); };

function renderAside() {
  clear(els.aside);
  if (!window.matchMedia('(min-width: 1080px)').matches || route === 'dag') return;
  els.aside.append(h('div', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', { class: 'h3' }, 'I dag'), h('button', { type: 'button', class: 'btn btn-text btn-small', onClick: () => app.go('dag') }, 'Hele dagen')),
    dag.timeline(startOfDay(clock.now()), { compact: true })));
}

app.focusInput = () => { els.say.focus(); };
app.fill = (text) => { els.say.value = text; els.say.focus(); };

app.startFocus = ({ thingId = null, stepId = null, title = 'Fokus', minutes = 25, pause = false } = {}) => {
  closeAllSheets();
  actions.startSession(thingId, minutes, { stepId, title, pause });
  openFocus();
};

// ---------------- Fangst ----------------

function setOrb(state) {
  els.orb.dataset.state = state;
  els.orb.setAttribute('aria-label', state === 'tenker' ? 'Jarvis sorterer' : 'Åpne samtalen');
}

async function submit(text) {
  const clean = text.trim();
  if (!clean) return;
  els.say.value = '';
  actions.chat('du', clean);
  setOrb('tenker');
  let res;
  try {
    res = await brain.handle(clean, { onState: setOrb });
  } catch {
    setOrb('rolig');
    toast('Noe gikk galt. Teksten er ikke lagret.', { actions: [{ label: 'Prøv igjen', onClick: () => submit(clean) }] });
    return;
  }
  setOrb('rolig');
  actions.chat('jarvis', replyText(res), res.saved.map((t) => ({ id: t.id })));
  const lastLog = res.logIds[res.logIds.length - 1] || null;
  const rt = agentsRuntime();
  if (res.engine === 'agent') {
    const waiting = (store.ds().inbox || []).filter((x) => x.status === 'venter').length;
    toast(res.agent === 'post' ? 'Postagenten' : res.agent === 'kalender' ? 'Kalenderagenten' : 'Planleggeren', { sub: res.done.join(' '), timeout: 12000, actions: waiting ? [{ label: `Se køen (${waiting})`, onClick: () => app.go('agenter') }] : [] });
    afterHandle(res);
    return;
  }
  if (res.answer) openThread({ answer: res.answer });
  else if (res.saved.length === 1 && res.plans?.length === 1) {
    const th = res.saved[0];
    if (store.settings.askPlan !== false && !isFocusOpen()) openPlan(th.id, { fresh: true });
    else undoToast(`Planla «${th.title}».`, lastLog, { sub: res.lines[0], more: [{ label: 'Se planen', onClick: () => openPlan(th.id) }] });
  } else if (res.saved.length === 1 && res.saved[0].kind === 'oppgave' && BIG_WORK.test(res.saved[0].title) && store.settings.askPlan !== false) {
    const th = res.saved[0];
    undoToast(res.lines[0], lastLog, { sub: 'Den ser stor ut. Har den en frist? Da legger jeg en plan.', more: [{ label: 'Gi den frist', onClick: () => openAskDue(th.id) }] });
  } else if (res.saved.length === 1) {
    const th = res.saved[0];
    undoToast(res.lines[0], lastLog, { sub: res.note || th.why || null, more: [th.draft ? { label: 'Se utkastet', onClick: () => openDraft(th.id) } : { label: 'Endre', onClick: () => openRetPicker(store.ds().things.find((x) => x.id === th.id) || th) }] });
  } else if (res.saved.length > 1) {
    undoToast(`Sortert i ${res.saved.length} ting.`, lastLog, { sub: res.lines.join(' '), more: [{ label: 'Se', onClick: () => openThread() }] });
  } else if (res.done.length) undoToast(res.done.join(' '), lastLog);
  afterHandle(res);
}

// ---------------- Dytt og jobber ----------------

/** Knappene i et dytt: økter kan startes eller flyttes, levering kan krysses av. */
function surfaceActions(x) {
  const t = clock.now();
  if (x.type === 'okt') return [
    { label: 'Start', onClick: () => app.startFocus({ thingId: x.thing.id, stepId: x.step.id, title: x.step.title, minutes: Math.max(5, Math.round((x.step.end - Math.max(t, x.step.at)) / MIN)) }) },
    { label: 'Ikke nå', onClick: () => { const r = actions.skipSession(x.thing.id, x.step.id); undoToast(r?.text || 'Flyttet.', r?.logId); } },
  ];
  if (x.type === 'lever') return [
    { label: 'Levert', onClick: () => { const l = actions.stepDone(x.thing.id, x.step.id, true); undoToast(`Levert: «${x.thing.title}». Bra jobba.`, l); } },
    { label: 'Se planen', onClick: () => openPlan(x.thing.id) },
  ];
  return [
    { label: 'Gjort', onClick: () => { const l = actions.done(x.thing.id); undoToast(`Ferdig: «${x.thing.title}».`, l); } },
    { label: 'Senere', onClick: () => openRetPicker(x.thing, { later: true }) },
  ];
}
app.surfaceActions = surfaceActions;

function nudges() {
  if (!booted || isFocusOpen() || !store.settings.onboarded) return;
  const ds = store.ds();
  const t = clock.now();
  const looking = route === 'na' && !document.hidden && window.scrollY < 400;
  for (const x of surfacing(ds, t)) {
    const key = `${x.thing.id}:${x.type}:${x.thing.ret?.at || x.thing.ret?.place || x.thing.ret?.person || ''}`;
    if (looking) { actions.markNudged(key); continue; }
    if (!actions.spendNudge(key)) continue;
    notify(x.type === 'okt' ? `Økt: ${x.thing.title}` : x.thing.title, x.reason, surfaceActions(x));
    break;
  }
  const next = eventsOf(ds).find((e) => !e.allDay && e.start > t && e.travelMin);
  const go = next ? leaveAt(next) : null;
  if (go && t >= go - 10 * MIN && t < go + 5 * MIN && actions.spendNudge(`ga:${next.id}:${next.start}`)) {
    notify(t < go ? `Gå om ${Math.max(1, Math.round((go - t) / MIN))} min` : 'Gå nå', `${next.title} kl. ${hhmm(next.start)}, ${next.travelMin} min reise.`, []);
  }
}

function notify(title, sub, acts) {
  toast(title, { sub, actions: acts, timeout: 12000, orb: true });
  if (store.settings.sound) { chime(); navigator.vibrate?.(80); }
  try {
    if (!app.inArtifact && document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification(title, { body: sub, tag: title });
  } catch { /* ikke støttet */ }
}

function jobs() {
  const ds = store.ds();
  actions.releaseHeld();
  const results = runJobs({ now: clock.now(), things: ds.things, jobState: ds.jobs || {}, settings: store.settings, events: eventsOf(ds), activeStepId: ds.active?.stepId || null });
  if (!results.length) return;
  if (results.every((r) => !r.text && !(r.ops || []).length)) {
    store.update((d) => { for (const r of results) d.jobs = { ...d.jobs, [r.id]: { ...(d.jobs?.[r.id] || {}), lastRun: clock.now() } }; }, { render: false });
    return;
  }
  actions.applyJobs(results);
}

function checkComeback() {
  if (store.demo) return;
  const ds = store.ds();
  if (needsComeback(ds.lastActiveAt, clock.now()) && ds.things.some((t) => t.status === 'aktiv')) {
    actions.comeback();
    window.scrollTo(0, 0);
  } else if (clock.now() - (ds.lastActiveAt || 0) > 10 * MIN) {
    store.update((d) => { d.lastActiveAt = clock.now(); }, { render: false });
  }
}

// ---------------- Oppstart ----------------

function routeFromHash() {
  const h0 = (location.hash || '').replace('#', '');
  if (h0 === 'fang') { setTimeout(() => app.focusInput(), 200); return 'na'; }
  if (h0 === 'samtale') { setTimeout(() => openThread(), 200); return 'na'; }
  if (h0 === 'meg') { setTimeout(() => openSettings(), 200); return 'na'; }
  if (h0 === 'uke') { setTimeout(() => openWeek(), 200); return 'na'; }
  return TABS.some((t) => t.id === h0) ? h0 : 'na';
}

async function boot() {
  els.screen = document.getElementById('screen');
  els.aside = document.getElementById('aside');
  els.tabs = document.getElementById('tabs');
  els.say = document.getElementById('say');
  els.orb = document.getElementById('orb');
  els.capture = document.getElementById('capture');
  els.mic = document.getElementById('mic');
  els.send = document.getElementById('send');
  initLayers(document.getElementById('layer'), document.getElementById('toasts'), [document.getElementById('app'), document.getElementById('dock')]);
  app.inArtifact = !!window.claude;

  store.load();
  app.applySettings();
  els.send.append(icon('send', { size: 20 }));
  els.capture.addEventListener('submit', (e) => { e.preventDefault(); submit(els.say.value); });
  els.orb.addEventListener('click', () => openThread());
  if (voice.canListen) {
    els.mic.hidden = false;
    els.mic.append(icon('mic', { size: 20 }));
    els.mic.addEventListener('click', () => {
      if (voice.rec) { voice.stopListening(); return; }
      els.mic.classList.add('on');
      setOrb('lytter');
      voice.listen({ onText: (txt) => { els.say.value = txt; }, onEnd: () => { els.mic.classList.remove('on'); setOrb('rolig'); if (els.say.value.trim()) submit(els.say.value); } });
    });
  }
  route = routeFromHash();
  booted = true;
  render();

  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => paintSky(new Date(clock.now()), store.settings.sky));
  window.addEventListener('resize', () => renderAside());
  new MutationObserver(() => paintSky(new Date(clock.now()), store.settings.sky)).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

  // Skyen (claude.ai) før noe skrives, så en ny enhet aldri overskriver det som ligger der.
  await Promise.race([store.connectRemote(), new Promise((r) => setTimeout(r, 4000))]);
  let lastMode = store.settings.mode;
  store.subscribe(() => {
    if (store.settings.mode !== lastMode) { lastMode = store.settings.mode; weather.refresh(() => render(), { force: true }); }
    render();
  });
  if (window.claude?.use) window.claude.use('downloads').then((d) => { app.downloads = d; }).catch(() => {});
  // Agentene: koblinger, rutiner og forslag fra skyen.
  const rt = agentsRuntime();
  rt.toast = (text) => { if (text) toast('Kalenderagenten', { sub: text, timeout: 8000 }); };
  rt.notify = (title, text) => notify(title, text, [{ label: 'Se køen', onClick: () => app.go('agenter') }]);
  brain.agentHook = (cmd) => rt.runCommand(cmd);
  rt.init().then(() => setTimeout(() => rt.tick().catch(() => {}), 3000)).catch(() => {});
  if (store.inboxDoc) {
    try {
      store.inboxDoc.onSnapshot((snap) => {
        if (!snap?.exists) return;
        let d = snap.data();
        try { if (typeof d?.json === 'string') d = JSON.parse(d.json); } catch { return; }
        rt.mergeRemote(d);
      }, () => {});
    } catch { /* ingen innboks */ }
  }
  weather.refresh(() => render());
  checkComeback();
  jobs();
  if (store.ds().active) openFocus();
  if (!store.settings.onboarded) openOnboarding();
  render();

  let lastMinute = new Date(clock.now()).getMinutes();
  setInterval(() => {
    focusTick();
    const m = new Date(clock.now()).getMinutes();
    if (m !== lastMinute) {
      lastMinute = m;
      paintSky(new Date(clock.now()), store.settings.sky);
      const typing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
      if (!typing && !topSheet()) render();
      nudges();
      if (m % 5 === 0) { jobs(); weather.refresh(() => render()); agentsRuntime().tick().catch(() => {}); }
    }
  }, 1000);
  setTimeout(nudges, 2500);
  document.addEventListener('visibilitychange', () => { if (document.hidden) store.flush(); else { checkComeback(); jobs(); render(); } });
  window.addEventListener('pagehide', () => store.flush());
}

window.jarvis = { store, actions, clock, app, brain, closeFocus, agents: agentsRuntime(), openPlan };
boot();
