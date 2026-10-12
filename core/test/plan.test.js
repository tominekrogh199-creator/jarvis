import test from 'node:test';
import assert from 'node:assert/strict';
import { planWork, replanSessions, sessionEvents, canWait, bestTime, worthPlanning, questionsFor, daysText } from '../planwork.js';
import { sortCapture } from '../sort.js';
import { pickNow, resurface } from '../now.js';
import { runJobs } from '../jobs.js';
import { startOfDay, addDays, atTime, MIN, HOUR } from '../time.js';

const FRI = new Date(2026, 9, 9, 14, 0).getTime(); // fredag 9. oktober 14:00
const day = (t) => new Date(t).getDay(); // 0 søn … 3 ons, 4 tor
const work = (p) => p.steps.filter((s) => !s.kick && !s.deliver);

test('arbeidskrav mandag om ti dager, planlagt fredag: jobb onsdag og torsdag, fredag er buffer, lever mandag', () => {
  const due = new Date(2026, 9, 20).getTime(); // slutten av mandag 19.
  const p = planWork({ title: 'Arbeidskrav i markedsføring', due, now: FRI });
  assert.equal(p.fits, true);
  assert.deepEqual([...new Set(work(p).map((s) => day(s.at)))], [3, 4]);
  assert.match(p.summary, /onsdag og torsdag/);
  assert.ok(p.lines.notLines.some((l) => /fredag 16\. okt er buffer/i.test(l)));
  const del = p.steps.find((s) => s.deliver);
  assert.equal(del.at, atTime(new Date(2026, 9, 19).getTime(), '10:00'));
  assert.match(p.lines.deliver, /lever/);
  // En kikk på oppgaven i dag, så du vet hva du går til.
  const kick = p.steps.find((s) => s.kick);
  assert.ok(kick && startOfDay(kick.at) === startOfDay(FRI));
  assert.ok(p.lines.notLines[0].includes('Etter kikken trenger du ikke tenke på den før onsdag'));
});

test('kort frist: starter i dag, aldri etter fristen, aldri oppå avtaler', () => {
  const due = new Date(2026, 9, 13).getTime(); // mandag 12.
  const lecture = { id: 'f', title: 'Forelesning', start: atTime(FRI, '15:00'), end: atTime(FRI, '17:00') };
  const p = planWork({ title: 'Arbeidskrav i markedsføring', due, now: FRI, events: [lecture] });
  assert.equal(p.fits, true);
  assert.equal(p.tight, true);
  assert.equal(startOfDay(work(p)[0].at), startOfDay(FRI));
  for (const s of work(p)) {
    assert.ok(s.end <= due);
    assert.ok(s.at >= FRI);
    assert.ok(!(s.at < lecture.end + 10 * MIN && lecture.start - 10 * MIN < s.end), `kolliderer: ${new Date(s.at)}`);
  }
  // Rekkefølgen holder.
  const ats = work(p).map((s) => s.at);
  assert.deepEqual(ats, [...ats].sort((a, b) => a - b));
});

test('eksamen: siste økt dagen før, «pakk sekken» kvelden før, ingen buffer', () => {
  const exam = new Date(2026, 9, 22, 9, 0).getTime();
  const p = planWork({ title: 'Eksamen i statistikk', due: exam, dueHasTime: true, now: FRI, prefer: 'morgen' });
  const last = work(p)[work(p).length - 1];
  assert.equal(startOfDay(last.at), startOfDay(addDays(startOfDay(exam), -1)));
  assert.ok(work(p).every((s) => new Date(s.at).getHours() < 12), 'morgenmenneske får morgenøkter');
  const del = p.steps.find((s) => s.deliver);
  assert.match(del.title, /Pakk sekken/);
  assert.equal(new Date(del.at).getHours(), 20);
});

test('svarene endrer planen: halvveis og liten gir færre økter, «komme i gang» gir et mini-steg først', () => {
  const due = new Date(2026, 9, 20).getTime();
  const full = planWork({ title: 'Rapport i økonomi', due, now: FRI });
  const half = planWork({ title: 'Rapport i økonomi', due, now: FRI, answers: { done: 'halvveis', size: 'liten' } });
  assert.ok(half.totalMin < full.totalMin);
  assert.ok(work(half).length < work(full).length);
  const start = planWork({ title: 'Rapport i økonomi', due, now: FRI, answers: { hard: 'starte' } });
  assert.match(work(start)[0].title, /Bare start/);
  assert.equal(work(start)[0].estimateMin, 15);
});

