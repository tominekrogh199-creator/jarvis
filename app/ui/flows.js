// Arkene: tilbakekomst, ting, utkast, samtale, morgenbrief, kveld, Uka di, Bak kulissene, innstillinger og mer.
import { h, icon, button, append } from './h.js';
import { openSheet, closeSheet, toast, refreshSheets } from './sheet.js';
import { app } from './appref.js';
import { now, ago, kindDot, retChip, seg, toggleRow, field, copyText } from './parts.js';
import { store } from '../store.js';
import { actions } from '../actions.js';
import { brain } from '../brain.js';
import { weather, SOURCE_LABEL } from '../weather.js';
import { voice } from '../voice.js';
import { eventsOf, nowState, energyToday, currentPlace, focusPerson } from '../model.js';
import { MIN, HOUR, DAY, startOfDay, addDays, atTime, hhmm, fmtDate, fmtDuration, WEEKDAYS, MONTHS_SHORT, pad2 } from '../../core/time.js';
import { retLabel, parseRetText, PLACES, KINDS, briefAt } from '../../core/sort.js';
import { morningBrief, eveningWrap, weekReview, weatherAction } from '../../core/brief.js';
import { JOBS } from '../../core/jobs.js';
import { googleCalendarLink, icsFor } from '../../core/remind.js';
import { parseIcs } from '../../core/ics.js';
import { line as wxLine } from '../../core/weather.js';
import { CITIES } from '../../core/weather.js';
import { firstSmallStep } from '../../core/smaller.js';
import { nextStep } from '../../core/steps.js';
import { openPlan, waitingRow } from './plan.js';
import { agentsRuntime } from '../agents.js';
import { AGENT_NAME } from '../../core/agents.js';

const ds = () => store.ds();
const find = (id) => ds().things.find((t) => t.id === id);

/** Varsel med «Angre». */
export function undoToast(text, logId, { sub = null, more = [] } = {}) {
  toast(text, { sub, actions: [...more, ...(logId ? [{ label: 'Angre', onClick: () => { actions.undo(logId); toast('Angret.', { timeout: 2500 }); } }] : [])] });
}

const WHO = { du: 'Du', claude: 'Claude', assistent: 'Jarvis', morgen: 'Morgenjobben', frist: 'Fristjobben', oppfolging: 'Oppfølgingsjobben', rydding: 'Ryddejobben', ...AGENT_NAME };

// ---------------- Tilbakekomst ----------------

/** «Når skal den komme tilbake?» Velg med ett trykk, eller skriv det. */
export function openRetPicker(thing, { later = false } = {}) {
  const t = now();
  const choose = (ret) => {
    const logId = later ? actions.later(thing.id, ret) : actions.setRet(thing.id, ret);
    closeSheet();
    undoToast(`«${thing.title}» kommer ${retLabel(ret, now())}.`, logId);
  };
  const inHour = { type: 'tid', at: Math.ceil((t + HOUR) / (15 * MIN)) * 15 * MIN };
  const evening = atTime(startOfDay(t), store.settings.eveningTime) > t ? { type: 'kveld' } : null;
  const people = [...new Set([thing.person, ...ds().people.map((p) => p.name)].filter(Boolean))].slice(0, 6);
  openSheet({
    eyebrow: thing.title,
    title: 'Når skal den komme tilbake?',
    render(body) {
      const cur = thing.ret?.type;
      const opt = (label, ret, sub = null) => h('button', { type: 'button', class: 'opt', 'aria-pressed': String(cur === ret.type && (ret.type !== 'sted' || thing.ret?.place === ret.place) && (ret.type !== 'person' || thing.ret?.person === ret.person)), onClick: () => choose(ret) }, label, sub ? h('small', null, sub) : null);
      append(body, 
        h('div', { class: 'optlist' },
          opt('Om en time', inHour, hhmm(inHour.at)),
          evening ? opt('I kveldsavslutningen', evening, store.settings.eveningTime) : null,
          opt('I morgenbriefen', { type: 'morgen' }, store.settings.briefTime),
          opt('Når jeg har ledig tid', { type: 'ledig' }, 'Nå-kortet foreslår den'),
          opt('Søndag i Uka di', { type: 'uke' })),
        h('p', { class: 'label' }, 'Når jeg er …'),
        h('div', { class: 'actions' }, Object.entries(PLACES).map(([k, v]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(cur === 'sted' && thing.ret?.place === k), onClick: () => choose({ type: 'sted', place: k }) }, v))),
        people.length ? h('p', { class: 'label' }, 'Når jeg har kontakt med …') : null,
        people.length ? h('div', { class: 'actions' }, people.map((p) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(cur === 'person' && thing.ret?.person === p), onClick: () => choose({ type: 'person', person: p }) }, icon('person', { size: 14 }), p))) : null,
      );
      const inp = h('input', { class: 'input', id: 'ret-text', placeholder: '«fredag kl 14», «når jeg er på BI»', enterkeyhint: 'done' });
      const msg = h('p', { class: 'small muted', 'aria-live': 'polite' });
      const save = () => {
        const r = parseRetText(inp.value, now(), store.settings);
        if (!r) { msg.textContent = 'Skjønte ikke tidspunktet. Prøv for eksempel «i morgen kl 9» eller «når jeg er på butikken».'; return; }
        choose(r);
      };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
      append(body, h('div', { class: 'field' }, h('label', { for: 'ret-text' }, 'Eller skriv det'), h('div', { style: { display: 'flex', gap: '8px' } }, inp, button('Lagre', save, { kind: 'primary' }))), msg);
      append(body, h('button', { type: 'button', class: 'btn btn-ghost', onClick: () => choose({ type: 'arkiv' }) }, icon('archive', { size: 18 }), 'Legg i arkivet (bare søk)'));
      if (thing.ret?.type === 'tid') append(body, phoneReminder(thing.title, thing.ret.at));
    },
  });
}

