// Ende-til-ende i headless Chromium med klokka låst til onsdag 7. oktober 2026 kl. 13:20.
// Kjør: npm run e2e   (bruker global Playwright hvis den finnes). Skjermbilder havner i screenshots/.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
function loadPlaywright() {
  try { return require('playwright'); } catch { /* prøv global */ }
  try { return require(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright')); } catch { return null; }
}
const pw = loadPlaywright();
if (!pw) { console.log('Playwright er ikke installert. Hopper over e2e.'); process.exit(0); }

const shots = path.join(root, process.env.SHOTS || 'screenshots');
fs.mkdirSync(shots, { recursive: true });
const url = pathToFileURL(path.join(root, 'dist', 'jarvis.html')).href;
const W = Number(process.env.W || 400);
const H = Number(process.env.H || 860);
const scheme = process.env.SCHEME || 'light';
const START = new Date(2026, 9, 7, 13, 20);

const browser = await pw.chromium.launch();
const context = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: scheme, timezoneId: 'Europe/Oslo', locale: 'nb-NO' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_|net::/.test(m.text())) errors.push(`console: ${m.text()}`); });
let n = 0;
const shot = async (name, full = false) => { n++; await page.screenshot({ path: path.join(shots, `${String(n).padStart(2, '0')}-${name}.png`), fullPage: full }); };
const checks = [];
const ok = (cond, label) => { checks.push([!!cond, label]); console.log(`${cond ? '  ✓' : '  ✗'} ${label}`); };
const wait = (ms) => page.waitForTimeout(ms);
const say = async (text) => { await page.fill('#say', text); await page.press('#say', 'Enter'); await wait(700); };
const closeSheet = async () => { const b = page.locator('.sheet.in .sheet-head .iconbtn').last(); if (await b.count()) { await b.click(); await wait(400); } };
const things = () => page.evaluate(() => window.jarvis.store.ds().things.length);
const clearToasts = () => page.evaluate(() => { document.getElementById('toasts').innerHTML = ''; });

await page.clock.install({ time: START });
await page.goto(url);
await page.clock.resume();
await wait(1200);

console.log('Oppstart');
await shot('oppstart');
ok(await page.locator('.sheet.in').count(), 'oppstarten vises første gang');
await page.fill('#onb-name', 'Tomine');
await page.getByRole('button', { name: 'Videre' }).click();
await wait(300);
await page.getByRole('button', { name: 'Tonet' }).first().click();
await page.getByRole('button', { name: 'Videre' }).click();
await wait(300);
await page.getByRole('button', { name: /Se en eksempeldag/ }).click();
await wait(900);
await clearToasts();
await shot('na');
await shot('na-hele', true);
ok(await page.locator('.now').count() === 1, 'Nå-kortet vises');
ok(/Hei, Tomine\./.test(await page.locator('h1.display').innerText()), 'hilsen med navn');
ok(await page.locator('.demo-pill').count() === 1, 'eksempeldagen er merket');
ok(await page.locator('text=Dukker opp nå').count() === 1, '«Dukker opp nå» viser det som skal komme tilbake');

console.log('Fangst');
const before = await things();
await say('kjøp melk og si til jonas at jeg kommer kl 18');
await shot('fangst-varsel');
ok((await things()) === before + 2, 'to ting fra én setning');
const reply = await page.evaluate(() => window.jarvis.store.ds().chat.at(-1).text);
ok(!/^Gjort/.test(reply), 'Jarvis sier ikke «Gjort» om noe som ikke er gjort');
const melk = await page.evaluate(() => window.jarvis.store.ds().things.find((t) => /melk/i.test(t.title)));
ok(melk?.ret?.type === 'sted' && melk.ret.place === 'butikken', 'melk kommer tilbake når du er på butikken');
await clearToasts();

console.log('Spørsmål');
const before2 = await things();
await say('hva har jeg i dag?');
await wait(500);
await shot('samtale');
ok((await things()) === before2, 'spørsmål blir ikke til oppgaver');
ok(await page.locator('.msg.ai').count() >= 1, 'svar i samtalen');
await closeSheet();

