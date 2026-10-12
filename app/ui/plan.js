// Planleggeren i appen: planen som tidslinje, «Har du to minutter?», kjappe spørsmål og skreddersydde steg.
// Koden bestemmer når øktene ligger. Claude kan foreslå steg, aldri tidspunkter.
import { h, icon, button, append } from './h.js';
import { openSheet, closeSheet, toast } from './sheet.js';
import { app } from './appref.js';
import { now } from './parts.js';
import { store } from '../store.js';
import { actions } from '../actions.js';
import { brain } from '../brain.js';
import { agentsRuntime } from '../agents.js';
import { DAY, startOfDay, addDays, hhmm, fmtDate, fmtDuration } from '../../core/time.js';
import { planLines, questionsFor, dayWord } from '../../core/planwork.js';

const find = (id) => store.ds().things.find((t) => t.id === id);
const low1 = (s) => s.charAt(0).toLocaleLowerCase('nb') + s.slice(1);

/** Planen som en rolig tidslinje: kikk, arbeidsdager, når du kan la den være, og levering. */
export function planView(th, steps = th.steps, plan = th.plan) {
  const t = now();
  const L = planLines(steps, { now: t, buffer: plan?.buffer || [], due: th.due });
  const rows = [];
  if (L.kick) {
    const k = steps.find((s) => s.kick && !s.done);
    rows.push(h('div', { class: 'plan-row kick' }, icon('eye', { size: 18 }), h('div', null, h('b', null, `${cap(dayWord(k.at, t))} ${hhmm(k.at)}`), h('span', null, k.title))));
  }
  for (const d of L.doLines) {
    rows.push(h('div', { class: 'plan-row work' }, icon('timer', { size: 18 }),
      h('div', null, h('p', { class: 'plan-day' }, h('b', null, d.label), h('small', null, `${d.items.length} ${d.items.length === 1 ? 'økt' : 'økter'} · ${fmtDuration(d.minutes)}`)),
        h('ul', null, d.items.map((s) => h('li', null, h('span', { class: 'mono' }, `${hhmm(s.at)}–${hhmm(s.end)}`), ` ${s.title}`))))));
  }
  const loose = steps.filter((s) => !s.done && !s.at && !s.deliver);
  if (loose.length) rows.push(h('div', { class: 'plan-row warn-row' }, icon('flag', { size: 18 }), h('div', null, h('b', null, 'Fikk ikke plass'), h('span', null, loose.map((s) => s.title).join(', ')))));
  for (const n of L.notLines) rows.push(h('div', { class: 'plan-row rest' }, icon('moon', { size: 18 }), h('span', null, n)));
  if (L.deliver) rows.push(h('div', { class: 'plan-row deliver' }, icon('flag', { size: 18 }), h('b', null, L.deliver)));
  const done = steps.filter((s) => s.done && !s.deliver).length;
  return h('div', { class: 'plan', role: 'list', 'aria-label': `Planen for ${th.title}` },
    done ? h('p', { class: 'small muted' }, `${done} ${done === 1 ? 'økt' : 'økter'} gjort.`) : null,
    rows);
}

function warnBlock(th, plan) {
  if (!plan?.warnings?.length) return null;
  const tight = !plan.fits;
  return h('div', { class: 'card flat', style: { gap: '8px', borderColor: 'var(--clay)' } },
    h('p', { class: 'warn' }, plan.warnings[0]),
    tight ? h('div', { class: 'actions' },
      button('Gjør den mindre', () => { closeSheet(); openPlan(th.id, { start: 'q', preset: { size: 'liten' } }); }, { kind: 'soft', small: true, icon: 'smaller' }),
      plan.weekend || !hasWeekend(th) ? null : button('Bruk helga også', () => { const r = actions.applyPlan(th.id, { answers: th.plan?.answers || {}, weekend: true }); toast(r?.plan?.fits ? 'Helga er med. Nå går det.' : 'Helga er med, men det er fortsatt trangt.', { timeout: 4000 }); }, { kind: 'soft', small: true }),
      button('Skriv e-post om utsettelse', () => { closeSheet(); app.fill(`Skriv e-post til foreleser om utsettelse på ${low1(th.title)}`); }, { kind: 'text', small: true, icon: 'mail' })) : null);
}