test('for lite tid: ærlig advarsel med veier videre', () => {
  const due = FRI + 5 * HOUR;
  const busy = [{ id: 'j', title: 'Jobb', start: FRI, end: FRI + 5 * HOUR }];
  const p = planWork({ title: 'Bacheloroppgave', due, dueHasTime: true, now: FRI, events: busy, answers: { size: 'stor' } });
  assert.equal(p.fits, false);
  assert.match(p.warnings[0], /Gjør den mindre|utsettelse/);
});

test('økter som glapp eller kolliderer med en ny avtale, flyttes; gjorte steg står', () => {
  const due = new Date(2026, 9, 20).getTime();
  const p = planWork({ title: 'Arbeidskrav i markedsføring', due, now: FRI });
  const th = { id: 't1', title: 'Arbeidskrav i markedsføring', kind: 'frist', status: 'aktiv', due, steps: p.steps };
  const firstWork = work(p)[0];
  // Hopp til etter første økt uten å gjøre den.
  const later = firstWork.end + 30 * MIN;
  const r = replanSessions(th, later, []);
  assert.ok(r.moved >= 1);
  const moved = r.steps.find((s) => s.id === firstWork.id);
  assert.ok(moved.at > later);
  assert.ok(r.steps.some((s) => s.deliver));
  // Ny avtale oppå en framtidig økt.
  const target = work(p)[2];
  const clash = { id: 'ny', title: 'Tannlege', start: target.at, end: target.end };
  const r2 = replanSessions(th, FRI, [clash]);
  const t2 = r2.steps.find((s) => s.id === target.id);
  assert.ok(!(t2.at < clash.end && clash.start < t2.end));
  // Fristjobben gjør det samme og sier hva den gjorde.
  const res = runJobs({ now: later, things: [th], jobState: {}, events: [], settings: {} }).find((x) => x.id === 'frist');
  assert.ok(res.ops.length === 1 && /Flyttet 1 økt/.test(res.text));
});

test('Nå: økta di er nå, og før den kan fristen vente', () => {
  const due = new Date(2026, 9, 20).getTime();
  const p = planWork({ title: 'Arbeidskrav i markedsføring', due, now: FRI });
  const th = { id: 't1', title: 'Arbeidskrav i markedsføring', kind: 'frist', status: 'aktiv', due, steps: p.steps.filter((s) => !s.kick), ret: { type: 'ledig' } };
  const before = pickNow({ now: FRI + HOUR, things: [th], events: sessionEvents([th]) });
  assert.equal(before.pick, null, 'ingenting å gjøre med den på fredag');
  assert.match(canWait([th], FRI)[0].text, /neste økt onsdag/);
  const s1 = work(p)[0];
  const during = pickNow({ now: s1.at + 5 * MIN, things: [th], events: sessionEvents([th]) });
  assert.equal(during.pick.step.id, s1.id);
  assert.equal(during.pick.session, true);
  assert.match(during.pick.why, /satte av/);
  const sur = resurface({ now: s1.at + 1 * MIN, things: [th], events: [] });
  assert.equal(sur[0].type, 'okt');
  const del = p.steps.find((s) => s.deliver);
  const done = { ...th, steps: th.steps.map((s) => (s.deliver ? s : { ...s, done: true })) };
  const sur2 = resurface({ now: del.at + MIN, things: [done], events: [] });
  assert.equal(sur2[0].type, 'lever');
});

test('fangst: frist med klokkeslett, og hva som er verdt å planlegge', () => {
  const r = sortCapture('eksamen i statistikk 22. oktober kl 9', { now: FRI }).items[0];
  assert.equal(r.kind, 'frist');
  assert.equal(r.dueHasTime, true);
  assert.equal(new Date(r.due).getHours(), 9);
  assert.ok(worthPlanning(r));
  assert.ok(!worthPlanning({ kind: 'oppgave', title: 'Kjøp melk' }));
  assert.equal(questionsFor(r, { prefer: 'kveld' }).some((q) => q.id === 'prefer'), false);
});

test('beste tid for en liten ting, og dager som tekst', () => {
  const ev = [{ id: 'a', title: 'Møte', start: FRI + 20 * MIN, end: FRI + 2 * HOUR }];
  const b = bestTime(15, { now: FRI, events: ev });
  assert.ok(b.at >= FRI + 2 * HOUR + 10 * MIN);
  assert.match(b.text, /^i dag/);
  assert.equal(daysText([addDays(FRI, 5), addDays(FRI, 6), addDays(FRI, 7)], FRI), 'fra onsdag til fredag 16. okt');
});