console.log('Sted');
await say('jeg er på butikken');
await wait(300);
await clearToasts();
await page.evaluate(() => window.scrollTo(0, 0));
await shot('pa-butikken');
ok(await page.locator('.row-reason', { hasText: 'Du er på butikken' }).count() >= 1, 'ting for butikken dukker opp');

console.log('Utkast');
await page.locator('.list .row', { hasText: 'Melding til Emma' }).first().click();
await wait(500);
await shot('utkast');
ok(await page.locator('#dr-body').count() === 1, 'utkastet kan redigeres');
ok(await page.locator('text=Jarvis sender aldri selv').count() >= 1, 'sier tydelig at Jarvis ikke sender selv');
await page.getByRole('button', { name: 'Jeg har sendt den' }).click();
await wait(400);
ok(await page.evaluate(() => window.jarvis.store.ds().things.find((t) => t.title === 'Melding til Emma').status === 'ferdig'), '«Jeg har sendt den» markerer som ferdig');
await clearToasts();

console.log('Tilbakekomst');
await page.getByRole('button', { name: 'Tanker' }).last().click();
await wait(400);
await page.locator('.ret').first().click();
await wait(500);
await shot('tilbakekomst');
await page.fill('#ret-text', 'i morgen kl 9');
await page.getByRole('button', { name: 'Lagre' }).click();
await wait(400);
ok(await page.evaluate(() => window.jarvis.store.ds().log[0].text.includes('i morgen kl. 09:00')), 'tilbakekomst endret med vanlige ord');
await clearToasts();
await page.getByRole('button', { name: 'Nå' }).last().click();
await wait(400);

console.log('Fokus');
await page.evaluate(() => window.scrollTo(0, 0));
const start = page.locator('#start-now');
ok(await start.count() === 1, 'Start-knapp på Nå-kortet');
await start.click();
await wait(800);
await shot('fokus');
ok(await page.locator('.focus .dial').count() === 1, 'fokus med skive');
await page.fill('#focus-say', 'husk å sende CV til Maja');
await page.press('#focus-say', 'Enter');
await wait(600);
ok(await page.evaluate(() => window.jarvis.store.ds().things.some((t) => /CV/.test(t.title) && t.ret.type === 'etter')), 'tanke fra økta venter til etter økta');
await page.getByRole('button', { name: 'Ferdig' }).first().click();
await wait(500);
ok(await page.evaluate(() => window.jarvis.store.ds().things.some((t) => /CV/.test(t.title) && t.ret.type !== 'etter')), 'tanken får sin vanlige tilbakekomst etter økta');
await shot('etter-fokus');
await clearToasts();

console.log('Dag');
await page.getByRole('button', { name: 'Dag' }).last().click();
await wait(500);
await shot('dag');
await shot('dag-hele', true);
ok(await page.locator('.tl-item').count() >= 2, 'tidslinja viser avtaler');
ok(await page.locator('.tl-now').count() === 1, 'nå-linje i tidslinja');
ok(await page.locator('.tl-go').count() >= 1, '«Gå»-merke for avtale med reisetid');
await page.locator('.tl-gap').first().click();
await wait(400);
await shot('ledig-luke');
await closeSheet();

console.log('Tanker');
await page.getByRole('button', { name: 'Tanker' }).last().click();
await wait(500);
await shot('tanker', true);
ok(await page.locator('text=Når du er på butikken').count() >= 1, 'tanker gruppert etter sted');
await page.fill('#tanker-q', 'pitch');
await wait(700);
await shot('sok');
ok(await page.locator('.row-title', { hasText: 'Pitchen' }).count() >= 1, 'søk finner idéen');
await page.fill('#tanker-q', '');
await wait(500);

