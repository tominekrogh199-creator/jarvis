// Agentene: hvem som jobber for deg, hva de har gjort, og det som venter på ditt ja.
import { h, icon, button, append } from '../ui/h.js';
import { app } from '../ui/appref.js';
import { toast } from '../ui/sheet.js';
import { now as nowFn, ago } from '../ui/parts.js';
import { openPlan } from '../ui/plan.js';
import { openThing, openBrief, undoToast } from '../ui/flows.js';
import { topBar } from './na.js';
import { store } from '../store.js';
import { actions } from '../actions.js';
import { agentsRuntime, GMAIL, GCAL } from '../agents.js';
import { AGENTS, AGENT_NAME } from '../../core/agents.js';
import { hhmm } from '../../core/time.js';

const editing = new Set();
const cap = (x) => x.charAt(0).toLocaleUpperCase('nb') + x.slice(1);

function pill(text, kind = '') {
  return h('span', { class: `pill ${kind}` }, text);
}

function statusOf(a, rt, st) {
  if (rt.running[a.id]) return pill(rt.running[a.id], 'busy');
  if (a.server) {
    const s = rt.servers[a.server];
    return pill(rt.stateText(a.server), s === 'klar' ? 'ok' : s === 'sporres' ? '' : 'off');
  }
  if (a.id === 'paminner') return pill(st?.lastRun ? 'På' : 'På i appen', 'ok');
  return pill('På', 'ok');
}

async function run(label, fn) {
  const text = await fn();
  if (text) toast(label, { sub: text, timeout: 9000 });
  app.render();
}

function agentCard(a, rt, ds) {
  const st = ds.agents?.[a.id] || {};
  const jobLast = { planlegger: ds.jobs?.frist, rydding: ds.jobs?.rydding }[a.id];
  const last = st.lastText ? { at: st.lastRun, text: st.lastText } : jobLast?.lastText ? { at: jobLast.lastRun, text: jobLast.lastText } : null;
  const acts = h('div', { class: 'actions' });
  if (a.id === 'post') {
    if (rt.usable(GMAIL)) append(acts, button('Sjekk mailen nå', () => run('Postagenten', () => rt.runPost()), { kind: 'soft', small: true, icon: 'mail', disabled: !!rt.running.post }));
    else append(acts, button('Koble til Gmail', () => run('Gmail', () => rt.connect(GMAIL)), { kind: 'soft', small: true, icon: 'link' }));
  }
  if (a.id === 'kalender') {
    if (rt.usable(GCAL)) append(acts, button('Hent kalenderen', () => run('Kalenderagenten', () => rt.importCalendar()), { kind: 'soft', small: true, icon: 'calendar', disabled: !!rt.running.kalender }));
    else append(acts, button('Koble til Google Kalender', () => run('Google Kalender', () => rt.connect(GCAL)), { kind: 'soft', small: true, icon: 'link' }));
  }
  if (a.id === 'planlegger') append(acts, button('Gå gjennom fristene', () => run('Planleggeren', () => rt.runCommand({ agent: 'planlegger', task: 'uke' })), { kind: 'soft', small: true, icon: 'plan' }));
  if (a.id === 'paminner') append(acts, button('Morgenbriefen', () => openBrief(), { kind: 'soft', small: true, icon: 'sun' }));
  if (a.server && rt.servers[a.server] === 'nei') append(acts, button('Tillatelser', () => rt.manage(), { kind: 'text', small: true, icon: 'shield' }));
  return h('article', { class: 'card agent', 'aria-label': a.name },
    h('div', { class: 'agent-head' },
      h('span', { class: 'agent-icon', 'aria-hidden': 'true' }, icon(a.icon, { size: 20 })),
      h('div', { class: 'agent-name' }, h('h3', { class: 'h3' }, a.name), statusOf(a, rt, st))),
    h('p', null, a.role),
    h('dl', { class: 'agent-facts' },
      h('dt', null, 'Verktøy'), h('dd', null, a.tools.join(' · ')),
      h('dt', null, 'Lov til'), h('dd', null, a.rights),
      h('dt', null, 'Når'), h('dd', null, a.id === 'paminner' ? `${a.routine} Morgen ${store.settings.briefTime}, kveld ${store.settings.eveningTime}.` : a.routine)),
    last ? h('p', { class: 'agent-last' }, h('b', null, `${cap(ago(last.at))}: `), last.text) : null,
    st.lastError ? h('p', { class: 'small', style: { color: 'var(--clay)' } }, st.lastError) : null,
    acts.childNodes.length ? acts : null);
}

