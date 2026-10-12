import test from 'node:test';
import assert from 'node:assert/strict';
import { sortCapture, retLabel, parseRetText, findThing, splitClauses } from '../sort.js';
import { planSteps, replanSteps, spread } from '../steps.js';
import { pickNow, resurface, timeStatus } from '../now.js';
import { morningBrief, comebackPlan, weekReview, needsComeback } from '../brief.js';
import { runJobs } from '../jobs.js';
import { googleCalendarLink, icsFor } from '../remind.js';
import { startOfDay, addDays, atTime, DAY, MIN, HOUR } from '../time.js';
import { sampleWeather } from '../weather.js';

const NOW = new Date(2026, 9, 7, 13, 20).getTime(); // onsdag 7. oktober 13:20
const ctx = { now: NOW, people: ['Emma', 'Sara', 'Jonas'], userName: 'Tomine' };
const one = (text) => sortCapture(text, ctx).items[0];

test('spørsmål blir svar, ikke oppgaver', () => {
  for (const q of ['hva har jeg i dag?', 'hvordan blir været i morgen?', 'hva skal jeg gjøre nå?', 'når må jeg gå?']) {
    const r = sortCapture(q, ctx);
    assert.equal(r.items.length, 0, q);
    assert.equal(r.questions.length, 1, q);
  }
  assert.equal(sortCapture('hva har jeg i dag?', ctx).questions[0].answer, 'agenda');
  assert.equal(sortCapture('hvordan blir været i morgen?', ctx).questions[0].answer, 'vaer');
});

test('kommandoer gjenkjennes, også som spørsmål', () => {
  assert.deepEqual(sortCapture('kan du flytte middagen med Sara til 19?', ctx).commands[0], { cmd: 'flytt', query: 'middagen med sara', when: '19' });
  assert.equal(sortCapture('jeg er på Kiwi', ctx).commands[0].place, 'butikken');
  assert.equal(sortCapture('ferdig med kap 4', ctx).commands[0].cmd, 'ferdig');
  assert.equal(sortCapture('jeg står fast', ctx).commands[0].cmd, 'fast');
});

test('meldinger blir utkast uten oppdiktede detaljer, også med liten forbokstav', () => {
  const m = one('si til emma at hun må sende notatene');
  assert.equal(m.kind, 'melding');
  assert.equal(m.person, 'Emma');
  assert.equal(m.draft.body, 'Hei Emma! Du må sende notatene.');
  assert.equal(m.draft.status, 'utkast');
  const bare = one('send melding til mamma');
  assert.equal(bare.draft.body, 'Hei Mamma! Hvordan går det?');
  assert.doesNotMatch(one('send melding til Sara om middagen').draft.body, /kaffe|sentrum/);
});

