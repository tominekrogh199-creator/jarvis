// Eksempeldagen: en tenkt BI-student med en vanlig onsdag. Alt er merket som eksempel i appen.
// Tidene regnes ut fra nå, så eksempelet alltid viser noe som skjer.
import { MIN, HOUR, DAY, startOfDay, addDays, atTime, roundUpTo } from '../core/time.js';
import { planWork } from '../core/planwork.js';
import { DRAFTS } from '../core/sort.js';

let n = 0;
const id = (p) => `${p}-demo-${(n++).toString(36)}`;

export function seedDemo(now) {
  n = 0;
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const r15 = (t) => roundUpTo(t, 15);
  const endOfDay = atTime(today, '23:00');
  const calendar = [];
  const ev = (title, start, minutes, extra = {}) => {
    const e = { id: id('ev'), title, start, end: start + minutes * MIN, source: 'eksempel', ...extra };
    if (e.end <= endOfDay || start >= tomorrow) calendar.push(e);
    return e;
  };
  // Om kvelden og natta legges gruppemøtet i morgen, så eksempelet ikke får avtaler etter midnatt.
  const late = now > atTime(today, '19:00');
  const early = now < atTime(today, '07:00');
  const anchor = early ? atTime(today, '09:00') : now;
  const lecture = r15(Math.min(Math.max(anchor, atTime(today, '11:15')), atTime(today, '19:00')) - 3 * HOUR);
  if (!early) ev('Forelesning: Markedsføring', lecture, 105, { place: 'BI' });
  const group = late
    ? ev('Gruppemøte entreprenørskap', atTime(tomorrow, '14:15'), 75, { person: 'Emma', travelMin: 20, place: 'BI' })
    : ev('Gruppemøte entreprenørskap', r15(Math.max(anchor + 110 * MIN, lecture + 135 * MIN)), 75, { person: 'Emma', travelMin: 20, place: 'BI' });
  if (!late) ev('Trening', group.end + 2 * HOUR, 75, { travelMin: 15 });
  ev('Forelesning: Bedriftsøkonomi', atTime(tomorrow, '08:15'), 105, { travelMin: 25, place: 'BI' });
  ev('Lunsj med Sara', atTime(tomorrow, '12:00'), 45, { person: 'Sara' });

  const thing = (o) => ({ id: id('t'), status: 'aktiv', createdAt: now - 2 * HOUR, snoozes: 0, ...o });
  // To frister planlagt av Planleggeren: én langt fram (kan vente) og én om tre dager (økter fra i dag).
  const due = addDays(today, 11);
  const plan = planWork({ title: 'Innlevering i markedsføring', due, now: now - DAY, events: calendar });
  const kick = plan.steps.find((x) => x.kick);
  if (kick) { kick.done = true; kick.doneAt = now - 20 * HOUR; }
  const due2 = addDays(today, 3);
  const plan2 = planWork({ title: 'Arbeidskrav i statistikk', due: due2, now, events: [...calendar], answers: { done: 'litt', size: 'liten' } });
  const things = [
    thing({ kind: 'frist', title: 'Innlevering i markedsføring', due, steps: plan.steps, template: plan.template, plan: { at: now - DAY, answers: {}, buffer: plan.buffer, fits: plan.fits, summary: plan.summary, warnings: plan.warnings, asked: 'ok' }, why: plan.summary, ret: { type: 'ledig' }, important: true, createdAt: now - 3 * DAY }),
    thing({ kind: 'frist', title: 'Arbeidskrav i statistikk', due: due2, steps: plan2.steps, template: plan2.template, plan: { at: now - HOUR, answers: { done: 'litt', size: 'liten' }, buffer: plan2.buffer, fits: plan2.fits, summary: plan2.summary, warnings: plan2.warnings, asked: 'ja' }, why: plan2.summary, ret: { type: 'ledig' }, important: true, createdAt: now - HOUR }),
    thing({ kind: 'oppgave', title: 'Les kapittel 4 i Bedriftsøkonomi', estimateMin: 45, workType: 'lesing', due: addDays(tomorrow, 1), ret: { type: 'ledig' } }),
    thing({ kind: 'melding', title: 'Melding til Emma', person: 'Emma', ret: { type: 'ledig' }, draft: { channel: 'sms', to: 'Emma', phone: '', body: DRAFTS.tell('Emma', 'jeg kommer ti minutter for sent til gruppemøtet'), status: 'utkast' } }),
    thing({ kind: 'epost', title: 'E-post til foreleser: Utsettelse på arbeidskravet', person: 'foreleser', ret: { type: 'ledig' }, draft: { channel: 'epost', to: 'foreleser', address: '', subject: 'Utsettelse på arbeidskravet', body: DRAFTS.email('foreleser', 'Utsettelse på arbeidskravet', ''), status: 'utkast' } }),
    thing({ kind: 'oppgave', title: 'Spør Emma om notatene fra forelesningen', person: 'Emma', estimateMin: 5, workType: 'samtale', ret: { type: 'person', person: 'Emma' } }),
    thing({ kind: 'oppgave', title: 'Betal husleia', estimateMin: 5, ret: { type: 'tid', at: now - 12 * MIN } }),
    thing({ kind: 'handle', title: 'Havregryn og bananer', place: 'butikken', ret: { type: 'sted', place: 'butikken' } }),
    thing({ kind: 'handle', title: 'Hent pakke', place: 'posten', ret: { type: 'sted', place: 'posten' } }),
    thing({ kind: 'handle', title: 'Lever boka på biblioteket', place: 'bi', ret: { type: 'sted', place: 'bi' } }),
    thing({ kind: 'notat', title: 'Sara har laderen min', person: 'Sara', ret: { type: 'person', person: 'Sara' } }),
    thing({ kind: 'ide', title: 'Pitchen kan starte med en kort historie', ret: { type: 'uke' }, createdAt: now - 2 * DAY }),
    thing({ kind: 'ide', title: 'En app som viser tiden på låseskjermen', ret: { type: 'uke' }, createdAt: now - 4 * DAY }),
    thing({ kind: 'notat', title: 'Sjekke om BI har skrivekurs', ret: { type: 'morgen' }, createdAt: now - DAY }),
    thing({ kind: 'oppgave', title: 'Bestill buss til hytta', estimateMin: 10, ret: { type: 'ledig' }, createdAt: now - 5 * DAY }),
    thing({ kind: 'oppgave', title: 'Lever refleksjonsnotat', status: 'ferdig', doneAt: now - 22 * HOUR, ret: { type: 'ledig' } }),
    thing({ kind: 'oppgave', title: 'Ring tannlegen', status: 'ferdig', doneAt: now - 2 * HOUR, ret: { type: 'ledig' } }),
    thing({ kind: 'melding', title: 'Svar Maja om fordelingen i gruppa', status: 'ferdig', doneAt: now - 2 * DAY, ret: { type: 'ledig' } }),
  ];
  const sessions = [
    { id: id('s'), title: 'Disposisjon', start: now - 20 * HOUR, plannedMin: 25, actualMin: 28 },
    { id: id('s'), title: 'Refleksjonsnotat', start: now - 23 * HOUR, plannedMin: 25, actualMin: 25 },
    { id: id('s'), title: 'Les kapittel 3', start: now - 2 * DAY, plannedMin: 25, actualMin: 20 },
  ];
  const log = [
    { id: id('l'), at: Math.min(now, atTime(today, '07:30')), by: 'morgen', text: 'Morgenbriefen er klar.', undo: [] },
    { id: id('l'), at: now - DAY, by: 'planlegger', text: `Planla «Innlevering i markedsføring»: ${plan.summary}`, undo: [] },
    { id: id('l'), at: now - HOUR, by: 'planlegger', text: `Ny plan for «Arbeidskrav i statistikk»: ${plan2.summary}`, undo: [] },
    { id: id('l'), at: Math.min(now, atTime(today, '07:25')), by: 'post', text: 'Sjekket Gmail: 1 forslag i køen.', undo: [] },
    { id: id('l'), at: now - 2 * HOUR, by: 'du', text: 'Fanget «Spør Emma om notatene fra forelesningen». Kommer tilbake når du har kontakt med Emma.', undo: [] },
  ].sort((a, b) => b.at - a.at);
  const ran = { lastRun: now };
  return {
    createdAt: now,
    things,
    calendar,
    people: ['Emma', 'Sara', 'Jonas', 'Maja', 'Mamma'].map((name) => ({ name, phone: '', email: '' })),
    sessions,
    log,
    jobs: { morgen: ran, frist: ran, oppfolging: ran, rydding: ran },
    chat: [],
    comebacks: [{ at: now - 3 * DAY }],
    place: null,
    energy: null,
    nudges: { day: 0, count: 0, seen: [] },
    seen: {},
    skip: { day: 0, ids: [] },
    lastActiveAt: now,
    inbox: [
      { id: id('f'), at: Math.min(now, atTime(today, '07:25')), status: 'venter', agent: 'post', kind: 'ting', key: 'demo-ting', title: 'Ny frist: Arbeidskrav 2 i bedriftsøkonomi', detail: `Foreleseren skriver at arbeidskrav 2 skal leveres om drøyt to uker. · Fra foreleser (eksempel)`, payload: { kind: 'frist', title: 'Arbeidskrav 2 i bedriftsøkonomi', at: addDays(today, 16), hasTime: false, why: 'Foreleseren skriver at arbeidskrav 2 skal leveres om drøyt to uker.', from: 'Foreleser (eksempel)' } },
    ],
    agents: { post: { lastRun: Math.min(now, atTime(today, '07:25')), lastText: 'Ett nytt arbeidskrav fra foreleseren. Resten var nyhetsbrev. (Eksempel)' } },
  };
}
