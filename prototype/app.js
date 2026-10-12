// Jarvis-prototype. Ingen ekte KI: svarene er skriptet ut fra enkle nøkkelord.
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const KEY = 'jarvis-proto-v1';
const today = new Date().toISOString().slice(0, 10);
let S = load();
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s) { if (s.day !== today) { s.day = today; s.done = 0; } return s; } } catch {}
  return { day: today, done: 0, chat: [], oneThing: null, oneWhy: null, morning: null, evening: null, screen: 'home' };
}
const save = () => localStorage.setItem(KEY, JSON.stringify(S));
const toast = t => { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 2200); };
const esc = t => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- navigasjon ----------
function go(id) {
  S.screen = id; save();
  $$('.screen').forEach(s => s.classList.toggle('on', s.id === id));
  $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.go === id));
  window.scrollTo({ top: 0 });
  if (id === 'home') renderHome();
  if (id === 'evening') $('#eveningGoal').textContent = S.morning?.main || 'komme deg gjennom dagen';
  if (id === 'dump') renderChat();
}
document.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) go(g.dataset.go); });

// ---------- hjem ----------
function renderHome() {
  const h = new Date().getHours();
  $('#hello').textContent = (h < 10 ? 'God morgen' : h < 18 ? 'Hei' : 'God kveld') + ', Tomine';
  $('#today').textContent = new Date().toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#oneThing').textContent = S.oneThing || S.morning?.main || 'Svar Emma om gruppeoppgaven';
  $('#oneWhy').textContent = S.oneWhy || (S.morning ? 'Det var dagens viktigste, sa du i morges.' : 'Den tar fem minutter, og så slipper du å tenke på den.');
  $('#doneCount').textContent = S.done;
}
$('#doneBtn').onclick = () => { S.done++; S.oneThing = 'Ta en pause, du fortjener den'; S.oneWhy = 'Drikk et glass vann. Så ser vi på neste ting.'; save(); renderHome(); toast('Bra jobba! 🎉'); };

// ---------- hjernetømming ----------
const TOPICS = [
  { re: /eksamen|prøve|lese|pensum|kapittel/i, worry: 'eksamen', step: 'Åpne boka og les én side', mins: 10, wait: false },
  { re: /arbeidskrav|oppgave|innlevering|frist|skrive/i, worry: 'en innlevering', step: 'Åpne dokumentet og skriv én setning, den får være dårlig', mins: 10, wait: false },
  { re: /svar|melding|mail|e-post|emma|ringe|ring/i, worry: 'noen som venter på svar', step: 'Send en kort melding: «Hei! Jeg svarer ordentlig i kveld»', mins: 2, wait: false },
  { re: /rom|rydd|kaos|vask|klesvask|oppvask/i, worry: 'rotet hjemme', step: 'Rydd bare én overflate, f.eks. pulten', mins: 5, wait: true },
  { re: /tannleg|lege|time|avtale/i, worry: 'en avtale du må bestille', step: 'Legg inn en påminnelse om å ringe i morgen kl 9', mins: 2, wait: true },
  { re: /penger|regning|betale/i, worry: 'regninger', step: 'Åpne nettbanken og se på bare én regning', mins: 5, wait: true },
  { re: /sliten|trøtt|orker|stress|overvelda|mye/i, worry: 'at det føles som for mye', step: 'Pust rolig i ett minutt, så velger vi én ting', mins: 1, wait: false },
];
function think(text) {
  const hits = TOPICS.filter(t => t.re.test(text));
  if (!hits.length) return { worries: ['mye som surrer, uten at det har fått navn ennå'], wait: ['Alt som ikke må skje i dag'], step: { text: 'Skriv ned de tre tingene som plager deg mest', mins: 3 } };
  const now = hits.filter(h => !h.wait), later = hits.filter(h => h.wait);
  const pick = (now.length ? now : hits).sort((a, b) => a.mins - b.mins)[0];
  return {
    worries: hits.map(h => h.worry),
    wait: later.filter(h => h !== pick).map(h => h.worry[0].toUpperCase() + h.worry.slice(1)).concat(later.length ? [] : ['Alt det andre. Det løper ikke fra deg.']),
    step: { text: pick.step, mins: pick.mins },
  };
}
const list = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' og ' + a.at(-1);
function bubbleHTML(m) {
  if (m.who === 'me') return `<div class="bubble me">${esc(m.text)}</div>`;
  if (m.kind === 'step') return `<div class="bubble jv step"><span class="tag t3">Ett lite steg nå</span>${esc(m.text)}<div class="row"><button class="btn primary" data-start="${m.mins}" data-task="${esc(m.text)}">Start · ${m.mins} min</button><button class="btn ghost" data-pin="${esc(m.text)}">Gjør den til «én ting»</button></div></div>`;
  const tag = { worry: '<span class="tag t1">Det som plager deg</span>', wait: '<span class="tag t2">Dette kan vente</span>' }[m.kind] || '';
  return `<div class="bubble jv">${tag}${esc(m.text)}</div>`;
}
function renderChat() {
  const c = $('#chat');
  if (!S.chat.length) S.chat = [{ who: 'jv', text: 'Hei 💜 Hodet fullt? Skriv eller snakk alt som surrer, i hvilken som helst rekkefølge. Jeg sorterer.' }];
  c.innerHTML = S.chat.map(bubbleHTML).join('');
  $('#chips').style.display = S.chat.length > 1 ? 'none' : '';
  c.lastElementChild?.scrollIntoView({ block: 'end' });
}
async function send(text) {
  text = text.trim(); if (!text) return;
  S.chat.push({ who: 'me', text }); save(); renderChat();
  const r = think(text), orb = $('#dumpOrb'); orb.classList.add('think');
  const replies = [
    { who: 'jv', kind: 'worry', text: `Det høres ut som mye på en gang. Det som tynger mest er ${list(r.worries)}. Helt forståelig at hodet er fullt.` },
    { who: 'jv', kind: 'wait', text: r.wait.join(' · ') + (r.wait.length ? '. Jeg holder på det, du trenger ikke.' : '') },
    { who: 'jv', kind: 'step', text: r.step.text, mins: r.step.mins },
  ];
  for (const m of replies) {
    const t = document.createElement('div'); t.className = 'bubble jv typing'; t.innerHTML = '<span></span><span></span><span></span>';
    $('#chat').append(t); t.scrollIntoView({ block: 'end' });
    await new Promise(res => setTimeout(res, 900));
    S.chat.push(m); save(); renderChat();
  }
  orb.classList.remove('think');
}
$('#composer').onsubmit = e => { e.preventDefault(); const t = $('#dumpText'); send(t.value); t.value = ''; };
$('#dumpText').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#composer').requestSubmit(); } });
$$('#chips .chip').forEach(c => c.onclick = () => send(c.textContent));
document.addEventListener('click', e => {
  const p = e.target.closest('[data-pin]');
  if (p) { S.oneThing = p.dataset.pin; S.oneWhy = 'Fra hodetømmingen din. Lite nok til å starte nå.'; save(); toast('Lagt på Nå ✓'); }
});