test('e-post til foreleser om utsettelse gir mal med plass til det brukeren må fylle inn', () => {
  const e = one('send mail til foreleser om utsettelse på innleveringen');
  assert.equal(e.kind, 'epost');
  assert.match(e.draft.body, /utsettelse på innleveringen/);
  assert.match(e.draft.body, /\[Skriv kort hvorfor/);
  assert.match(e.draft.body, /Tomine$/);
});

test('hver ting får en tilbakekomstregel', () => {
  assert.equal(one('kjøp melk').ret.type, 'sted');
  assert.equal(one('hent pakke på posten').ret.place, 'posten');
  assert.equal(one('spør Emma om notatene').ret.person, 'Emma');
  assert.equal(one('idé: app som gjør tid synlig').ret.type, 'uke');
  assert.equal(one('Jonas har laderen min').ret.type, 'person');
  assert.equal(one('bestille buss til hytta').ret.type, 'ledig');
  const tid = one('minn meg på å ringe banken i morgen kl 9');
  assert.equal(tid.ret.type, 'tid');
  assert.equal(tid.ret.at, atTime(addDays(startOfDay(NOW), 1), '09:00'));
  assert.equal(one('les kap 4 før fredag').ret.type, 'ledig');
  assert.equal(one('pitchen bør handle om bærekraft og unge kunder, sånn at vi skiller oss ut').ret.type, 'morgen');
});

test('avtaler får tidspunkt, varighet, person og gå-tid', () => {
  const a = one('lunsj med Sara fredag kl 12');
  assert.equal(a.kind, 'avtale');
  assert.equal(a.person, 'Sara');
  assert.equal(a.end - a.start, 45 * MIN);
  const b = one('møte med veileder torsdag kl 10, 20 min reise');
  assert.equal(b.title, 'Møte med veileder');
  assert.equal(b.travelMin, 20);
  assert.equal(b.ret.at, b.start - 35 * MIN);
});

test('frist deles i steg, ett om dagen', () => {
  const f = one('innlevering i markedsføring 1. desember');
  assert.equal(f.kind, 'frist');
  assert.equal(f.steps.length, 5);
  const days = f.steps.map((s) => s.day);
  assert.deepEqual([...days].sort((a, b) => a - b), days);
  assert.ok(days[days.length - 1] < f.due);
});

test('steg som glapp fordeles fra i dag uten å endre rekkefølgen', () => {
  const due = addDays(startOfDay(NOW), 4);
  const steps = [0, 1, 2].map((i) => ({ id: `s${i}`, title: `S${i}`, day: addDays(startOfDay(NOW), i - 2), done: false }));
  const r = replanSteps(steps, due, NOW);
  assert.equal(r.moved, 2);
  assert.ok(r.steps.every((s) => s.day >= startOfDay(NOW)));
  const d0 = startOfDay(NOW);
  assert.deepEqual(spread(3, d0, addDays(d0, 2)), [d0, addDays(d0, 1), addDays(d0, 2)]);
  assert.equal(planSteps('eksamen', addDays(startOfDay(NOW), 3), NOW).tight, true);
});

test('flere ting i én setning', () => {
  const r = sortCapture('kjøp melk og si til Jonas at jeg kommer kl 18', ctx);
  assert.deepEqual(r.items.map((i) => i.kind), ['handle', 'melding']);
  assert.deepEqual(splitClauses('les kap 4. Ring mamma'), ['les kap 4', 'Ring mamma']);
});

test('pickNow velger én ting med grunn, og respekterer opptatt tid', () => {
  const things = [
    { id: 'a', kind: 'oppgave', title: 'Les kap 4', status: 'aktiv', estimateMin: 45, ret: { type: 'ledig' }, due: NOW + 20 * HOUR, workType: 'lesing' },
    { id: 'b', kind: 'oppgave', title: 'Rydd skrivebordet', status: 'aktiv', estimateMin: 15, ret: { type: 'ledig' } },
    { id: 'c', kind: 'handle', title: 'Kjøp melk', status: 'aktiv', ret: { type: 'sted', place: 'butikken' } },
  ];
  const events = [{ id: 'e', title: 'Forelesning', start: NOW + 2 * HOUR, end: NOW + 4 * HOUR }];
  const n = pickNow({ now: NOW, things, events });
  assert.equal(n.mode, 'ledig');
  assert.equal(n.pick.thing.id, 'a');
  assert.match(n.pick.why, /frist/i);
  assert.ok(n.gapMin > 100 && n.gapMin < 120);
  assert.ok(!n.alternatives.some((u) => u.thing.id === 'c'));
  const busy = pickNow({ now: NOW + 3 * HOUR, things, events });
  assert.equal(busy.mode, 'opptatt');
  assert.match(timeStatus(busy, NOW + 3 * HOUR).title, /Opptatt til/);
  const atShop = pickNow({ now: NOW, things, events, place: 'butikken' });
  assert.ok([atShop.pick.thing.id, ...atShop.alternatives.map((u) => u.thing.id)].includes('c'));
});

test('ting kommer tilbake ved tid, sted og person', () => {
  const things = [
    { id: 't', kind: 'oppgave', title: 'Ring banken', status: 'aktiv', ret: { type: 'tid', at: NOW - 10 * MIN } },
    { id: 's', kind: 'handle', title: 'Kjøp melk', status: 'aktiv', ret: { type: 'sted', place: 'butikken' } },
    { id: 'p', kind: 'notat', title: 'Sara har boka mi', status: 'aktiv', ret: { type: 'person', person: 'Sara' } },
    { id: 'x', kind: 'oppgave', title: 'Senere', status: 'aktiv', ret: { type: 'tid', at: NOW + HOUR } },
  ];
  const events = [{ id: 'l', title: 'Lunsj med Sara', person: 'Sara', start: NOW + 60 * MIN, end: NOW + 105 * MIN }];
  const r = resurface({ now: NOW, things, events, place: 'butikken' });
  assert.deepEqual(r.map((x) => x.thing.id).sort(), ['p', 's', 't']);
  assert.match(r.find((x) => x.thing.id === 'p').reason, /møte Sara/);
});

test('morgenbrief gjør været om til handling og viser første avtale', () => {
  const morning = new Date(2026, 9, 7, 7, 40).getTime();
  const w = sampleWeather(morning);
  const events = [{ id: 'e', title: 'Forelesning', start: atTime(startOfDay(morning), '16:30'), end: atTime(startOfDay(morning), '18:00'), travelMin: 25 }];
  const b = morningBrief({ now: morning, weather: w, events, things: [], settings: { name: 'Tomine' } });
  assert.equal(b.greeting, 'God morgen, Tomine.');
  const wx = b.lines.find((l) => l.kind === 'vaer');
  assert.match(wx.action, /paraply når du går 16:05/);
  assert.match(b.lines.find((l) => l.kind === 'forst').action, /16:05/);
});

test('comeback rydder uten å telle det som glapp', () => {
  const things = [
    { id: 'a', kind: 'oppgave', title: 'Gammel', status: 'aktiv', ret: { type: 'tid', at: NOW - 3 * DAY }, estimateMin: 30 },
    { id: 'b', kind: 'notat', title: 'Gammel tanke', status: 'aktiv', ret: { type: 'morgen' }, createdAt: NOW - 6 * DAY },
  ];
  const c = comebackPlan({ now: NOW, things });
  assert.equal(c.moved, 1);
  assert.equal(c.archived, 1);
  assert.doesNotMatch(c.text, /glapp|forsinket|mistet/);
  assert.match(c.text, /Ingenting er slettet/);
  assert.ok(needsComeback(NOW - 2 * DAY, NOW));
});

test('jobbene kjører én gang og gir angrebare endringer', () => {
  const things = [{ id: 'f', kind: 'frist', title: 'Rapport', status: 'aktiv', due: addDays(startOfDay(NOW), 5), steps: [{ id: 's1', title: 'A', day: addDays(startOfDay(NOW), -1), done: false }, { id: 's2', title: 'B', day: startOfDay(NOW), done: false }] }];
  const res = runJobs({ now: NOW, things, jobState: {}, settings: {} });
  const frist = res.find((r) => r.id === 'frist');
  assert.equal(frist.ops.length, 1);
  assert.match(frist.text, /Flyttet 1 steg/);
  const again = runJobs({ now: NOW + MIN, things, jobState: { frist: { lastRun: NOW }, morgen: { lastRun: NOW }, rydding: { lastRun: NOW }, oppfolging: { lastRun: NOW } }, settings: {} });
  assert.equal(again.length, 0);
});

test('tilbakekomst kan endres med vanlige ord', () => {
  assert.equal(parseRetText('når jeg er på butikken', NOW).place, 'butikken');
  assert.equal(parseRetText('neste gang jeg snakker med emma', NOW).person, 'Emma');
  assert.equal(parseRetText('i morgen kl 9', NOW).at, atTime(addDays(startOfDay(NOW), 1), '09:00'));
  assert.equal(parseRetText('søndag', NOW).type, 'uke');
  assert.equal(retLabel({ type: 'sted', place: 'bi' }, NOW), 'når du er på BI');
});

test('finner tingen brukeren mener', () => {
  const things = [{ id: '1', title: 'Middag med Sara', status: 'aktiv', person: 'Sara' }, { id: '2', title: 'Les kap 4', status: 'aktiv' }];
  assert.equal(findThing('middagen med sara', things).id, '1');
  assert.equal(findThing('kap 4', things).id, '2');
  assert.equal(findThing('noe helt annet', things), null);
});

test('uka di teller bare det du fikk til', () => {
  const things = [{ id: '1', title: 'A', status: 'ferdig', doneAt: NOW - HOUR }];
  const w = weekReview({ now: NOW, things, sessions: [{ start: NOW - 2 * HOUR, actualMin: 25 }], comebacks: [{ at: NOW - DAY }] });
  assert.equal(w.done.length, 1);
  assert.equal(w.focusMin, 25);
  assert.equal(w.comebacks, 1);
});

test('påminnelse til telefonens kalender', () => {
  const link = googleCalendarLink({ title: 'Ring banken', start: Date.UTC(2026, 9, 8, 7, 0) });
  assert.match(link, /action=TEMPLATE/);
  assert.match(link, /20261008T070000Z%2F20261008T071500Z/);
  const ics = icsFor({ title: 'Ring banken', start: Date.UTC(2026, 9, 8, 7, 0), alarmMin: 0 });
  assert.match(ics, /BEGIN:VALARM/);
  assert.match(ics, /DTSTART:20261008T070000Z/);
});

test('bestillinger formulert som spørsmål blir lagret, ikke besvart', () => {
  assert.equal(one('kan du minne meg på å kjøpe melk?').kind, 'handle');
  const m = one('kan du si til emma at jeg er sen?');
  assert.equal(m.kind, 'melding');
  assert.equal(m.draft.body, 'Hei Emma! Jeg er sen.');
  assert.equal(one('kan du minne meg på å ringe tannlegen i morgen').title, 'Ring tannlegen');
});

test('spørsmål om andre dager og «lurer på» blir svar', () => {
  assert.equal(new Date(sortCapture('hva har jeg på fredag?', ctx).questions[0].day).getDay(), 5);
  assert.equal(sortCapture('lurer på om jeg har forelesning i morgen', ctx).questions[0].answer, 'agenda');
  assert.equal(sortCapture('er jeg ledig på fredag', ctx).questions[0].answer, 'ledig');
  assert.equal(one('emma lurer på om vi skal ta kaffe på fredag').kind, 'notat');
});

test('mottaker blir riktig, og meningen snus ikke', () => {
  assert.equal(one('send melding til jonas om at jeg er syk').draft.body, 'Hei Jonas! Jeg er syk.');
  assert.equal(one('fortell sara om at jeg ikke kommer').draft.body, 'Hei Sara! Jeg kommer ikke.');
  assert.equal(one('si til emma at jonas sa at han ikke kan komme').draft.body, 'Hei Emma! Jonas sa at han ikke kan komme.');
  assert.match(one('svare på mail fra lånekassen').draft.body, /^Hei,/);
  assert.equal(one('skriv mail til emma.hansen@bi.no om gruppeoppgaven').draft.address, 'emma.hansen@bi.no');
});

test('tider på norsk: halv ti, kl 3, i kveld, om en time, tidsrom', () => {
  const d = (x) => new Date(x);
  assert.equal(d(one('lunsj med sara halv ti').start).getHours() * 60 + d(one('lunsj med sara halv ti').start).getMinutes(), 9 * 60 + 30);
  assert.equal(d(one('møte kl 3 på fredag').start).getHours(), 15);
  assert.equal(d(one('middag kl 7 i kveld').start).getHours(), 19);
  assert.equal(one('ring mamma om en time').ret.at, NOW + HOUR);
  const shift = one('vakt på jobben lørdag 10-18');
  assert.equal(shift.kind, 'avtale');
  assert.equal(d(shift.end).getHours(), 18);
  assert.equal(new Date(one('innlevering 3. des kl 14').due).getHours(), 14);
});

test('i morgen uten klokkeslett kommer tilbake i morgen tidlig, ikke aldri', () => {
  const r = one('ring tannlegen i morgen');
  assert.equal(r.ret.type, 'tid');
  assert.equal(r.ret.at, atTime(addDays(startOfDay(NOW), 1), '07:30'));
});

test('informasjon blir notat, ikke en ny frist med studieplan', () => {
  assert.equal(one('Emma sa at eksamen er flyttet til 12. des').kind, 'notat');
  assert.equal(one('tror jeg glemte å melde meg opp til eksamen og fristen er kanskje på fredag').kind, 'notat');
  assert.equal(one('kaffe med emma fredag').kind, 'avtale');
  assert.equal(one('husk at jonas har laderen min').ret.type, 'person');
});

test('ærend med frist og morgen-ting kommer tilbake på Nå', () => {
  const fri = new Date(2026, 9, 9, 13, 0).getTime();
  const things = [
    { id: 'g', kind: 'handle', title: 'Kjøp gave', status: 'aktiv', due: new Date(2026, 9, 10).getTime(), ret: { type: 'sted', place: 'byen' } },
    { id: 'n', kind: 'notat', title: 'Sjekk skrivekurs', status: 'aktiv', ret: { type: 'morgen' }, createdAt: NOW },
  ];
  const r = resurface({ now: fri, things, events: [] });
  assert.deepEqual(r.map((x) => x.thing.id).sort(), ['g', 'n']);
  assert.ok(pickNow({ now: fri, things, events: [] }).pick);
});