function proposalCard(it, rt) {
  const p = it.payload || {};
  const isMail = it.kind === 'epost';
  const edit = editing.has(it.id);
  const body = h('textarea', { class: 'input', rows: '7', id: `ed-${it.id}`, 'aria-label': 'Teksten i e-posten' });
  body.value = p.body || '';
  body.addEventListener('change', () => actions.editProposal(it.id, { body: body.value }));
  const approve = async (how) => {
    const r = await rt.approve(it.id, how);
    if (!r) return;
    toast(r.failed ? 'Det gikk ikke' : 'Gjort', { sub: r.text, timeout: 8000, actions: r.thingId ? [{ label: r.plan ? 'Se planen' : 'Åpne', onClick: () => (r.plan ? openPlan(r.thingId, { fresh: true }) : openThing(r.thingId)) }] : [] });
    app.render();
  };
  const busy = rt.inflight.has(it.id);
  const failed = it.status === 'feilet';
  return h('article', { class: `card proposal${failed ? ' failed' : ''}`, 'aria-busy': busy ? 'true' : null },
    h('p', { class: 'eyebrow' }, `${AGENT_NAME[it.agent] || 'Jarvis'} · ${ago(it.at)}`),
    h('h3', { class: 'h3' }, it.title),
    it.detail ? h('p', { class: 'small muted' }, it.detail) : null,
    failed ? h('p', { class: 'warn' }, it.note || 'Det gikk ikke.') : null,
    isMail ? h('div', { class: 'mail-preview' },
      h('p', { class: 'small' }, h('b', null, 'Til: '), p.to),
      p.subject ? h('p', { class: 'small' }, h('b', null, 'Emne: '), p.subject) : null,
      edit ? body : h('p', { class: 'draft-text' }, p.body)) : null,
    isMail && /\[[^\]]+\]/.test(p.body || '') ? h('p', { class: 'warn' }, 'Fyll inn det som står i [klammer] før du sender.') : null,
    h('div', { class: 'actions' },
      isMail
        ? [
          button(busy ? 'Sender …' : failed ? 'Prøv å sende igjen' : 'Send med Gmail', () => { if (busy) return; if (/\[[^\]]+\]/.test((store.ds().inbox.find((x) => x.id === it.id)?.payload?.body) || '')) { editing.add(it.id); app.render(); toast('Fyll inn det i [klammer] først.', { timeout: 3500 }); return; } approve('send'); }, { kind: 'primary', small: true, icon: 'send', disabled: busy }),
          button('Lagre som utkast i Gmail', () => approve('utkast'), { kind: 'soft', small: true, disabled: busy }),
          button(edit ? 'Ferdig' : 'Endre', () => { if (edit) { actions.editProposal(it.id, { body: body.value }); editing.delete(it.id); } else editing.add(it.id); app.render(); }, { kind: 'text', small: true, icon: 'edit' }),
        ]
        : button(busy ? 'Jobber …' : failed ? 'Prøv igjen' : it.kind === 'kalender' ? 'Legg inn' : 'Legg til', () => approve('ja'), { kind: 'primary', small: true, icon: 'check', disabled: busy }),
      button(failed ? 'Fjern' : 'Nei takk', () => { const l = rt.reject(it.id); undoToast('Greit, avvist.', l); app.render(); }, { kind: 'text', small: true })));
}