/** Påminnelse på telefonen: Google Kalender-lenke og .ics når appen kjører som fil. */
export function phoneReminder(title, at, { end = null } = {}) {
  const wrap = h('div', { class: 'card flat', style: { gap: '10px' } },
    h('p', { class: 'h3' }, 'Påminnelse på låseskjermen'),
    h('p', { class: 'small muted' }, `Legg den i kalenderen på telefonen, så varsler telefonen deg ${fmtDate(at)} kl. ${hhmm(at)}, også når Jarvis er lukket.`));
  const acts = h('div', { class: 'actions' },
    h('a', { class: 'btn btn-soft btn-small', href: googleCalendarLink({ title, start: at, end, details: 'Fra Jarvis.' }), target: '_blank', rel: 'noopener' }, icon('calendar', { size: 16 }), 'Google Kalender'));
  if (!app.inArtifact) {
    append(acts, button('iPhone-kalender (.ics)', () => {
      const blob = new Blob([icsFor({ title, start: at, end, alarmMin: 0, description: 'Fra Jarvis.' })], { type: 'text/calendar' });
      const a = h('a', { href: URL.createObjectURL(blob), download: 'jarvis-paminnelse.ics' });
      document.append(body, a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    }, { kind: 'soft', small: true, icon: 'calendar' }));
  }
  append(wrap, acts);
  return wrap;
}

// ---------------- En ting ----------------

export function openThing(id) {
  const th0 = find(id);
  if (!th0) return null;
  const api = openSheet({
    eyebrow: KINDS[th0.kind],
    title: th0.title,
    render(body, a) {
      const th = find(id);
      if (!th) { append(body, h('p', { class: 'empty' }, 'Denne er slettet.')); return; }
      a.setTitle(th.title);
      const title = h('input', { class: 'input', id: 'th-title', value: th.title });
      title.addEventListener('change', () => { if (title.value.trim()) actions.edit(th.id, { title: title.value.trim() }); else title.value = th.title; });
      append(body, field('Tittel', title));
      append(body, h('div', { class: 'actions' }, h('span', { class: 'tag' }, KINDS[th.kind]), retChip(th, () => openRetPicker(th)), th.status === 'arkiv' ? h('span', { class: 'tag' }, 'i arkivet') : null, th.status === 'ferdig' ? h('span', { class: 'tag' }, `ferdig ${ago(th.doneAt)}`) : null));
      if (th.why) append(body, h('p', { class: 'small muted' }, th.why));
      if (th.conflict) append(body, h('p', { class: 'warn' }, `Obs: samtidig med ${th.conflict}.`));

      if (th.kind === 'avtale') append(body, eventEditor(th));
      if (th.kind === 'frist') append(body, stepsBlock(th));
      if (th.draft) {
        append(body, h('div', { class: 'card flat' }, h('p', { class: 'label' }, th.draft.channel === 'epost' ? 'E-postutkast' : 'Meldingsutkast'), h('p', { class: 'draft-text' }, th.draft.body), h('div', { class: 'actions' }, button('Åpne utkastet', () => openDraft(th.id), { kind: 'primary', small: true, icon: th.draft.channel === 'epost' ? 'mail' : 'message' }))));
      }
      if (['oppgave', 'frist'].includes(th.kind) && th.status === 'aktiv') {
        const step = th.kind === 'frist' ? nextStep(th) : null;
        append(body, h('div', { class: 'note' }, h('b', null, 'Første lille steg: '), step ? step.title : firstSmallStep(th)));
      }
      const acts = h('div', { class: 'actions' });
      if (th.status === 'aktiv' && ['oppgave', 'frist', 'handle'].includes(th.kind)) {
        append(acts, button('Start', () => { closeSheet(); const st = th.kind === 'frist' ? nextStep(th) : null; app.startFocus({ thingId: th.id, stepId: st?.id || null, title: st?.title || th.title, minutes: Math.min(25, st?.estimateMin || th.estimateMin || 25) }); }, { kind: 'primary', icon: 'play' }));
        append(acts, button('Gjør den mindre', () => { const l = actions.makeSmaller(th.id); undoToast('Gjort mindre.', l); }, { icon: 'smaller' }));
      }
      if (th.status === 'aktiv' && th.kind !== 'avtale') append(acts, button('Ferdig', () => { const l = actions.done(th.id); closeSheet(); undoToast(`Ferdig: «${th.title}».`, l); }, { icon: 'check' }));
      if (th.status !== 'aktiv') append(acts, button('Åpne igjen', () => { actions.reopen(th.id); }, { icon: 'comeback' }));
      append(body, acts);
      if (th.ret?.type === 'tid' && th.status === 'aktiv') append(body, phoneReminder(th.title, th.ret.at));
      const danger = h('div', { class: 'actions' },
        th.status === 'aktiv' && th.kind !== 'avtale' ? button('Legg i arkivet', () => { const l = actions.archive(th.id); closeSheet(); undoToast(`«${th.title}» ligger i arkivet.`, l); }, { kind: 'ghost', small: true, icon: 'archive' }) : null,
        button('Slett', () => { const l = actions.remove(th.id); closeSheet(); undoToast(`Slettet «${th.title}».`, l); }, { kind: 'ghost', small: true, icon: 'trash' }));
      append(body, danger, h('p', { class: 'small muted' }, `Fanget ${ago(th.createdAt)}${th.text && th.text !== th.title ? `: «${th.text}»` : ''}.`));
    },
  });
  const sub = store.subscribe(() => {
    const a = document.activeElement;
    if (a && api.sheet.contains(a) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName)) return;
    api.refresh();
  });
  api.onClose = () => sub();
  return api;
}