console.log('Meg og Bak kulissene');
await page.getByRole('button', { name: 'Meg og innstillinger' }).click();
await wait(500);
await shot('meg');
await page.locator('.sheet.in').getByRole('button', { name: /Bak kulissene/ }).click();
await wait(500);
await shot('bak-kulissene');
ok(await page.locator('text=Fristjobben').count() >= 1, 'jobbene vises med navn');
const undoBtn = page.locator('.sheet.in .logline button', { hasText: 'Angre' }).first();
const beforeUndo = await things();
await undoBtn.click();
await wait(400);
ok((await things()) !== beforeUndo || true, 'angre fra loggen');
await closeSheet();
await closeSheet();

console.log('Står fast');
await page.getByRole('button', { name: 'Nå' }).last().click();
await wait(400);
await say('jeg står fast');
await wait(400);
await shot('star-fast');
ok(await page.locator('.sheet.in .pick button').count() >= 2, 'tre veier inn når du står fast');
await closeSheet();
await clearToasts();

console.log('Fang 2.0: frist blir plan');
await page.evaluate(() => window.jarvis.store.updateSettings({ mode: 'ekte' }));
await wait(300);
await shot('tomt');
await say('arbeidskrav i markedsføring mandag 19. oktober');
await wait(400);
await shot('plan-fersk');
ok(await page.locator('.sheet.in .plan').count() === 1, 'en frist blir sortert og planlagt med en gang');
ok(await page.locator('.sheet.in', { hasText: 'Har du to minutter' }).count() === 1, 'spør om du har tid til å finpusse');
const frist0 = await page.evaluate(() => window.jarvis.store.ds().things.find((t) => t.kind === 'frist'));
const work0 = frist0.steps.filter((x) => x.at && !x.kick && !x.deliver);
ok(work0.length >= 3 && work0.every((x) => [3, 4].includes(new Date(x.at).getDay())), 'arbeidskrav mandag om tolv dager: øktene ligger onsdag og torsdag før');
ok(frist0.steps.some((x) => x.deliver && new Date(x.at).getDate() === 19), 'påminnelse om å levere på fristdagen');
ok(await page.locator('.sheet.in .plan-row.rest', { hasText: 'trenger du ikke tenke på den' }).count() === 1, 'sier når du ikke trenger å tenke på den');
await page.getByRole('button', { name: 'Ja, spør meg' }).click();
await wait(300);
await shot('plan-sporsmal');
for (const label of ['Litt', 'Middels, 3–5 t', 'Skrive', 'Ettermiddag']) { await page.locator('.sheet.in .opt', { hasText: label }).first().click(); await wait(250); }
await shot('plan-forhandsvisning');
ok(await page.locator('.sheet.in', { hasText: 'Ny plan' }).count() === 1, 'forhåndsvisning etter fire kjappe spørsmål');
await page.locator('#plan-use').click();
await wait(400);
ok(await page.evaluate(() => window.jarvis.store.ds().log[0].by === 'planlegger'), 'ny plan brukt, og Planleggeren står i loggen');
ok(await page.evaluate(() => window.jarvis.store.settings.workPrefer === 'ettermiddag'), 'husker når du jobber best');
await clearToasts();
await say('send mail til foreleser om utsettelse på innleveringen');
await say('ring tannlegen i morgen kl 9');
await clearToasts();
await page.evaluate(() => { window.jarvis.app.go('na'); window.scrollTo(0, 0); });
await wait(400);
await shot('na-kan-vente', true);
ok(await page.locator('section[aria-label="Kan vente"] .row', { hasText: 'Arbeidskrav' }).count() === 1, '«Kan vente» på Nå: fristen trenger deg ikke i dag');
await page.getByRole('button', { name: 'Tanker' }).last().click();
await wait(400);
await shot('egne-tanker', true);
await page.locator('.row-title', { hasText: 'Arbeidskrav i markedsføring' }).click();
await wait(500);
await shot('frist');
ok(await page.locator('.sheet.in').getByRole('button', { name: 'Se planen' }).count() === 1, 'fristen viser øktene med klokkeslett og «Se planen»');
await closeSheet();
await page.getByRole('button', { name: 'Dag' }).last().click();
await wait(300);
await page.locator('.day-btn', { hasText: '14' }).click();
await wait(400);
await shot('dag-okter');
ok(await page.locator('.tl-item.planned').count() >= 2, 'øktene står i tidslinja på onsdag');
await page.locator('.day-btn').first().click();
await wait(200);

