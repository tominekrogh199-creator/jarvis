import test from 'node:test';
import assert from 'node:assert/strict';
import { agentCommand, fitArgs, findEvents, isOwnEvent, isoLocal, trimSchema, validateProposal, AGENTS, CONNECTOR_TOOLS } from '../agents.js';

const NOW = new Date(2026, 9, 7, 13, 20).getTime();

test('agentkommandoer på vanlig norsk', () => {
  assert.deepEqual(agentCommand('sjekk mailen'), { agent: 'post', task: 'sjekk' });
  assert.deepEqual(agentCommand('Kan du sjekke mailen?'), { agent: 'post', task: 'sjekk' });
  assert.deepEqual(agentCommand('les innboksen min'), { agent: 'post', task: 'sjekk' });
  assert.deepEqual(agentCommand('har jeg fått noen viktige mailer?'), { agent: 'post', task: 'sjekk' });
  assert.deepEqual(agentCommand('hent kalenderen'), { agent: 'kalender', task: 'hent' });
  assert.deepEqual(agentCommand('legg øktene i kalenderen'), { agent: 'kalender', task: 'skriv' });
  assert.deepEqual(agentCommand('legg planen inn i google kalender'), { agent: 'kalender', task: 'skriv' });
  assert.deepEqual(agentCommand('planlegg fristene'), { agent: 'planlegger', task: 'uke' });
  // Vanlige fangster er ikke agentkommandoer.
  for (const t of ['send mail til foreleser om utsettelse', 'kjøp melk', 'innlevering i markedsføring fredag', 'sjekk om Emma kan i morgen']) assert.equal(agentCommand(t), null, t);
});

test('argumenter tilpasses verktøyets skjema', () => {
  const cal = { type: 'object', properties: { calendar_id: { type: 'string' }, time_min: { type: 'string' }, time_max: { type: 'string' }, max_results: { type: 'integer' } } };
  const r = fitArgs(cal, { calendarId: 'primary', timeMin: 'a', timeMax: 'b', max: '50', timeZone: 'Europe/Oslo' });
  assert.deepEqual(r.args, { calendar_id: 'primary', time_min: 'a', time_max: 'b', max_results: 50 });
  const camel = { type: 'object', properties: { calendarId: { type: 'string' }, timeMin: { type: 'string' } }, required: ['calendarId'] };
  assert.deepEqual(fitArgs(camel, { calendarId: 'primary', timeMin: 'a' }).args, { calendarId: 'primary', timeMin: 'a' });
  const ev = { type: 'object', properties: { summary: { type: 'string' }, start: { type: 'object', properties: { dateTime: { type: 'string' }, timeZone: { type: 'string' } } } }, required: ['summary', 'start', 'end'] };
  const e = fitArgs(ev, { summary: 'Økt', start: '2026-10-14T12:00:00+02:00' });
  assert.deepEqual(e.args.start, { dateTime: '2026-10-14T12:00:00+02:00', timeZone: 'Europe/Oslo' });
  assert.deepEqual(e.missing, ['end']);
  const mail = { type: 'object', properties: { to: { type: 'array', items: { type: 'string' } }, body: { type: 'string' } } };
  assert.deepEqual(fitArgs(mail, { to: 'a@b.no, c@d.no', body: 'Hei' }).args, { to: ['a@b.no', 'c@d.no'], body: 'Hei' });
  // Uten skjema: vanligste navn.
  assert.deepEqual(fitArgs(null, { threadId: 't1' }).args, { thread_id: 't1' });
});

test('avtaler finnes i svaret uansett innpakning, og egne økter hoppes over', () => {
  const payload = { result: JSON.stringify({ items: [
    { id: 'a', summary: 'Forelesning', start: { dateTime: '2026-10-08T10:15:00+02:00' }, end: { dateTime: '2026-10-08T12:00:00+02:00' }, location: 'B2-020' },
    { id: 'b', summary: 'Bursdag', start: { date: '2026-10-09' }, end: { date: '2026-10-10' } },
    { id: 'c', summary: 'Avlyst', status: 'cancelled', start: { dateTime: '2026-10-08T14:00:00+02:00' } },
    { id: 'd', summary: 'Jarvis: Skriv utkast', start: { dateTime: '2026-10-08T16:00:00+02:00' }, end: { dateTime: '2026-10-08T16:45:00+02:00' } },
  ] }) };
  const ev = findEvents(payload);
  assert.equal(ev.length, 3);
  assert.equal(ev[0].title, 'Forelesning');
  assert.equal(ev[0].place, 'B2-020');
  assert.equal(new Date(ev[0].start).getHours(), 10);
  assert.equal(ev.find((e) => e.title === 'Bursdag').allDay, true);
  assert.equal(ev.filter((e) => !isOwnEvent(e)).length, 2);
  assert.equal(isoLocal(new Date(2026, 9, 14, 12, 0).getTime()), '2026-10-14T12:00:00+02:00');
  assert.equal(isoLocal(new Date(2026, 11, 1, 9, 0).getTime()), '2026-12-01T09:00:00+01:00');
});

test('forslag fra Claude kontrolleres', () => {
  const f = validateProposal('ting', { kind: 'frist', title: 'Arbeidskrav 2', date: '2026-10-23', why: 'x' }, NOW);
  assert.equal(f.kind, 'frist');
  assert.equal(new Date(f.at).getDate(), 23);
  // Frist uten dato blir en oppgave; dato langt bak i tid avvises.
  assert.equal(validateProposal('ting', { kind: 'frist', title: 'Noe', date: '2019-01-01', why: 'x' }, NOW).kind, 'oppgave');
  assert.equal(validateProposal('ting', { kind: 'frist', title: '' }, NOW), null);
  assert.equal(validateProposal('epost', { to: 'ikke en adresse', body: 'Hei' }, NOW), null);
  assert.equal(validateProposal('epost', { to: 'kari@bi.no', body: 'Hei', thread_id: 't1' }, NOW).threadId, 't1');
});