function eventEditor(th) {
  const d = new Date(th.start);
  const date = h('input', { class: 'input', type: 'date', id: 'ev-date', value: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` });
  const time = h('input', { class: 'input', type: 'time', id: 'ev-time', value: th.allDay ? '' : hhmm(th.start) });
  const travel = h('input', { class: 'input', type: 'number', id: 'ev-travel', min: '0', max: '240', inputmode: 'numeric', value: th.travelMin || '', placeholder: 'min' });
  const save = () => {
    const [y, m, dd] = date.value.split('-').map(Number);
    if (!y) return;
    const [hh, mi] = (time.value || '09:00').split(':').map(Number);
    const start = new Date(y, m - 1, dd, hh, mi).getTime();
    if (start !== th.start || (th.allDay && time.value)) actions.moveEvent(th.id, start);
    const tm = Number(travel.value) || null;
    if (tm !== (th.travelMin || null)) actions.edit(th.id, { travelMin: tm, ret: { type: 'tid', at: start - ((tm || 0) + 15) * MIN } }, `Reisetid ${tm || 0} min for «${th.title}».`);
  };
  for (const el of [date, time, travel]) el.addEventListener('change', save);
  return h('div', { class: 'grid2' }, field('Dato', date), field('Klokkeslett', time), field('Reisetid (minutter)', travel),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Avtale'), h('div', { class: 'actions' }, button('Avlys', () => { const l = actions.cancelEvent(th.id); closeSheet(); undoToast(`Avlyste «${th.title}».`, l); }, { kind: 'soft', small: true }))));
}

function stepsBlock(th) {
  const t = now();
  if (th.steps.some((s) => s.at)) return timedStepsBlock(th, t);
  const done = th.steps.filter((s) => s.done).length;
  return h('div', { class: 'card flat' },
    h('div', { class: 'section-head', style: { padding: '0' } }, h('p', { class: 'h3' }, `${done} av ${th.steps.length} steg`), h('span', { class: 'tag', style: { color: 'var(--clay)' } }, `frist ${fmtDate(th.due - 1)}`)),
    h('div', { class: 'progress' }, h('i', { style: { width: `${(done / th.steps.length) * 100}%` } })),
    h('div', { class: 'steps' }, th.steps.map((s) => h('div', { class: `step${s.done ? ' done' : ''}` },
      h('button', { type: 'button', class: `check sm${s.done ? ' on' : ''}`, 'aria-label': s.done ? `Åpne steget «${s.title}» igjen` : `Merk steget «${s.title}» som gjort`, onClick: () => actions.stepDone(th.id, s.id, !s.done) }, icon('check', { size: 13 })),
      h('span', null, s.title),
      h('small', null, s.done ? 'gjort' : startOfDay(s.day) === startOfDay(t) ? 'i dag' : startOfDay(s.day) === addDays(startOfDay(t), 1) ? 'i morgen' : s.day < startOfDay(t) ? 'flyttes' : `${WEEKDAYS[new Date(s.day).getDay()].slice(0, 3)} ${new Date(s.day).getDate()}. ${MONTHS_SHORT[new Date(s.day).getMonth()]}`)))),
    h('div', { class: 'actions' }, button('Gjør neste steg mindre', () => { const l = actions.makeSmaller(th.id); undoToast('Steget er delt i to.', l); }, { kind: 'soft', small: true, icon: 'smaller' })));
}

/** Frister med planlagte økter: klokkeslett, «Se planen» og finpuss. */
function timedStepsBlock(th, t) {
  const work = th.steps.filter((s) => !s.deliver && !s.kick);
  const done = work.filter((s) => s.done).length;
  const when = (s) => (s.done ? 'gjort' : !s.at ? 'uten tid' : `${startOfDay(s.at) === startOfDay(t) ? 'i dag' : startOfDay(s.at) === addDays(startOfDay(t), 1) ? 'i morgen' : `${WEEKDAYS[new Date(s.at).getDay()].slice(0, 3)} ${new Date(s.at).getDate()}.`} ${hhmm(s.at)}`);
  return h('div', { class: 'card flat' },
    h('div', { class: 'section-head', style: { padding: '0' } }, h('p', { class: 'h3' }, `${done} av ${work.length} økter`), h('span', { class: 'tag', style: { color: 'var(--clay)' } }, `frist ${fmtDate(th.due - 1)}${th.dueHasTime ? ` kl. ${hhmm(th.due)}` : ''}`)),
    h('div', { class: 'progress' }, h('i', { style: { width: `${(done / Math.max(1, work.length)) * 100}%` } })),
    th.plan?.summary ? h('p', { class: 'small muted' }, th.plan.summary) : null,
    h('div', { class: 'steps' }, th.steps.map((s) => h('div', { class: `step${s.done ? ' done' : ''}` },
      h('button', { type: 'button', class: `check sm${s.done ? ' on' : ''}`, 'aria-label': s.done ? `Åpne «${s.title}» igjen` : `Merk «${s.title}» som gjort`, onClick: () => actions.stepDone(th.id, s.id, !s.done) }, icon('check', { size: 13 })),
      h('span', null, s.deliver ? h('b', null, s.title) : s.title),
      h('small', null, when(s))))),
    h('div', { class: 'actions' },
      button('Se planen', () => openPlan(th.id), { kind: 'soft', small: true, icon: 'plan' }),
      button('Finpuss planen', () => openPlan(th.id, { start: 'q' }), { kind: 'text', small: true, icon: 'sparkle' }),
      button('Gjør neste økt mindre', () => { const l = actions.makeSmaller(th.id); undoToast('Økta er delt i to.', l); }, { kind: 'text', small: true, icon: 'smaller' })));
}

// ---------------- Utkast ----------------

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function sendHref(d) {
  if (d.channel === 'epost') return `mailto:${encodeURIComponent(d.address || '')}?subject=${encodeURIComponent(d.subject || '')}&body=${encodeURIComponent(d.body || '')}`;
  return `sms:${(d.phone || '').replace(/[^\d+]/g, '')}${isIOS() ? '&' : '?'}body=${encodeURIComponent(d.body || '')}`;
}

export function openDraft(id) {
  const th0 = find(id);
  if (!th0?.draft) return;
  focusPerson.name = th0.draft.to;
  const api = openSheet({
    eyebrow: th0.draft.channel === 'epost' ? 'E-postutkast' : 'Meldingsutkast',
    title: `Til ${th0.draft.to}`,
    onClose: () => { focusPerson.name = null; },
    render(body) {
      const th = find(id);
      if (!th?.draft) { append(body, h('p', { class: 'empty' }, 'Utkastet er borte.')); return; }
      const d = th.draft;
      const person = ds().people.find((p) => p.name === d.to);
      const addr = h('input', { class: 'input', id: 'dr-addr', type: d.channel === 'epost' ? 'email' : 'tel', inputmode: d.channel === 'epost' ? 'email' : 'tel', value: d.channel === 'epost' ? (d.address || person?.email || '') : (d.phone || person?.phone || ''), placeholder: d.channel === 'epost' ? 'adresse@eksempel.no' : 'Telefonnummer (valgfritt)' });
      const subj = d.channel === 'epost' ? h('input', { class: 'input', id: 'dr-subj', value: d.subject || '' }) : null;
      const text = h('textarea', { class: 'textarea', id: 'dr-body' }, d.body);
      const sync = () => {
        const p = { body: text.value };
        if (d.channel === 'epost') { p.address = addr.value.trim(); p.subject = subj.value; } else p.phone = addr.value.trim();
        actions.draftEdit(id, p);
        link.href = sendHref({ ...d, ...p });
      };
      const placeholders = () => /\[[^\]]+\]/.test(text.value);
      const warn = h('p', { class: 'warn', hidden: !placeholders() }, 'Fyll inn det som står i [klammer] før du sender.');
      text.addEventListener('input', () => { sync(); warn.hidden = !placeholders(); });
      addr.addEventListener('input', sync);
      subj?.addEventListener('input', sync);
      const link = h('a', { class: 'btn btn-primary', href: sendHref(d), target: '_top', onClick: () => { sync(); setTimeout(() => actions.draftOpened(id), 50); } }, icon(d.channel === 'epost' ? 'mail' : 'message', { size: 18 }), d.channel === 'epost' ? 'Åpne i e-post' : 'Åpne i Meldinger');
      append(body, 
        field(d.channel === 'epost' ? 'Til (e-post)' : 'Til (telefon)', addr),
        subj ? field('Emne', subj) : null,
        field('Tekst', text), warn,
        h('div', { class: 'actions' }, link,
          button('Kopier tekst', async () => { const ok = await copyText(text.value, text); toast(ok ? 'Kopiert. Lim inn der du vil sende.' : 'Teksten er markert. Kopier den selv.', { timeout: 2600 }); }, { icon: 'copy' }),
        ),
        d.channel === 'epost' && agentsRuntime().gmailUsable() ? gmailSend(id, () => ({ to: addr.value.trim(), subject: subj.value, body: text.value }), sync) : null,
        h('p', { class: 'small muted' }, app.inArtifact
          ? 'Jarvis sender aldri selv. På claude.ai åpner knappen ikke alltid Meldinger; bruk «Kopier tekst» hvis ingenting skjer.'
          : 'Jarvis sender aldri selv. Knappen åpner telefonens egen app med teksten ferdig, så trykker du send der.'),
        h('div', { class: 'actions' },
          button('Jeg har sendt den', () => { const l = actions.draftSent(id); closeSheet(); undoToast(`Sendt til ${d.to}. Bra.`, l); }, { kind: 'soft', icon: 'check' }),
          h('span', { id: 'improve-slot' }),
          button('Slett utkast', () => { const l = actions.remove(id); closeSheet(); undoToast('Utkastet er slettet.', l); }, { kind: 'ghost', small: true, icon: 'trash' })),
      );
      if (d.status === 'apnet') body.prepend(h('p', { class: 'note' }, `Du åpnet utkastet ${ago(d.openedAt)}. Sendte du det?`));
      brain.claudeReady().then((sample) => {
        const slot = body.querySelector('#improve-slot');
        if (!sample || !slot) return;
        slot.replaceWith(button('Skriv bedre med Claude', async (e) => {
          const b = e.currentTarget;
          b.disabled = true;
          b.querySelector('span:last-child').textContent = 'Skriver …';
          try {
            const better = await brain.improveDraft(find(id));
            actions.draftEdit(id, { body: better });
            text.value = better;
            sync();
            warn.hidden = !placeholders();
            toast('Utkastet er skrevet om. Les over før du sender.', { timeout: 3000 });
          } catch (err) { toast(brain.noteError(err), { timeout: 3500 }); }
          b.disabled = false;
          b.querySelector('span:last-child').textContent = 'Skriv bedre med Claude';
        }, { kind: 'text', small: true, icon: 'sparkle' }));
      });
    },
  });
  return api;
}

/** «Send med Gmail»: Budbringeren sender, men først etter at du har sett mottaker og tekst og trykket to ganger. */
function gmailSend(id, read, sync) {
  const box = h('div', { class: 'card flat gmail-send', style: { gap: '8px' } });
  const idle = () => {
    box.replaceChildren(
      h('p', { class: 'small muted' }, 'Gmail er koblet til. Budbringeren kan sende e-posten for deg, men bare når du trykker.'),
      h('div', { class: 'actions' }, button('Send med Gmail', () => {
        sync();
        const m = read();
        if (!/@/.test(m.to)) { toast('Skriv inn e-postadressen først.', { timeout: 3000 }); return; }
        if (/\[[^\]]+\]/.test(m.body)) { toast('Fyll inn det som står i [klammer] først.', { timeout: 3000 }); return; }
        confirm(m);
      }, { kind: 'soft', icon: 'send' })));
  };
  const confirm = (m) => {
    box.replaceChildren(
      h('p', null, h('b', null, `Sende til ${m.to} nå?`)),
      m.subject ? h('p', { class: 'small muted' }, `Emne: ${m.subject}`) : null,
      h('div', { class: 'actions' },
        button('Ja, send', async (e) => {
          e.currentTarget.disabled = true;
          try {
            const text = await agentsRuntime().sendEmail(m, 'send');
            const l = actions.draftSent(id);
            actions.agentRan('budbringer', `${text} Du godkjente.`);
            closeSheet();
            undoToast(text, l);
          } catch (err) {
            box.replaceChildren(h('p', { class: 'warn' }, ['server_unavailable', 'upstream_error'].includes(err?.code) ? 'Fikk ikke svar fra Gmail. Sjekk Sendt i Gmail før du prøver igjen.' : `Det gikk ikke: ${err?.message || err?.code || 'ukjent feil'}`), button('Prøv igjen', idle, { kind: 'text', small: true }));
          }
        }, { kind: 'primary', icon: 'send' }),
        button('Lagre som utkast i Gmail', async () => { try { toast(await agentsRuntime().sendEmail(m, 'utkast'), { timeout: 4000 }); } catch (err) { toast(`Det gikk ikke: ${err?.code || 'ukjent feil'}`, { timeout: 4000 }); } }, { kind: 'soft', small: true }),
        button('Avbryt', idle, { kind: 'text', small: true })));
  };
  idle();
  return box;
}

// ---------------- Samtale ----------------

export function openThread({ answer = null, question = null } = {}) {
  let busy = false;
  const api = openSheet({
    eyebrow: 'Samtale',
    title: 'Jarvis',
    full: true,
    render(body) {
      const msgs = ds().chat.filter((m) => m.at > now() - 3 * HOUR);
      if (!msgs.length) {
        append(body, h('div', { class: 'empty', style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' } },
          h('span', { class: 'orb lg', 'aria-hidden': 'true' }),
          h('p', null, 'Si det som det er. Jeg sorterer og gir det tilbake når du trenger det.'),
          h('div', { class: 'actions', style: { justifyContent: 'center' } }, ['Hva har jeg i dag?', 'Når må jeg gå?', 'Hva skal jeg gjøre nå?', 'Hva har jeg glemt?'].map((q) => h('button', { type: 'button', class: 'chip', onClick: () => ask(q) }, q)))));
      }
      const th = h('div', { class: 'thread' });
      for (const m of msgs) {
        append(th, h('div', { class: `msg ${m.role === 'du' ? 'me' : 'ai'}` }, m.text.split('\n').map((p) => h('p', null, p))));
        if (m.cards?.length) append(th, h('div', { class: 'msg-cards' }, m.cards.map((c) => miniCard(c))));
      }
      append(body, th);
      setTimeout(() => { body.scrollTop = body.scrollHeight; }, 30);
    },
    foot(footEl) {
      const inp = h('input', { class: 'input', id: 'thread-in', placeholder: 'Skriv til Jarvis …', enterkeyhint: 'send', autofocus: true });
      const f = h('form', { style: { display: 'flex', gap: '8px', alignItems: 'center' }, onSubmit: (e) => { e.preventDefault(); if (inp.value.trim()) { ask(inp.value.trim()); inp.value = ''; } } },
        h('span', { class: 'orb', id: 'thread-orb', 'aria-hidden': 'true' }), inp, h('button', { type: 'submit', class: 'send', 'aria-label': 'Send' }, icon('arrow', { size: 20 })));
      append(footEl, f);
    },
  });
  async function ask(text) {
    if (busy) return;
    busy = true;
    actions.chat('du', text);
    api.refresh();
    const orb = api.sheet.querySelector('#thread-orb');
    const res = await brain.handle(text, { onState: (s) => orb?.setAttribute('data-state', s) });
    actions.chat('jarvis', replyText(res), res.saved.map((t) => ({ id: t.id })));
    busy = false;
    api.refresh();
    afterHandle(res, { inThread: true });
  }
  if (question) { ask(question); }
  else if (answer) { api.refresh(); }
  return api;
}

function miniCard(c) {
  const th = find(c.id);
  if (!th) return h('div', { class: 'mini muted small' }, 'Angret eller slettet.');
  return h('div', { class: 'mini' },
    h('div', { class: 'mini-head' }, kindDot(th.kind), h('span', null, th.title)),
    h('div', { class: 'actions' }, retChip(th, () => openRetPicker(th)), th.draft && th.draft.status !== 'sendt' ? button('Se utkastet', () => openDraft(th.id), { kind: 'text', small: true }) : button('Åpne', () => openThing(th.id), { kind: 'text', small: true })));
}

/** Teksten Jarvis svarer med. Sier aldri «Gjort» om noe som ikke ble gjort. */
export function replyText(res) {
  const parts = [];
  if (res.answer) parts.push(res.answer);
  parts.push(...res.done);
  if (res.saved.length === 1) parts.push(res.lines[0]);
  else if (res.saved.length > 1) parts.push(`Jeg sorterte det i ${res.saved.length} ting:\n${res.lines.map((l) => `• ${l}`).join('\n')}`);
  if (res.note) parts.push(res.note);
  return parts.join('\n') || 'Jeg fant ingenting å gjøre med det. Prøv å si det på en annen måte.';
}

/** Etter at hjernen har jobbet: åpne fokus, «står fast» eller Uka di. */
export function afterHandle(res, { inThread = false } = {}) {
  if (res.focus) { if (inThread) closeSheet(); app.startFocus(res.focus); }
  if (res.open === 'fast') openStuck();
  if (res.open === 'uke') openWeek();
  app.render();
}

// ---------------- Står fast ----------------

export function openStuck(thingId = null) {
  const n = nowState();
  const th = thingId ? find(thingId) : n.pick?.thing;
  const light = n.alternatives.find((u) => u.est <= 15 && u.thing.id !== th?.id);
  const ways = [
    th ? { t: 'Bare fem minutter', s: `Start «${th.title}» og stopp etter fem minutter hvis du vil.`, go: () => app.startFocus({ thingId: th.id, title: th.title, minutes: 5, stepId: th.kind === 'frist' ? nextStep(th)?.id : null }) } : null,
    th ? { t: 'Gjør den mindre', s: firstSmallStep(th), go: () => { const l = actions.makeSmaller(th.id); undoToast('Gjort mindre.', l); } } : null,
    light ? { t: 'Ta noe lett først', s: `«${light.title}» tar rundt ${light.est} minutter.`, go: () => app.startFocus({ thingId: light.thing.id, title: light.title, minutes: Math.max(5, light.est) }) } : null,
  ].filter(Boolean).sort(() => Math.random() - 0.5);
  ways.push({ t: 'Hvil i ti minutter', s: 'Gå fra skjermen. Jeg sier fra når tiden er ute.', go: () => app.startFocus({ thingId: null, title: 'Pause', minutes: 10, pause: true }) });
  openSheet({
    eyebrow: 'Står fast',
    title: 'Velg én vei inn',
    render(body) {
      append(body, h('p', { class: 'muted' }, 'Det er vanlig å stå fast. Du trenger ikke motivasjon først; du trenger et lite nok steg.'));
      append(body, h('div', { class: 'pick' }, ways.map((w) => h('button', { type: 'button', onClick: () => { closeSheet(); w.go(); } }, h('b', null, w.t), h('span', null, w.s)))));
      append(body, h('p', { class: 'small muted' }, 'Rekkefølgen er tilfeldig, så du ikke alltid tar den første.'));
    },
  });
}

// ---------------- Morgenbrief og kveld ----------------

export function briefData() {
  return morningBrief({ now: now(), weather: weather.data, events: eventsOf(ds()), things: ds().things, energy: energyToday(ds()), place: currentPlace(ds()), settings: store.settings });
}

export function briefSpeech(b) {
  const lines = [b.greeting, ...b.lines.map((l) => [l.text, l.action].filter(Boolean).join(' '))];
  if (b.steps.length) lines.push(`I dag: ${b.steps.map((s) => (s.step.at ? `${s.step.deliver ? '' : 'økt '}kl. ${hhmm(s.step.at)}, ${s.step.title}` : s.step.title)).join('; ')}.`);
  if (b.waiting?.length) lines.push(`Kan vente: ${b.waiting.map((x) => x.thing.title).join(', ')}.`);
  if (b.one) lines.push(`Det viktigste når du har tid: ${b.one.title}.`);
  return lines.join(' ');
}

export function openBrief() {
  openSheet({
    eyebrow: `Morgenbrief · ${fmtDate(now())}`,
    title: briefData().greeting,
    render(body) {
      const b = briefData();
      const w = weather.data;
      for (const l of b.lines) {
        append(body, h('div', { class: 'card flat', style: { gap: '6px' } },
          h('p', { class: 'label' }, { vaer: `Været${w ? ` · ${SOURCE_LABEL[w.source] || w.source}` : ''}`, forst: 'Første avtale', frist: 'Frist snart' }[l.kind]),
          h('p', null, l.text), l.action ? h('p', { style: { fontWeight: '650' } }, l.action) : null));
      }
      if (b.steps.length) append(body, h('div', { class: 'card flat', style: { gap: '6px' } }, h('p', { class: 'label' }, b.steps.some((s) => s.step.at) ? 'Dagens økter' : 'Dagens steg'), b.steps.map((s) => h('p', null, s.step.at ? h('b', { class: 'mono' }, `${hhmm(s.step.at)} `) : null, `${s.step.title} `, h('span', { class: 'muted small' }, `(${s.thing.title})`)))));
      if (b.waiting?.length) append(body, h('div', { class: 'card flat', style: { gap: '4px' } }, h('p', { class: 'label' }, 'Kan vente i dag'), h('div', { class: 'list' }, b.waiting.slice(0, 4).map((x) => waitingRow(x)))));
      if (b.comingBack.length) append(body, h('div', { class: 'card flat', style: { gap: '6px' } }, h('p', { class: 'label' }, 'Kommer tilbake i dag'), b.comingBack.slice(0, 5).map((t) => h('p', null, `${hhmm(t.ret.at)} · ${t.title}`))));
      if (b.undecided.length) append(body, undecidedBlock(b.undecided));
      append(body, energyBlock());
      const read = button(voice.speaking ? 'Stopp opplesing' : 'Les høyt', () => { if (voice.speaking) voice.stop(); else voice.speak(briefSpeech(b)); refreshSheets(); }, { icon: voice.speaking ? 'stop' : 'wave' });
      append(body, h('div', { class: 'actions' }, voice.canSpeak ? read : null, button('Ferdig', () => { actions.markSeen('brief'); closeSheet(); app.render(); }, { kind: 'primary' })));
    },
  });
}

export function energyBlock() {
  const e = energyToday(ds());
  return h('div', { class: 'field' }, h('span', { class: 'label' }, 'Energi i dag'),
    seg([['lav', 'Lav'], ['middels', 'Middels'], ['hoy', 'Høy']], e, (v) => { actions.setEnergy(v); refreshSheets(); app.render(); }, { label: 'Energi i dag' }),
    h('p', { class: 'small muted' }, e === 'lav' ? 'Nå-kortet foreslår korte og lette ting først.' : e === 'hoy' ? 'Nå-kortet foreslår gjerne noe tungt mens du har energi.' : 'Ett trykk. Nå-kortet tar hensyn til det.'));
}

function undecidedBlock(list) {
  return h('div', { class: 'card flat', style: { gap: '10px' } },
    h('p', { class: 'label' }, list.length === 1 ? 'Én tanke uten plan' : `${list.length} tanker uten plan`),
    list.slice(0, 5).map((t) => h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
      h('p', { style: { fontWeight: '550' } }, t.title),
      h('div', { class: 'actions' },
        button('Gjør i dag', () => { const l = actions.edit(t.id, { kind: 'oppgave', ret: { type: 'ledig' } }, `«${t.title}» er en oppgave for i dag.`); undoToast('Lagt til i dag.', l); refreshSheets(); }, { kind: 'soft', small: true }),
        button('Senere', () => openRetPicker(t), { kind: 'soft', small: true }),
        button('Arkiv', () => { const l = actions.archive(t.id); undoToast('Lagt i arkivet.', l); refreshSheets(); }, { kind: 'ghost', small: true })))));
}

export function wrapData() {
  return eveningWrap({ now: now(), things: ds().things, sessions: ds().sessions });
}

export function openWrap() {
  openSheet({
    eyebrow: 'Kveldsavslutning · to minutter',
    title: 'Dagen din',
    render(body) {
      const w = wrapData();
      const wins = [...w.done.map((t) => t.title), ...w.stepsDone.map((s) => s.step.title)];
      append(body, h('div', { class: 'card flat' }, h('p', { class: 'label' }, 'Dette fikk du til'),
        wins.length ? h('ul', { class: 'wins' }, wins.slice(0, 8).map((t) => h('li', null, icon('check', { size: 16 }), t))) : h('p', { class: 'muted' }, 'Noen dager handler om å komme gjennom. Det teller også.'),
        w.focusMin ? h('p', { class: 'small muted' }, `${fmtDuration(w.focusMin)} i fokus.`) : null));
      if (w.unfinished.length) {
        append(body, h('div', { class: 'card flat' }, h('p', { class: 'label' }, 'Til i morgen'),
          w.unfinished.slice(0, 8).map((t) => h('p', null, t.title)),
          h('div', { class: 'actions' }, button('Flytt alt til morgenbriefen', () => {
            const at = briefAt(addDays(startOfDay(now()), 1), store.settings);
            const l = actions.setRetMany(w.unfinished.map((t) => t.id), { type: 'tid', at }, `${w.unfinished.length} ting fra i dag kommer i morgen kl. ${store.settings.briefTime}.`);
            undoToast(`${w.unfinished.length} ting kommer i morgen kl. ${store.settings.briefTime}.`, l);
            refreshSheets();
          }, { kind: 'primary', small: true }))));
      }
      if (w.tomorrowSessions?.length) {
        append(body, h('div', { class: 'card flat', style: { gap: '6px' } }, h('p', { class: 'label' }, 'I morgen har du satt av'),
          w.tomorrowSessions.slice(0, 5).map((x) => h('p', null, h('b', { class: 'mono' }, `${hhmm(x.step.at)} `), x.step.deliver ? `${x.step.title}: ${x.thing.title}` : `${x.step.title} `, x.step.deliver ? null : h('span', { class: 'muted small' }, `(${x.thing.title})`))),
          h('p', { class: 'small muted' }, 'Jeg sier fra når det er tid. I kveld kan du la det ligge.')));
      }
      append(body, h('div', { class: 'actions' }, button('Ferdig for i dag', () => { actions.markSeen('wrap'); closeSheet(); app.render(); }, { kind: 'soft' })));
    },
  });
}

// ---------------- Uka di ----------------

export function openWeek() {
  openSheet({
    eyebrow: `Uka di · fra ${fmtDate(startOfDay(now() - ((new Date(now()).getDay() + 6) % 7) * DAY))}`,
    title: 'Dette fikk du til',
    render(body) {
      const w = weekReview({ now: now(), things: ds().things, sessions: ds().sessions, comebacks: ds().comebacks });
      append(body, h('div', { class: 'stat-grid' },
        h('div', { class: 'stat' }, h('b', null, String(w.done.length)), h('span', null, 'ting gjort')),
        h('div', { class: 'stat' }, h('b', null, String(w.stepsDone)), h('span', null, 'steg på frister')),
        h('div', { class: 'stat' }, h('b', null, String(w.focusMin)), h('span', null, 'minutter i fokus')),
        h('div', { class: 'stat' }, h('b', null, String(w.comebacks)), h('span', null, w.comebacks === 1 ? 'comeback' : 'comebacks'))));
      append(body, h('p', { class: 'small muted' }, 'Ingen rekker som kan brytes. En dag du kom tilbake, er en god dag.'));
      if (w.done.length) append(body, h('div', { class: 'card flat' }, h('p', { class: 'label' }, 'Gjort'), h('ul', { class: 'wins' }, w.done.slice(0, 10).map((t) => h('li', null, icon('check', { size: 16 }), t.title)))));
      if (w.ideas.length) {
        append(body, h('div', { class: 'card flat' }, h('p', { class: 'label' }, 'Idéer som venter på deg'),
          w.ideas.map((t) => h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, h('p', null, t.title),
            h('div', { class: 'actions' },
              button('Gjør til oppgave', () => { const l = actions.edit(t.id, { kind: 'oppgave', ret: { type: 'ledig' } }, `Idéen «${t.title}» er nå en oppgave.`); undoToast('Nå er det en oppgave.', l); refreshSheets(); }, { kind: 'soft', small: true }),
              button('Behold', () => { const l = actions.setRet(t.id, { type: 'uke' }); undoToast('Den kommer neste søndag.', l); }, { kind: 'soft', small: true }),
              button('Arkiv', () => { const l = actions.archive(t.id); undoToast('Lagt i arkivet.', l); refreshSheets(); }, { kind: 'ghost', small: true }))))));
      }
    },
  });
}

// ---------------- Bak kulissene ----------------

export function openBehind() {
  const api = openSheet({
    eyebrow: 'Bak kulissene',
    title: 'Hva Jarvis har gjort',
    full: true,
    render(body) {
      append(body, h('p', { class: 'muted' }, 'Du snakker med én assistent. Bak den jobber agenter og faste jobber med hver sin oppgave. Alt de gjør, står her, og det meste kan angres.'), h('div', { class: 'actions' }, button('Se agentene', () => { closeSheet(); app.go('agenter'); }, { kind: 'soft', small: true, icon: 'staben' })));
      append(body, h('div', { class: 'list' }, JOBS.map((j) => h('div', { class: 'logline' },
        h('time', null, ds().jobs?.[j.id]?.lastRun ? hhmm(ds().jobs[j.id].lastRun) : '–'),
        h('div', null, h('p', { class: 'who' }, j.name), h('p', { class: 'small' }, j.does))))));
      append(body, h('p', { class: 'note' }, app.inArtifact || !('Notification' in window)
        ? 'I nettversjonen kjører jobbene når du åpner appen, og påminnelser kommer mens appen er åpen. Vil du ha varsel på låseskjermen, legg tingen i telefonens kalender fra tilbakekomst-arket.'
        : 'I nettversjonen kjører jobbene mens appen er åpen. I en iPhone-app skal de kjøre på en server, så varsler kommer også når appen er lukket.'));
      append(body, h('p', { class: 'h3' }, 'Logg'));
      const log = ds().log.slice(0, 80);
      append(body, log.length ? h('div', { class: 'list' }, log.map((e) => h('div', { class: `logline${e.undone ? ' undone' : ''}` },
        h('time', null, startOfDay(e.at) === startOfDay(now()) ? hhmm(e.at) : `${new Date(e.at).getDate()}.${new Date(e.at).getMonth() + 1}`),
        h('div', { style: { flex: '1', minWidth: '0' } }, h('p', { class: 'who' }, WHO[e.by] || e.by), h('p', null, e.text), e.why ? h('p', { class: 'small muted' }, e.why) : null),
        e.undo?.length && !e.undone ? button('Angre', () => { actions.undo(e.id); api.refresh(); app.render(); }, { kind: 'text', small: true }) : null))) : h('p', { class: 'empty' }, 'Ingenting ennå.'));
    },
  });
}

// ---------------- Innstillinger ----------------

export function openSettings() {
  const api = openSheet({
    eyebrow: store.demo ? 'Du ser eksempeldagen' : 'Dine egne ting',
    title: 'Meg',
    full: true,
    render(body) {
      const s = store.settings;
      const set = (p) => { store.updateSettings(p); app.applySettings?.(); api.refresh(); };
      const name = h('input', { class: 'input', id: 'set-name', value: s.name, placeholder: 'Fornavn', autocomplete: 'given-name' });
      name.addEventListener('change', () => set({ name: name.value.trim() }));
      const city = h('select', { class: 'select', id: 'set-city' }, Object.values(CITIES).map((c) => h('option', { value: c.id, selected: c.id === s.city }, c.name)));
      city.addEventListener('change', () => { set({ city: city.value }); weather.refresh(() => app.render(), { force: true }); });
      append(body, h('div', { class: 'card flat' }, h('p', { class: 'h3' }, 'Deg'), field('Navn', name), field('By (for været)', city)));

      append(body, h('div', { class: 'card flat' }, h('p', { class: 'h3' }, 'Data'),
        seg([['eksempel', 'Eksempeldag'], ['ekte', 'Mine ting']], s.mode, (v) => { set({ mode: v }); app.render(); }, { label: 'Hvilke data' }),
        h('p', { class: 'small muted' }, s.mode === 'eksempel' ? 'Eksempeldagen er en tenkt student. Ingenting her er ditt. Den lages på nytt hver dag.' : store.storageNote),
        h('div', { class: 'actions' },
          app.downloads ? button('Last ned mine data (.json)', async () => { try { await app.downloads.save({ filename: 'jarvis-data.json', data: store.exportJson() }); } catch (e) { if (e?.code !== 'declined') toast('Kunne ikke lagre filen her.', { timeout: 3000 }); } }, { kind: 'soft', small: true }) : (!app.inArtifact ? button('Last ned mine data (.json)', () => { const a = h('a', { href: URL.createObjectURL(new Blob([store.exportJson()], { type: 'application/json' })), download: 'jarvis-data.json' }); document.append(body, a); a.click(); a.remove(); }, { kind: 'soft', small: true }) : null),
          fileButton('Hent inn data (.json)', '.json,application/json', (text) => { try { store.importJson(text); toast('Dataene er hentet inn.', { timeout: 3000 }); api.refresh(); } catch (e) { toast(e.message || 'Kunne ikke lese filen.', { timeout: 4000 }); } }),
          s.mode === 'eksempel' ? button('Lag eksempeldagen på nytt', () => { store.resetDemo(); toast('Eksempeldagen er laget på nytt.', { timeout: 2500 }); }, { kind: 'ghost', small: true }) : null)));

      append(body, h('div', { class: 'card flat' }, h('p', { class: 'h3' }, 'Sanser'),
        h('p', { class: 'small muted' }, 'Gjør appen roligere eller tydeligere. Følger også telefonens egne valg for bevegelse og gjennomsiktighet.'),
        field('Bevegelse', seg([['full', 'Full'], ['redusert', 'Rolig'], ['av', 'Av']], s.motion, (v) => set({ motion: v }), { label: 'Bevegelse' })),
        field('Glass', seg([['klar', 'Klart'], ['tonet', 'Tonet'], ['solid', 'Solid']], s.glass, (v) => set({ glass: v }), { label: 'Glass' })),
        field('Himmel som følger klokka', seg([['levende', 'Levende'], ['rolig', 'Rolig'], ['av', 'Av']], s.sky, (v) => set({ sky: v }), { label: 'Himmel' })),
        field('Tema', seg([['system', 'Som telefonen'], ['light', 'Lyst'], ['dark', 'Mørkt']], s.theme, (v) => set({ theme: v }), { label: 'Tema' })),
        field('Tekststørrelse', seg([[1, 'Standard'], [1.12, 'Større'], [1.25, 'Størst']], s.textScale, (v) => set({ textScale: v }), { label: 'Tekststørrelse' })),
        field('Lesefont', seg([['system', 'Systemfont'], ['atkinson', 'Atkinson Hyperlegible']], s.font, (v) => set({ font: v }), { label: 'Lesefont' })),
        toggleRow('Lyd og vibrasjon', 'Et mykt pling når en økt er ferdig og når noe kommer tilbake.', s.sound, (v) => set({ sound: v }))));

      const budget = h('input', { type: 'range', id: 'set-budget', min: '0', max: '10', step: '1', value: String(s.nudgeBudget), style: { width: '100%' } });
      const bl = h('span', { class: 'mono' }, String(s.nudgeBudget));
      budget.addEventListener('input', () => { bl.textContent = budget.value; });
      budget.addEventListener('change', () => set({ nudgeBudget: Number(budget.value) }));
      const bt = h('input', { class: 'input', type: 'time', id: 'set-brief', value: s.briefTime });
      bt.addEventListener('change', () => bt.value && set({ briefTime: bt.value }));
      const et = h('input', { class: 'input', type: 'time', id: 'set-evening', value: s.eveningTime });
      et.addEventListener('change', () => et.value && set({ eveningTime: et.value }));
      append(body, h('div', { class: 'card flat' }, h('p', { class: 'h3' }, 'Dytt og tider'),
        h('div', { class: 'field' }, h('label', { for: 'set-budget' }, 'Stillhetsbudsjett: maks antall dytt om dagen ', bl), budget,
          h('p', { class: 'small muted' }, 'Når budsjettet er brukt, venter resten stille på Nå-skjermen.')),
        h('div', { class: 'grid2' }, field('Morgenbrief', bt), field('Kveldsavslutning', et)),
        toggleRow('Innsjekk i økter', 'Et kort spørsmål halvveis og på slutten av en økt.', s.checkins, (v) => set({ checkins: v })),
        !app.inArtifact && 'Notification' in window ? toggleRow('Varsler i nettleseren', Notification.permission === 'granted' ? 'Slått på. Kommer mens appen er åpen.' : 'Mens appen er åpen.', Notification.permission === 'granted', async () => { try { await Notification.requestPermission(); } catch { /* nei */ } api.refresh(); }) : null));

      const ag = { ...(s.agents || {}) };
      const setAg = (p) => set({ agents: { ...ag, ...p } });
      append(body, h('div', { class: 'card flat' }, h('p', { class: 'h3' }, 'Planleggeren'),
        field('Når jobber du best?', seg([['morgen', 'Morgen'], ['ettermiddag', 'Ettermiddag'], ['kveld', 'Kveld']], s.workPrefer, (v) => set({ workPrefer: v }), { label: 'Når jobber du best' })),
        toggleRow('Bruk helga', 'Uten dette legges øktene på hverdager, og helga brukes bare når det er trangt.', s.workWeekend, (v) => set({ workWeekend: v })),
        toggleRow('Spør om å finpusse store oppgaver', 'Etter at du har fanget en frist, viser Jarvis planen og spør om du har to minutter til fire kjappe spørsmål.', s.askPlan !== false, (v) => set({ askPlan: v }))));
      append(body, h('div', { class: 'card flat' }, h('p', { class: 'h3' }, 'Agentene'),
        toggleRow('Kalenderagenten leser Google Kalender', 'Henter avtalene dine hver halvtime mens appen er åpen, så planen tar hensyn til dem.', ag.kalenderLes !== false, (v) => setAg({ kalenderLes: v })),
        toggleRow('Postagenten sjekker Gmail om morgenen', 'Første gang du åpner appen etter morgenbriefen. Bruker Claude, og legger forslag i køen.', !!ag.postAuto, (v) => setAg({ postAuto: v })),
        h('p', { class: 'small muted' }, 'E-post sendes og avtaler skrives bare når du trykker. Det kan ikke slås av.'),
        h('div', { class: 'actions' }, button('Til Agentene', () => { closeSheet(); app.go('agenter'); }, { kind: 'soft', small: true, icon: 'staben' }))));

      append(body, h('div', { class: 'card flat' }, h('p', { class: 'h3' }, 'Claude'),
        toggleRow('Bruk Claude når appen er usikker', 'Sorterer uklare tanker, svarer på åpne spørsmål og skriver bedre utkast. Bruker din Claude-konto og spør om lov første gang.', s.claude, (v) => set({ claude: v })),
        h('p', { class: 'small muted' }, brain.declined ? 'Claude er ikke tillatt for denne siden nå. Appen sorterer selv.' : app.inArtifact ? 'Appen kjører på claude.ai, så Claude er tilgjengelig.' : 'Som fil sorterer appen selv. Claude virker når appen åpnes på claude.ai.')));

      append(body, h('div', { class: 'list' },
        navRow('Bak kulissene', 'Jobbene og alt som er gjort, med angre', () => openBehind()),
        navRow('Uka di', 'Det du fikk til denne uka', () => openWeek()),
        navRow('Kalender', 'Hent inn avtaler fra en kalenderfil', () => openImport()),
        navRow('Været', weather.data ? `${weather.data.place} · ${SOURCE_LABEL[weather.data.source] || weather.data.source}` : 'Ikke tilgjengelig her', () => openWeatherInfo()),
        navRow('Vis oppstarten igjen', 'Navn, sanser og eksempeldag', () => { closeSheet(); openOnboarding(); })));
      append(body, h('p', { class: 'small muted' }, 'Jarvis sender aldri noe uten at du har trykket, og spør aldri om diagnose. Alt du gjør kan angres i Bak kulissene.'));
    },
  });
}

function navRow(title, sub, onClick) {
  return h('button', { type: 'button', class: 'row', onClick },
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, title), h('span', { class: 'small muted' }, sub)), icon('chevron', { size: 18 }));
}

function fileButton(label, accept, onText) {
  const id = `f-${Math.random().toString(36).slice(2, 7)}`;
  const inp = h('input', { type: 'file', accept, id, class: 'sr' });
  inp.addEventListener('change', async () => { const f = inp.files?.[0]; if (f) onText(await f.text()); inp.value = ''; });
  return h('span', null, inp, h('label', { for: id, class: 'btn btn-soft btn-small', role: 'button', tabindex: '0', onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } } }, label));
}

// ---------------- Kalender, vær, sted, ny avtale, ledig luke ----------------

export function openImport() {
  openSheet({
    eyebrow: 'Kalender',
    title: 'Hent inn avtaler',
    render(body) {
      append(body, h('p', { class: 'muted' }, 'Last ned kalenderen som .ics fra Google Kalender, Outlook, itslearning eller timeplanen, og velg filen her. Avtalene blir lest inn i appen; ingenting sendes noe sted.'));
      append(body, fileButton('Velg .ics-fil', '.ics,text/calendar', (text) => {
        const evs = parseIcs(text, { from: now() - DAY, to: now() + 120 * DAY });
        if (!evs.length) { toast('Fant ingen avtaler fra i dag og framover i filen.', { timeout: 3500 }); return; }
        const r = actions.importCalendar(evs);
        closeSheet();
        undoToast(`La inn ${r.added} avtaler.`, r.logId);
      }));
      const ta = h('textarea', { class: 'textarea', id: 'ics-text', placeholder: 'Eller lim inn innholdet i .ics-fila her' });
      append(body, field('Lim inn', ta), button('Les inn', () => {
        const evs = parseIcs(ta.value, { from: now() - DAY, to: now() + 120 * DAY });
        if (!evs.length) { toast('Fant ingen avtaler i teksten.', { timeout: 3000 }); return; }
        const r = actions.importCalendar(evs, 'innlimt tekst');
        closeSheet();
        undoToast(`La inn ${r.added} avtaler.`, r.logId);
      }, { kind: 'soft' }));
      append(body, h('p', { class: 'small muted' }, 'Når Google Kalender kobles til på claude.ai, kan neste versjon lese kalenderen direkte.'));
    },
  });
}

export function openWeatherInfo() {
  openSheet({
    eyebrow: 'Været',
    title: weather.data ? weather.data.place : 'Vær ikke tilgjengelig',
    render(body) {
      const w = weather.data;
      if (w) {
        append(body, h('p', null, wxLine(w, now())));
        const a = weatherAction(w, now(), eventsOf(ds()));
        if (a) append(body, h('p', { style: { fontWeight: '650' } }, a));
        append(body, h('p', { class: 'small muted' }, w.source === 'eksempel' ? 'Dette er eksempelvær for eksempeldagen. Det er ikke ekte.' : `Kilde: ${SOURCE_LABEL[w.source] || w.source}, hentet ${ago(w.at)}.`));
      } else {
        append(body, h('p', null, 'Her er nettet stengt for appen, så jeg kan ikke hente været selv.'));
      }
      append(body, h('div', { class: 'note' }, h('b', null, 'Ekte vær hver morgen: '), app.inArtifact ? 'Åpne appen som fil (jarvis.html) så hentes været fra Open-Meteo. Eller be Claude sette opp en morgenjobb som legger været inn i appen hver morgen.' : 'Som fil hentes været fra Open-Meteo når du er på nett.'));
    },
  });
}

export function openPlace() {
  const cur = currentPlace(ds());
  openSheet({
    eyebrow: 'Sted',
    title: 'Hvor er du?',
    render(body) {
      append(body, h('p', { class: 'muted' }, 'Ting som hører hjemme der, kommer fram. Stedet glemmes etter tre timer. Ingen sporing.'));
      append(body, h('div', { class: 'optlist' }, Object.entries(PLACES).map(([k, v]) => h('button', { type: 'button', class: 'opt', 'aria-pressed': String(cur === k), onClick: () => {
        const l = actions.setPlace(k);
        closeSheet();
        const here = ds().things.filter((t) => t.status === 'aktiv' && t.ret?.type === 'sted' && t.ret.place === k);
        undoToast(here.length ? `Du er ${v}. ${here.length} ${here.length === 1 ? 'ting hører' : 'ting hører'} hjemme her.` : `Du er ${v}.`, l);
        app.render();
      } }, cap(v), h('small', null, `${ds().things.filter((t) => t.status === 'aktiv' && t.ret?.type === 'sted' && t.ret.place === k).length || ''}`)))));
      if (cur) append(body, button('Fjern sted', () => { actions.setPlace(null); closeSheet(); app.render(); }, { kind: 'ghost' }));
    },
  });
}

export function openNewEvent(dayT = startOfDay(now())) {
  openSheet({
    eyebrow: 'Ny avtale',
    title: 'Legg inn en avtale',
    render(body) {
      const d = new Date(dayT);
      const title = h('input', { class: 'input', id: 'ne-title', placeholder: 'For eksempel «Gruppemøte»', autofocus: true });
      const date = h('input', { class: 'input', type: 'date', id: 'ne-date', value: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` });
      const time = h('input', { class: 'input', type: 'time', id: 'ne-time', value: '12:00' });
      const dur = h('input', { class: 'input', type: 'number', id: 'ne-dur', value: '60', min: '5', max: '600', inputmode: 'numeric' });
      const travel = h('input', { class: 'input', type: 'number', id: 'ne-travel', placeholder: 'min', min: '0', max: '240', inputmode: 'numeric' });
      const person = h('input', { class: 'input', id: 'ne-person', placeholder: 'Valgfritt', list: 'ne-people' });
      const dl = h('datalist', { id: 'ne-people' }, ds().people.map((p) => h('option', { value: p.name })));
      append(body, field('Hva', title), h('div', { class: 'grid2' }, field('Dato', date), field('Klokkeslett', time), field('Varighet (min)', dur), field('Reisetid (min)', travel)), field('Med hvem', person), dl);
      append(body, button('Lagre avtalen', () => {
        if (!title.value.trim()) { title.focus(); return; }
        const [y, m, dd] = date.value.split('-').map(Number);
        const [hh, mi] = (time.value || '12:00').split(':').map(Number);
        const start = new Date(y, m - 1, dd, hh, mi).getTime();
        if (!y || !Number.isFinite(start)) { toast('Velg en dato for avtalen.', { timeout: 3000 }); date.focus(); return; }
        const tm = Number(travel.value) || null;
        const r = actions.addItems([{ kind: 'avtale', title: title.value.trim(), start, end: start + (Number(dur.value) || 60) * MIN, travelMin: tm, person: person.value.trim() || null, ret: start - ((tm || 0) + 15) * MIN > now() ? { type: 'tid', at: start - ((tm || 0) + 15) * MIN } : { type: 'ledig' } }]);
        closeSheet();
        undoToast(r.lines[0], r.logId);
      }, { kind: 'primary' }));
    },
  });
}

