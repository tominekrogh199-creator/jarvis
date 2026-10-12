// Tester for gjenbrukt kjerne: tid, planlegger, frister og søk.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MIN, DAY, atTime, addDays, startOfDay, nextMorning, logicalDayStart, hhmm, fmtCountdown, isoWeekday } from '../time.js';
import { findConflicts, findSlots, timeFactor, blockIntervals, adjustedDuration, rankTasks } from '../planner.js';
import { parseDue } from '../due.js';
import { searchThoughts, parseSearchDate, stem } from '../search.js';

// Torsdag 1. oktober 2026 kl. 09:00 lokal tid.
const THU = new Date(2026, 9, 1, 9, 0).getTime();
const day = (offset, time) => atTime(addDays(startOfDay(THU), offset), time);

// ---------- Tid ----------

test('neste morgen er kl. 06 dagen etter det logiske døgnet', () => {
  assert.equal(nextMorning(day(0, '21:00')), day(1, '06:00'));
  assert.equal(nextMorning(day(1, '02:00')), day(1, '06:00'), 'kl. 02 hører til kvelden før');
  assert.equal(nextMorning(day(1, '05:00')), day(2, '06:00'));
  assert.equal(logicalDayStart(day(1, '03:59')), day(0, '04:00'));
});

test('format for nedtelling', () => {
  assert.equal(fmtCountdown(65_000), '01:05');
  assert.equal(fmtCountdown(3_725_000), '1:02:05');
  assert.equal(isoWeekday(THU), 4);
});

// ---------- Planleggeren ----------

const blocks = [
  { id: 'sovn', title: 'Søvn', start: '23:00', end: '07:00' },
  { id: 'trening', title: 'Trening', start: '17:00', end: '18:30', days: [2, 4] },
];
const events = [
  { id: 'f1', kind: 'forelesning', title: 'Forelesning', start: day(0, '10:00'), end: day(0, '12:00') },
];

test('kollisjoner med hendelser, buffer og sperretider sjekkes i kode', () => {
  assert.equal(findConflicts({ start: day(0, '11:00'), end: day(0, '11:30') }, { events }).length, 1);
  assert.equal(findConflicts({ start: day(0, '12:05'), end: day(0, '12:30') }, { events, bufferMin: 10 }).length, 1, 'buffer');
  assert.equal(findConflicts({ start: day(0, '12:15'), end: day(0, '12:45') }, { events, bufferMin: 10 }).length, 0);
  const sleep = findConflicts({ start: day(1, '06:00'), end: day(1, '06:30') }, { blocks });
  assert.equal(sleep.length, 1, 'nattsperre fra kvelden før dekker morgenen');
  assert.equal(sleep[0].id, 'sovn');
  assert.equal(findConflicts({ start: day(0, '17:30'), end: day(0, '18:00') }, { blocks }).length, 1, 'trening torsdag');
  assert.equal(findConflicts({ start: day(1, '17:30'), end: day(1, '18:00') }, { blocks }).length, 0, 'ikke trening fredag');
});

test('glippede og ryddede økter frigjør tiden sin', () => {
  const ev = [{ id: 'o1', kind: 'okt', status: 'glippet', title: 'Les', start: day(0, '13:00'), end: day(0, '14:00') }];
  assert.equal(findConflicts({ start: day(0, '13:00'), end: day(0, '13:30') }, { events: ev }).length, 0);
});

test('«hvor passer dette?» gir 2–3 tider uten kollisjon og før fristen', () => {
  const due = day(3, '00:00');
  const { slots } = findSlots({ now: THU, durationMin: 45, events, blocks, due });
  assert.ok(slots.length >= 2 && slots.length <= 3, `fikk ${slots.length}`);
  for (const s of slots) {
    assert.equal(findConflicts(s, { events, blocks, bufferMin: 10 }).length, 0);
    assert.ok(s.end <= due);
    assert.ok(s.consequence.length > 3);
    assert.ok(s.why.length > 3);
  }
  const sorted = [...slots].sort((a, b) => a.start - b.start);
  assert.deepEqual(slots, sorted);
});

test('tidsfaktoren gjør økter lengre og forklarer hvorfor', () => {
  const done = [45, 30, 60].map((p, i) => ({ id: `d${i}`, kind: 'okt', status: 'ferdig', plannedMin: p, actualMin: Math.round(p * 1.3), end: day(-1, '10:00') + i }));
  const tf = timeFactor(done);
  assert.equal(tf.factor, 1.3);
  assert.match(tf.why, /30 % lengre/);
  assert.equal(adjustedDuration(45, tf.factor), 60);
  const { slots } = findSlots({ now: THU, durationMin: 45, events, blocks, factor: tf.factor });
  assert.equal(slots[0].durationMin, 60);
  assert.equal(timeFactor(done.slice(0, 2)).factor, 1, 'for få økter gir 1,0');
});

test('ingen ledig tid gir tom liste og forklaring', () => {
  const r = findSlots({ now: day(0, '21:50'), durationMin: 120, events, blocks, due: day(0, '23:59') });
  assert.equal(r.slots.length, 0);
  assert.match(r.why, /mindre/);
});

test('sperretider lager intervaller over midnatt', () => {
  const iv = blockIntervals(blocks, day(0, '00:00')).filter((b) => b.id === 'sovn');
  assert.ok(iv.some((b) => b.start === day(-1, '23:00') && b.end === day(0, '07:00')));
});

test('rangering løfter frist og aktive prosjekter', () => {
  const r = rankTasks([
    { id: 'a', title: 'Senere', due: day(10, '00:00') },
    { id: 'b', title: 'Snart', due: day(1, '00:00') },
    { id: 'c', title: 'Ferdig', status: 'ferdig', due: day(0, '12:00') },
  ], { now: THU });
  assert.equal(r[0].task.id, 'b');
  assert.equal(r.length, 2);
});

// ---------- Fangeren ----------

test('frister: «innen fredag» er slutten av fredag, datoer forstås', () => {
  assert.equal(parseDue('innen fredag', THU).due, day(2, '00:00'));
  assert.equal(parseDue('før fredag', THU).due, day(1, '00:00'));
  assert.equal(parseDue('levere 12.10', THU).due, new Date(2026, 9, 13).getTime());
  assert.equal(parseDue('ingen frist her', THU), null);
});

test('søk: «hva tenkte jeg om pitchen på tirsdag?»', () => {
  const tue = day(-2, '14:00');
  const thoughts = [
    { id: 'a', text: 'Idé: pitchen bør starte med en kundehistorie', createdAt: tue },
    { id: 'b', text: 'Pitch: husk å øve på timingen', createdAt: day(-1, '10:00') },
    { id: 'c', text: 'Kjøpe melk', createdAt: tue },
  ];
  const r = searchThoughts('hva tenkte jeg om pitchen på tirsdag?', thoughts, { now: THU });
  assert.equal(r[0].thought.id, 'a');
  assert.match(r[0].why, /pitch/);
  assert.ok(!r.some((x) => x.thought.id === 'c'));
  assert.equal(parseSearchDate('på tirsdag', THU).from, startOfDay(tue));
  assert.equal(stem('pitchen'), 'pitch');
});