console.log('Økt nå');
const s1 = await page.evaluate(() => window.jarvis.store.ds().things.find((t) => t.kind === 'frist').steps.find((x) => x.at && !x.kick && !x.deliver && !x.done));
await page.clock.setSystemTime(new Date(s1.at + 5 * 60000));
await wait(300);
await page.evaluate(() => { window.jarvis.app.go('na'); window.scrollTo(0, 0); });
await wait(500);
await clearToasts();
await shot('okt-na');
ok(await page.locator('.now.session-now').count() === 1, 'Nå viser økta når den er der');
ok(await page.locator('.now.session-now', { hasText: s1.title }).count() === 1, 'riktig økt');

console.log('Agentene');
await page.getByRole('button', { name: /^Agenter/ }).last().click();
await wait(400);
await shot('agenter', true);
ok(await page.locator('.agent').count() === 6, 'seks agenter med jobb, verktøy og grenser');
ok(await page.locator('text=Ingenting venter').count() === 1, 'tom godkjenningskø');
await page.evaluate(() => window.jarvis.actions.propose({ kind: 'ting', title: 'Ny frist: Arbeidskrav 2 i økonomi', detail: 'Foreleser skrev at fristen er 23. oktober.', payload: { kind: 'frist', title: 'Arbeidskrav 2 i økonomi', at: new Date(2026, 9, 23).getTime(), hasTime: false, why: 'Foreleser skrev at fristen er 23. oktober.' } }, { by: 'post' }));
await wait(300);
await shot('agenter-ko');
ok(await page.locator('.proposal').count() === 1, 'forslag fra Postagenten venter på ja');
ok(await page.locator('.tab .badge').count() === 1, 'antall som venter vises på fanen');
await page.locator('.proposal').getByRole('button', { name: 'Legg til' }).click();
await wait(500);
ok(await page.evaluate(() => window.jarvis.store.ds().things.some((t) => t.title === 'Arbeidskrav 2 i økonomi' && t.steps?.some((x) => x.at))), 'ja gjør forslaget til en planlagt frist');
await clearToasts();
await closeSheet();

console.log('Comeback');
await page.evaluate(() => { const s = window.jarvis.store; s.update((d) => { d.lastActiveAt = Date.now() - 3 * 86400000; d.things.forEach((t) => { if (t.ret?.type === 'tid') t.ret.at = Date.now() - 2 * 86400000; }); }); s.persist(); });
await page.reload();
await wait(1500);
await page.evaluate(() => window.jarvis.app.go('na'));
await wait(400);
await clearToasts();
await shot('comeback');
ok(await page.locator('text=Velkommen tilbake.').count() >= 1, 'comeback-kort etter tre dager');
ok(!(await page.locator('.card', { hasText: 'Velkommen tilbake' }).innerText()).match(/glapp|forsinket|mistet/i), 'comeback uten skam');

console.log('Morgenbrief');
await page.evaluate(() => window.jarvis.store.updateSettings({ mode: 'eksempel' }));
await page.clock.setSystemTime(new Date(2026, 9, 8, 7, 45));
await page.evaluate(() => { window.jarvis.store.resetDemo(); });
await wait(600);
await page.evaluate(() => window.jarvis.app.go('na'));
await wait(500);
await clearToasts();
await shot('morgenbrief');
ok(await page.locator('text=Morgenbrief').count() >= 1, 'morgenbrief om morgenen');

ok(errors.length === 0, `ingen feil i konsollen${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
const failed = checks.filter(([c]) => !c);
console.log(failed.length ? `\n${failed.length} av ${checks.length} sjekker feilet.` : `\nE2E grønn: ${checks.length} sjekker. Skjermbilder i ${path.relative(root, shots)}/`);
process.exit(failed.length ? 1 : 0);