/** «Ledig 14:00–15:30. Hva passer?» */
export function openGap(gap) {
  const n = nowState();
  const cands = [n.pick, ...n.alternatives].filter(Boolean).filter((u) => u.est <= gap.minutes);
  openSheet({
    eyebrow: `Ledig ${hhmm(gap.start)}–${hhmm(gap.end)} · ${fmtDuration(gap.minutes)}`,
    title: 'Hva passer her?',
    render(body) {
      if (!cands.length) append(body, h('p', { class: 'empty' }, 'Ingenting på lista passer i denne luka. Den kan få være ledig.'));
      append(body, h('div', { class: 'list' }, cands.map((u) => h('div', { class: 'row' },
        h('div', { class: 'row-main' }, h('span', { class: 'row-title' }, u.title), h('span', { class: 'small muted' }, `${u.est} min${u.context ? ` · ${u.context}` : ''}`)),
        button('Legg her', () => { const l = actions.setRet(u.thing.id, { type: 'tid', at: gap.start }); closeSheet(); undoToast(`«${u.title}» kommer kl. ${hhmm(gap.start)}.`, l); }, { kind: 'text', small: true })))));
      append(body, h('p', { class: 'small muted' }, 'Ledig tid er også lov. Ikke alt trenger å fylles.'));
    },
  });
}