/**
 * Arket for planen. fresh = rett etter fangst (spør om du har tid).
 * start: 'view' | 'q' | 'claude'. preset: svar som er gitt fra før.
 */
export function openPlan(id, { fresh = false, start = 'view', preset = {} } = {}) {
  const th0 = find(id);
  if (!th0?.due) return null;
  const st = { stage: start, qi: 0, answers: { ...(th0.plan?.answers || {}), ...preset }, preview: null, custom: null, text: '', busy: false, error: null, prefer: store.settings.workPrefer || null };
  const qs = () => questionsFor(find(id) || th0, { prefer: store.settings.workPrefer || null });
  const doPreview = () => {
    st.preview = actions.previewPlan(id, { answers: st.answers, prefer: st.prefer, custom: st.custom });
    st.stage = 'preview';
  };
  const api = openSheet({
    eyebrow: fresh ? 'Sortert og planlagt' : 'Planleggeren',
    title: th0.title,
    render(body) {
      const th = find(id);
      if (!th) { append(body, h('p', { class: 'empty' }, 'Denne er slettet.')); return; }
      append(body, h('div', { class: 'actions' },
        h('span', { class: 'tag', style: { color: 'var(--clay)' } }, icon('flag', { size: 14 }), `frist ${dayWord(th.due - 1, now())}${th.dueHasTime ? ` kl. ${hhmm(th.due)}` : ''}`),
        th.plan?.prefer ? h('span', { class: 'tag' }, `jobber best ${{ morgen: 'om morgenen', ettermiddag: 'på ettermiddagen', kveld: 'om kvelden' }[th.plan.prefer]}`) : null));

      if (st.stage === 'view') {
        if (fresh) append(body, h('p', null, 'Jeg har lagt øktene i ledig tid, bakover fra fristen. Du får beskjed når det er tid.'));
        append(body, planView(th), warnBlock(th, th.plan));
        if (fresh && !th.plan?.asked) {
          append(body, h('div', { class: 'card ask', style: { gap: '10px' } },
            h('p', { class: 'h3' }, 'Har du to minutter til å finpusse den?'),
            h('p', { class: 'small muted' }, 'Fire kjappe spørsmål, så passer planen bedre til deg. Ellers står den som den er.'),
            h('div', { class: 'actions' },
              button('Ja, spør meg', () => { actions.planSeen(id, 'ja'); st.stage = 'q'; st.qi = 0; api.refresh(); }, { kind: 'primary', icon: 'sparkle', id: 'plan-yes' }),
              button('Nei, dette er bra', () => { actions.planSeen(id, 'ok'); closeSheet(); toast(find(id)?.plan ? (planLines(find(id).steps, { now: now(), buffer: find(id).plan.buffer, due: find(id).due }).notLines[0] || 'Greit. Jeg sier fra når det er tid.') : 'Greit.', { timeout: 5000 }); }, { kind: 'soft' }),
              button('Senere', () => { actions.planSeen(id, 'senere'); closeSheet(); toast('Greit. Du finner «Finpuss planen» når du åpner den.', { timeout: 4000 }); }, { kind: 'text' }))));
        } else {
          append(body, h('div', { class: 'actions' },
            button('Finpuss med spørsmål', () => { st.stage = 'q'; st.qi = 0; api.refresh(); }, { kind: 'soft', icon: 'sparkle' }),
            button('Skreddersy stegene', () => { st.stage = 'claude'; api.refresh(); }, { kind: 'soft', icon: 'wand' }),
            calendarButton(th)));
        }
        return;
      }

      if (st.stage === 'q') {
        const list = qs();
        const q = list[st.qi];
        if (!q) { doPreview(); api.refresh(); return; }
        const cur = q.id === 'prefer' ? st.prefer : st.answers[q.id];
        append(body,
          h('p', { class: 'label' }, `Spørsmål ${st.qi + 1} av ${list.length}`),
          h('div', { class: 'progress' }, h('i', { style: { width: `${((st.qi) / list.length) * 100}%` } })),
          h('h3', { class: 'h2', style: { marginTop: '6px' } }, q.q),
          h('div', { class: 'optlist' }, q.options.map(([v, label]) => h('button', {
            type: 'button', class: 'opt', 'aria-pressed': String(cur === v),
            onClick: () => {
              if (q.id === 'prefer') { st.prefer = v; store.updateSettings({ workPrefer: v }, { render: false }); } else st.answers[q.id] = v;
              st.qi++;
              if (st.qi >= list.length) doPreview();
              api.refresh();
            },
          }, label))),
          h('div', { class: 'actions' },
            st.qi > 0 ? button('Tilbake', () => { st.qi--; api.refresh(); }, { kind: 'text', icon: 'back' }) : null,
            button('Hopp over', () => { st.qi++; if (st.qi >= list.length) doPreview(); api.refresh(); }, { kind: 'text' })),
          q.id === 'prefer' ? h('p', { class: 'small muted' }, 'Jeg husker dette til neste gang, og du kan endre det under Meg.') : null);
        return;
      }

      if (st.stage === 'claude') {
        const area = h('textarea', { class: 'input', id: 'plan-text', rows: '6', placeholder: 'Lim inn oppgaveteksten eller kravene (valgfritt)' });
        area.value = st.text;
        area.addEventListener('input', () => { st.text = area.value; });
        append(body,
          h('p', null, 'Claude foreslår steg som passer akkurat denne oppgaven. Jarvis bestemmer fortsatt når de gjøres, og du ser planen før noe endres.'),
          h('div', { class: 'field' }, h('label', { for: 'plan-text' }, 'Oppgaveteksten'), area),
          st.error ? h('p', { class: 'warn' }, st.error) : null,
          h('div', { class: 'actions' },
            button(st.busy ? 'Lager steg …' : 'Lag steg med Claude', async () => {
              if (st.busy) return;
              st.busy = true; st.error = null; api.refresh();
              try {
                st.custom = await brain.tailorSteps(find(id), st.text, st.answers);
                doPreview();
              } catch (e) {
                st.error = e?.code === 'no_claude' ? 'Claude er ikke tilgjengelig her. Bruk spørsmålene i stedet.' : brain.noteError(e).replace('så appen sorterte selv', 'så planen er uendret');
              }
              st.busy = false;
              api.refresh();
            }, { kind: 'primary', icon: 'wand', disabled: st.busy }),
            button('Tilbake', () => { st.stage = 'view'; api.refresh(); }, { kind: 'text' })));
        return;
      }

      if (st.stage === 'preview') {
        const p = st.preview;
        if (!p) { st.stage = 'view'; api.refresh(); return; }
        const before = th.steps.filter((s) => !s.done && !s.deliver && !s.kick && s.at).length;
        const after = p.steps.filter((s) => !s.done && !s.deliver && !s.kick && s.at).length;
        append(body,
          h('p', { class: 'label' }, 'Ny plan'),
          h('p', null, p.summary),
          h('p', { class: 'small muted' }, `Før: ${before} ${before === 1 ? 'økt' : 'økter'}. Nå: ${after} ${after === 1 ? 'økt' : 'økter'}, rundt ${fmtDuration(p.totalMin)} arbeid.${st.custom ? ' Stegene er skreddersydd av Claude.' : ''}`),
          planView(th, p.steps, { buffer: p.buffer }),
          p.warnings.length ? h('p', { class: 'warn' }, p.warnings[0]) : null,
          h('div', { class: 'actions' },
            button('Bruk planen', () => {
              const r = actions.applyPlan(id, { answers: st.answers, prefer: st.prefer, custom: st.custom });
              closeSheet();
              const L = planLines(find(id).steps, { now: now(), buffer: r.plan.buffer, due: th.due });
              toast(`Ny plan for «${th.title}».`, { sub: L.notLines[0] || r.plan.summary, actions: [{ label: 'Angre', onClick: () => { actions.undo(r.logId); toast('Angret. Den gamle planen står.', { timeout: 2500 }); } }] });
            }, { kind: 'primary', icon: 'check', id: 'plan-use' }),
            button('Endre svarene', () => { st.stage = 'q'; st.qi = 0; api.refresh(); }, { kind: 'text' }),
            button('Avbryt', () => { st.stage = 'view'; st.preview = null; api.refresh(); }, { kind: 'text' })));
      }
    },
  });
  return api;
}

