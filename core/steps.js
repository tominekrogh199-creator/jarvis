// Kjerne · frist til steg: «et steg om dagen» fram mot fristen, og omfordeling uten kjeft når en dag glipper.
import { DAY, HOUR, startOfDay, addDays } from './time.js';

const TEMPLATES = [
  {
    id: 'eksamen', re: /eksamen|midtveis|(?<![\p{L}])(prøve|test|quiz)(en)?\s+(i|på)\s+\p{L}|^(prøve|test|quiz)(en)?(?![\p{L}])(?!\s+(kjole|klær|sko))/iu, prepOnly: true,
    steps: [['Lag oversikt over pensum og del det i biter', 30], ['Gå gjennom første del av pensum', 50], ['Gå gjennom andre del av pensum', 50], ['Gå gjennom tredje del av pensum', 50], ['Løs en gammel eksamensoppgave', 90], ['Repeter det du er mest usikker på', 45], ['Pakk sekken og legg deg tidlig', 10]],
  },
  {
    id: 'presentasjon', re: /presentasjon|pitch|framføring|fremføring|foredrag/i,
    steps: [['Skriv ned hovedbudskapet i én setning', 15], ['Lag en grov disposisjon', 30], ['Lag lysbildene, de kan være stygge', 60], ['Øv høyt én gang med tidtaker', 25], ['Finpuss og øv igjen', 30]],
  },
  {
    id: 'soknad', re: /søknad|søke|sommerjobb|internship|praksisplass/i,
    steps: [['Les utlysningen og noter tre krav', 15], ['Oppdater CV-en', 45], ['Skriv første utkast av søknaden', 50], ['Be noen lese over', 10], ['Send søknaden', 10]],
  },
  {
    id: 'innlevering', re: /innlever|arbeidskrav|oppgave|essay|rapport|bachelor|semesteroppgave|refleksjonsnotat|levere|leveres|deadline|frist/i,
    steps: [['Les oppgaveteksten og lag disposisjon', 30], ['Finn tre kilder du kan bruke', 45], ['Skriv første utkast, det får være dårlig', 90], ['Les over og stram inn', 45], ['Sjekk kravene og lever', 15]],
  },
];

const GENERIC = {
  id: 'generelt',
  steps: [['Bestem hva «ferdig» betyr', 10], ['Samle det du trenger', 20], ['Gjør første halvdel', 45], ['Gjør resten', 45], ['Sjekk og avslutt', 15]],
};

let seq = 0;
const sid = () => `s${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Siste dag det går an å jobbe med fristen. `due` er eksklusiv («innen fredag» = lørdag 00:00). */
export function lastWorkDay(due, template = null) {
  const d = startOfDay(due - 1);
  return template?.prepOnly ? addDays(d, -1) : d;
}

/** Første dag steg kan legges: i dag hvis det er tidlig nok, ellers i morgen. */
function firstDay(now) {
  const today = startOfDay(now);
  return now - today < 15 * HOUR ? today : addDays(today, 1);
}

/** Fordeler n steg på dagene fra `from` til `to` (begge med), i rekkefølge og så jevnt som mulig. */
export function spread(n, from, to) {
  const days = Math.max(1, Math.round((startOfDay(to) - startOfDay(from)) / DAY) + 1);
  return Array.from({ length: n }, (_, i) => addDays(startOfDay(from), Math.min(days - 1, Math.floor((i * days) / n))));
}

export function templateFor(title) {
  return TEMPLATES.find((t) => t.re.test(title)) || GENERIC;
}

/**
 * Deler en frist i steg, ett om dagen så langt det går. Returnerer {template, steps, tight}.
 * tight = flere steg enn dager igjen.
 */
export function planSteps(title, due, now) {
  const t = templateFor(title);
  const from = firstDay(now);
  let to = lastWorkDay(due, t);
  if (to < from) to = from;
  const days = Math.round((to - from) / DAY) + 1;
  const list = t.steps;
  const dayOf = spread(list.length, from, to);
  return {
    template: t.id,
    tight: days < list.length,
    spacing: Math.max(1, Math.floor(days / list.length)),
    steps: list.map(([stepTitle, estimateMin], i) => ({ id: sid(), title: stepTitle, estimateMin, day: dayOf[i], done: false })),
  };
}

/**
 * Fristjobben: steg som skulle vært gjort før i dag, fordeles på nytt fra i dag.
 * Rører ikke ferdige steg. Returnerer {steps, moved, tight}.
 */
export function replanSteps(steps, due, now, templateId = null) {
  const today = startOfDay(now);
  const open = steps.filter((s) => !s.done);
  const late = open.filter((s) => s.day < today);
  if (!late.length) return { steps, moved: 0, tight: false };
  const t = TEMPLATES.find((x) => x.id === templateId) || null;
  let to = lastWorkDay(due, t);
  if (to < today) to = today;
  const days = spread(open.length, today, to);
  const byId = new Map(open.map((s, i) => [s.id, days[i]]));
  const out = steps.map((s) => (byId.has(s.id) ? { ...s, day: Math.max(byId.get(s.id), s.day >= today ? s.day : 0) } : s));
  // Behold rekkefølgen: ingen steg før et tidligere steg.
  let prev = 0;
  for (const s of out) {
    if (s.done) continue;
    if (s.day < prev) s.day = prev;
    prev = s.day;
  }
  const daysLeft = Math.round((to - today) / DAY) + 1;
  return { steps: out, moved: late.length, tight: open.length > daysLeft };
}

/** Neste steg som ikke er gjort. En kikk som har gått forbi, hoppes over (den er frivillig). */
export function nextStep(thing, now = null) {
  return (thing.steps || []).find((s) => !s.done && !(now && s.kick && s.end && s.end < now)) || null;
}