// ---------------- Oppstart ----------------

export function openOnboarding() {
  let step = 0;
  const api = openSheet({
    eyebrow: 'Velkommen',
    title: 'Jarvis',
    onClose: () => { if (!store.settings.onboarded) store.updateSettings({ onboarded: true }); },
    render(body) {
      const s = store.settings;
      const dots = h('div', { class: 'dots', 'aria-hidden': 'true' }, [0, 1, 2].map((i) => h('i', { class: i === step ? 'on' : '' })));
      const set = (p) => { store.updateSettings(p, { render: false }); app.applySettings?.(); api.refresh(); };
      if (step === 0) {
        const name = h('input', { class: 'input', id: 'onb-name', value: s.name, placeholder: 'Fornavnet ditt', autocomplete: 'given-name', autofocus: true });
        append(body, h('div', { class: 'onb' }, dots,
          h('h3', { class: 'display' }, 'Si det. Jeg husker det for deg.'),
          h('p', { class: 'muted' }, 'Jarvis er et ytre arbeidsminne. Du fanger tanker, oppgaver og avtaler med én setning. Jarvis sorterer dem og gir hver ting en regel for når den skal komme tilbake: et klokkeslett, et sted, en person eller når du har ledig tid.'),
          field('Hva vil du at jeg skal kalle deg?', name),
          button('Videre', () => { set({ name: name.value.trim() }); step = 1; api.refresh(); }, { kind: 'primary' })));
      } else if (step === 1) {
        append(body, h('div', { class: 'onb' }, dots,
          h('h3', { class: 'display' }, 'Hvordan vil du ha det?'),
          h('p', { class: 'muted' }, 'Du kan endre dette når som helst under Meg.'),
          field('Bevegelse', seg([['full', 'Full'], ['redusert', 'Rolig'], ['av', 'Av']], s.motion, (v) => set({ motion: v }), { label: 'Bevegelse' })),
          field('Glass', seg([['klar', 'Klart'], ['tonet', 'Tonet'], ['solid', 'Solid']], s.glass, (v) => set({ glass: v }), { label: 'Glass' })),
          field('Himmel som følger klokka', seg([['levende', 'Levende'], ['rolig', 'Rolig'], ['av', 'Av']], s.sky, (v) => set({ sky: v }), { label: 'Himmel' })),
          field('Tekst', seg([[1, 'Standard'], [1.12, 'Større'], [1.25, 'Størst']], s.textScale, (v) => set({ textScale: v }), { label: 'Tekststørrelse' })),
          field('Lesefont', seg([['system', 'Systemfont'], ['atkinson', 'Atkinson Hyperlegible']], s.font, (v) => set({ font: v }), { label: 'Lesefont' })),
          h('div', { class: 'actions' }, button('Videre', () => { step = 2; api.refresh(); }, { kind: 'primary' }), button('Tilbake', () => { step = 0; api.refresh(); }, { kind: 'ghost' }))));
      } else {
        append(body, h('div', { class: 'onb' }, dots,
          h('h3', { class: 'display' }, 'Hvor vil du starte?'),
          h('div', { class: 'pick' },
            h('button', { type: 'button', class: 'primary', onClick: () => finish('eksempel') }, h('b', null, 'Se en eksempeldag'), h('span', null, 'En tenkt student med forelesning, gruppemøte og en innlevering. Merket som eksempel, så du ser hvordan det virker.')),
            h('button', { type: 'button', onClick: () => finish('ekte') }, h('b', null, 'Start med mine egne ting'), h('span', null, 'Tomt. Skriv det første du tenker på i feltet nederst.'))),
          h('p', { class: 'small muted' }, 'Jarvis sender aldri noe i ditt navn, og spør aldri om diagnose.'),
          button('Tilbake', () => { step = 1; api.refresh(); }, { kind: 'ghost' })));
      }
    },
  });
  function finish(mode) {
    store.updateSettings({ mode, onboarded: true });
    closeSheet();
    app.render();
    if (mode === 'ekte') setTimeout(() => app.focusInput(), 350);
  }
}

function cap(s) { return s.charAt(0).toLocaleUpperCase('nb') + s.slice(1); }