/** «Legg øktene i Google Kalender»: går via Kalenderagenten, alltid med ditt ja. */
function calendarButton(th) {
  const rt = agentsRuntime();
  if (!rt.calendarWritable()) return null;
  const todo = th.steps.filter((s) => s.at && !s.done && (!s.gcal || s.gcalStale) && s.at > now());
  const n = todo.length;
  if (!n) return th.steps.some((s) => s.gcal) ? h('span', { class: 'tag' }, icon('calendar', { size: 14 }), 'i Google Kalender') : null;
  const stale = todo.some((s) => s.gcalStale);
  const busy = !!rt.running.kalender;
  return button(busy ? rt.running.kalender : `${stale ? 'Oppdater' : 'Legg'} ${n} ${n === 1 ? 'økt' : 'økter'} i Google Kalender`, async (e) => {
    e.currentTarget.disabled = true;
    await rt.proposeSessionsToCalendar(th.id);
  }, { kind: 'soft', icon: 'calendar', disabled: busy });
}

/** Har en stor oppgave ingen frist? Spør, og planlegg den. */
export function openAskDue(id) {
  const th = find(id);
  if (!th) return null;
  const t = now();
  const fri = (() => { let d = startOfDay(t); while (new Date(d).getDay() !== 5 || d <= startOfDay(t)) d = addDays(d, 1); return d; })();
  const opts = [
    ['I morgen', addDays(startOfDay(t), 2)],
    [`Fredag ${new Date(fri).getDate()}.`, addDays(fri, 1)],
    ['Om en uke', addDays(startOfDay(t), 8)],
    ['Om to uker', addDays(startOfDay(t), 15)],
  ];
  return openSheet({
    eyebrow: 'Den ser stor ut',
    title: 'Har den en frist?',
    render(body) {
      const date = h('input', { class: 'input', type: 'date', id: 'due-date' });
      append(body,
        h('p', { class: 'muted' }, `«${th.title}». Med en frist kan jeg legge økter i ledig tid, bakover fra fristen.`),
        h('div', { class: 'optlist' }, opts.map(([label, due]) => h('button', { type: 'button', class: 'opt', onClick: () => go(due) }, label, h('small', null, fmtDate(due - 1))))),
        h('div', { class: 'field' }, h('label', { for: 'due-date' }, 'Eller velg dato'), date),
        h('div', { class: 'actions' },
          button('Bruk datoen', () => { const [y, m, d] = (date.value || '').split('-').map(Number); if (y) go(new Date(y, m - 1, d + 1).getTime()); }, { kind: 'soft' }),
          button('Ingen frist', () => { closeSheet(); toast('Greit. Den kommer når du har ledig tid.', { timeout: 3500 }); }, { kind: 'text' })));
    },
  });
  function go(due) {
    if (due <= now()) { toast('Den datoen har vært.', { timeout: 3000 }); return; }
    const r = actions.setDue(id, due);
    closeSheet();
    if (r?.plan) openPlan(id, { fresh: true });
  }
}

/** Kort plan-linje til Nå og briefen: «Kan vente: Arbeidskrav, neste økt onsdag 12:00». */
export function waitingRow(x) {
  return h('button', { type: 'button', class: 'row', onClick: () => openPlan(x.thing.id) },
    h('span', { style: { color: 'var(--ink-3)', paddingTop: '2px' } }, icon('moon', { size: 18 })),
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, x.thing.title), h('span', { class: 'small muted' }, `${x.next.deliver ? x.next.title : 'Neste økt'} ${dayWord(x.next.at, now())} ${hhmm(x.next.at)}. Til da kan den vente.`)),
    icon('chevron', { size: 18 }));
}

function cap(s) { return s.charAt(0).toLocaleUpperCase('nb') + s.slice(1); }

/** Er det en helg mellom nå og fristen? */
function hasWeekend(th) {
  for (let d = startOfDay(now()); d < th.due; d = addDays(d, 1)) if ([0, 6].includes(new Date(d).getDay())) return true;
  return false;
}