export function render() {
  const ds = store.ds();
  const t = nowFn();
  const rt = agentsRuntime();
  const waiting = (ds.inbox || []).filter((x) => x.status === 'venter' || x.status === 'feilet');
  const handled = (ds.inbox || []).filter((x) => !['venter', 'feilet'].includes(x.status)).slice(0, 5);
  const ids = new Set([...AGENTS.map((a) => a.id), 'frist', 'rydding', 'morgen', 'oppfolging']);
  const log = (ds.log || []).filter((e) => ids.has(e.by)).slice(0, 8);
  const busy = Object.values(rt.running);
  return h('div', { class: 'screen' },
    topBar(t, { title: 'Agenter' }),
    h('section', { class: 'hello' },
      h('h1', { class: 'display' }, 'Agentene'),
      h('p', { class: 'status' }, h('b', null, busy.length ? busy[0] : waiting.length ? `${waiting.length} venter på ja fra deg` : 'Jobber i bakgrunnen'), h('span', null, 'Jarvis delegerer. Ingenting går ut av appen uten ditt ja.'))),
    store.demo ? h('p', { class: 'note' }, 'Du ser eksempeldagen. Agentene jobber med dine egne ting når du bytter under Meg.') : null,
    h('section', { class: 'section', 'aria-label': 'Venter på ja fra deg' },
      h('div', { class: 'section-head' }, h('h2', { class: 'h3' }, 'Venter på ja fra deg'), waiting.length ? h('span', { class: 'tag' }, String(waiting.length)) : null),
      waiting.length ? h('div', { class: 'stack' }, waiting.map((it) => proposalCard(it, rt))) : h('p', { class: 'small muted', style: { paddingInline: '4px' } }, 'Ingenting venter. Når en agent vil gjøre noe utenfor appen, havner det her først.')),
    h('section', { class: 'section', 'aria-label': 'Be en agent' },
      h('div', { class: 'section-head' }, h('h2', { class: 'h3' }, 'Be en agent')),
      h('div', { class: 'actions' }, ['Sjekk mailen', 'Hent kalenderen', 'Legg øktene i kalenderen', 'Planlegg fristene'].map((x) => h('button', { type: 'button', class: 'chip', onClick: () => app.fill(x) }, x))),
      h('p', { class: 'small muted', style: { paddingInline: '4px' } }, 'Du kan også bare skrive det i feltet nederst.')),
    h('section', { class: 'section', 'aria-label': 'Teamet' },
      h('div', { class: 'section-head' }, h('h2', { class: 'h3' }, 'Teamet')),
      h('div', { class: 'stack' }, AGENTS.map((a) => agentCard(a, rt, ds)))),
    !rt.mcp ? h('p', { class: 'note' }, 'Gmail og Google Kalender virker når appen er åpnet på claude.ai, og du har koblet dem til under Innstillinger → Koblinger der.') : null,
    h('details', { class: 'card flat how' },
      h('summary', null, h('b', null, 'Slik jobber agentene')),
      h('ol', null,
        h('li', null, h('b', null, 'En hjerne med verktøy. '), 'Claude får en jobb og en verktøykasse (søk i Gmail, les en tråd, foreslå en frist). Den bestemmer selv hva den leser, i flere runder, til jobben er gjort.'),
        h('li', null, h('b', null, 'Koblinger med dine innlogginger. '), 'Gmail og Google Kalender kobles til på claude.ai. Appen ser aldri passordet ditt.'),
        h('li', null, h('b', null, 'Rutiner. '), 'Mens appen er åpen, sjekker agentene kalenderen og fristene selv. Morgen og kveld kjører en planlagt oppgave i skyen, også når telefonen er låst, og sender deg en melding.'),
        h('li', null, h('b', null, 'Minne. '), 'Alt du har fanget, planen og loggen ligger privat på kontoen din, så agentene vet hva som står på.'),
        h('li', null, h('b', null, 'Godkjenning. '), 'Agentene leser og foreslår. Det som går ut av appen (e-post, avtaler i kalenderen) skjer først når du trykker.'))),
    handled.length ? h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', { class: 'h3' }, 'Nylig avgjort')),
      h('div', { class: 'list' }, handled.map((it) => h('div', { class: 'row' },
        h('span', { style: { color: it.status === 'godkjent' ? 'var(--sage)' : 'var(--ink-3)', paddingTop: '2px' } }, icon(it.status === 'godkjent' ? 'check' : it.status === 'feilet' ? 'flag' : 'close', { size: 18 })),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, it.title), h('span', { class: 'small muted' }, `${{ godkjent: 'Ja', avvist: 'Nei', feilet: 'Feilet' }[it.status] || it.status} ${ago(it.doneAt)}${it.note ? ` · ${it.note}` : ''}`)))))) : null,
    log.length ? h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', { class: 'h3' }, 'Siste fra teamet')),
      h('div', { class: 'list' }, log.map((e) => h('div', { class: 'row' },
        h('span', { class: 'mono small', style: { width: '44px', paddingTop: '2px', color: 'var(--ink-3)' } }, hhmm(e.at)),
        h('span', { class: 'row-main' }, h('span', { class: 'small muted' }, AGENT_NAME[e.by] || { frist: 'Planleggeren', morgen: 'Påminneren', oppfolging: 'Påminneren', rydding: 'Rydderen' }[e.by] || 'Jarvis'), h('span', null, e.text)))))) : null);
}