// mikrofon (Web Speech API)
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
$('#mic').onclick = () => {
  if (!SR) return toast('Nettleseren støtter ikke tale her. Prøv Chrome eller Safari.');
  const r = new SR(); r.lang = 'nb-NO'; r.interimResults = true;
  const mic = $('#mic'), box = $('#dumpText'), base = box.value;
  mic.classList.add('rec');
  r.onresult = e => { box.value = base + [...e.results].map(x => x[0].transcript).join(''); };
  r.onerror = () => toast('Fikk ikke tak i mikrofonen.');
  r.onend = () => mic.classList.remove('rec');
  r.start();
};

// ---------- fokus-timer ----------
let timer;
document.addEventListener('click', e => {
  const s = e.target.closest('[data-start]'); if (!s) return;
  startFocus(+s.dataset.start, s.dataset.task || $('#oneThing').textContent);
});
function startFocus(mins, task) {
  const total = mins * 60; let left = total;
  $('#ftask').textContent = task; $('#focus').hidden = false;
  const tick = () => {
    $('#ftime').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    $('#prog').style.strokeDashoffset = 326.7 * (1 - left / total);
    if (left-- <= 0) { clearInterval(timer); toast('Tiden er ute. Fortsett hvis du vil!'); }
  };
  clearInterval(timer); tick(); timer = setInterval(tick, 1000);
}
$('#fstop').onclick = () => { clearInterval(timer); $('#focus').hidden = true; };
$('#fdone').onclick = () => { clearInterval(timer); $('#focus').hidden = true; S.done++; save(); renderHome(); toast('Du startet. Det er det vanskeligste 🎉'); };

// ---------- morgen ----------
let energy = 'ok';
$$('#energy button').forEach(b => b.onclick = () => { $$('#energy button').forEach(x => x.classList.toggle('on', x === b)); energy = b.dataset.v; });
$$('#morning .chip').forEach(c => c.onclick = () => $('#mainThing').value = c.textContent);
$('#saveMorning').onclick = () => {
  const main = $('#mainThing').value.trim(); if (!main) return toast('Skriv én ting først 🙂');
  S.morning = { main, energy }; S.oneThing = main; S.oneWhy = 'Dagens viktigste, valgt i morges.'; save();
  $('#morningReply').textContent = { lav: `Lav energi er helt greit. Gjør «${main}» i små biter, ti minutter av gangen. Resten kan vente.`, ok: `Fint. «${main}» står øverst på Nå. Jeg sjekker inn i kveld.`, hoy: `Rått! Bruk energien på «${main}» tidlig, før dagen tar deg.` }[energy];
};

// ---------- kveld ----------
let mood = null;
$$('#moods button').forEach(b => b.onclick = () => { $$('#moods button').forEach(x => x.classList.toggle('on', x === b)); mood = +b.dataset.m; });
$('#saveEvening').onclick = () => {
  if (mood === null) return toast('Velg hvordan dagen kjentes først');
  const note = $('#eveningNote').value.trim();
  S.evening = { mood, note, day: today }; save();
  const lines = [
    'Det var en tung dag. Takk for at du likevel sjekket inn, det teller. I morgen starter vi helt smått.',
    'En sånn passe dag er også en dag. Du kom deg gjennom den.',
    'En grei dag! Det er mer enn nok.',
    'Så fint at dagen var bra. Merk deg hva som hjalp.',
    'For en dag! Lagre den følelsen 🌟',
  ];
  $('#reflect').innerHTML = `<p>${lines[mood]}${S.done ? ` Du tok ${S.done} småsteg i dag.` : ''}${note ? ` «${esc(note)}» – det tar jeg vare på.` : ''}</p><p>Nå kan du legge dagen fra deg. Sov godt 🌙</p>`;
};

// ---------- demo ----------
$('#reset').onclick = () => { localStorage.removeItem(KEY); location.reload(); };
go(S.screen || 'home');