test('register og verktøylister', () => {
  assert.equal(AGENTS.length, 6);
  for (const a of AGENTS) assert.ok(a.role && a.rights && a.routine && a.tools.length, a.id);
  assert.deepEqual(CONNECTOR_TOOLS.Gmail, ['search_threads', 'get_thread', 'create_draft', 'send_message']);
  const big = { type: 'object', properties: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`felt${i}`, { type: 'string', description: 'x'.repeat(200) }])) };
  assert.ok(JSON.stringify(trimSchema(big, null)).length <= 3800);
});

test('vær fra morgenjobben (Yr) i enkelt format', async () => {
  const { fromSimple, today } = await import('../weather.js');
  const at = new Date(2026, 9, 8, 7, 30).getTime();
  const w = fromSimple({ at, place: 'Oslo', hours: [{ time: '07:00', temp: 6, kind: 'sky' }, { time: '08:00', temp: 7, kind: 'delvis' }, { time: '15:00', temp: 9, kind: 'regn', mm: 1.2 }] }, { name: 'Oslo' }, at);
  assert.equal(w.now.temp, 6);
  assert.equal(w.source, 'yr');
  assert.equal(new Date(today(w, at).wetFrom).getHours(), 15);
  assert.equal(fromSimple({ hours: [] }, { name: 'Oslo' }, at), null);
});

test('agentkommandoer: hele setningen må være kommandoen', () => {
  for (const t of ['kan du hente kalenderen?', 'noe nytt i innboksen?', 'kan du se om jeg har fått noen mail?', 'sjekk mailen min', 'les gmail', 'synk google kalender', 'legg øktene mine i google-kalenderen']) assert.ok(agentCommand(t), t);
  for (const t of ['sett det i kalenderen', 'legg det i kalenderen: tannlege fredag kl 14', 'sjekk mailen til jonas i morgen', 'nye mailadresse til mamma: x@y.no', 'oppdater kalenderen med tannlegetimen', 'planlegg uka med Emma', 'les kapittel 4 før fredag']) assert.equal(agentCommand(t), null, t);
});

test('mot de ekte skjemaene til koblingene (lest fra claude.ai)', async () => {
  const fs = await import('node:fs');
  const fx = JSON.parse(fs.readFileSync(new URL('../../scripts/fixtures/connectors.json', import.meta.url), 'utf8'));
  const { isoNaive } = await import('../agents.js');
  const cal = fx['Google Calendar'];
  const at = new Date(2026, 9, 14, 12, 0).getTime();
  const list = fitArgs(cal.list_events, { calendarId: 'primary', timeMin: isoNaive(at), timeMax: isoNaive(at + 8 * 86400000), max: 250 });
  assert.deepEqual(list.args, { calendarId: 'primary', startTime: '2026-10-14T12:00:00', endTime: '2026-10-22T12:00:00', pageSize: 250 });
  const create = fitArgs(cal.create_event, { calendarId: 'primary', summary: 'Jarvis: Skriv', description: 'x', start: isoNaive(at), end: isoNaive(at + 45 * 60000), reminders: [{ method: 'popup', minutes: 5 }] });
  assert.deepEqual(create.missing, []);
  assert.equal(create.args.startTime, '2026-10-14T12:00:00');
  assert.equal(create.args.endTime, '2026-10-14T12:45:00');
  assert.deepEqual(create.args.overrideReminders, [{ method: 'popup', minutes: 5 }]);
  const upd = fitArgs(cal.update_event, { calendarId: 'primary', eventId: 'abc', summary: 'x', start: 'a', end: 'b' });
  assert.deepEqual(upd.missing, []);
  assert.equal(upd.args.eventId, 'abc');
  const g = fx.Gmail;
  const send = fitArgs(g.send_message, { to: 'kari@bi.no', subject: 'Re: x', body: 'Hei', threadId: 't1' });
  assert.deepEqual(send.args, { to: ['kari@bi.no'], subject: 'Re: x', body: 'Hei', replyThreadId: 't1' });
  assert.deepEqual(fitArgs(g.get_thread, { threadId: 't1', format: 'PLAIN_TEXT' }).args, { threadId: 't1', messageFormat: 'PLAIN_TEXT' });
  assert.deepEqual(fitArgs(g.search_threads, { query: 'newer_than:1d', max: 20 }).args, { query: 'newer_than:1d', pageSize: 20 });
  // Svarformen fra list_events: hendelser med dateTime, og heldag med «date» som tidspunkt i UTC.
  const ev = findEvents({ events: [
    { id: 'a', summary: 'Forelesning', status: 'confirmed', start: { dateTime: '2026-10-14T10:15:00+02:00', timeZone: 'Europe/Oslo' }, end: { dateTime: '2026-10-14T12:00:00+02:00', timeZone: 'Europe/Oslo' } },
    { id: 'b', summary: 'Hyttetur', status: 'confirmed', start: { date: '2026-10-10T00:00:00Z' }, end: { date: '2026-10-12T00:00:00Z' } },
  ], summary: 'tomine@eksempel.no', timeZone: 'Europe/Oslo' });
  assert.equal(ev.length, 2);
  const hytte = ev.find((e) => e.title === 'Hyttetur');
  assert.equal(hytte.allDay, true);
  assert.equal(new Date(hytte.start).getDate(), 10);
  assert.equal(new Date(hytte.start).getHours(), 0);
  assert.ok(trimSchema(g.search_threads, null) && JSON.stringify(trimSchema(g.search_threads, null)).length <= 3800);
});
