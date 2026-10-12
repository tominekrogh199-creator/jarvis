// Kjerne · «gjør den mindre» og første lille steg. Konkret, fysisk og under fem minutter.
import { detectWorkType } from './due.js';

const FIRST = {
  lesing: 'Åpne teksten på første side og les bare overskriftene.',
  skriving: 'Åpne dokumentet og skriv tre stikkord. Ikke setninger ennå.',
  epost: 'Skriv bare første setning. Resten kan komme etterpå.',
  samtale: 'Finn nummeret og skriv ned den ene tingen du vil si.',
  annet: 'Gjør det aller første fysiske grepet, og stopp etter fem minutter hvis du vil.',
};

/** Første lille steg for en ting. */
export function firstSmallStep(thing) {
  if (thing?.firstStep) return thing.firstStep;
  if (thing?.kind === 'melding' || thing?.kind === 'epost') return 'Les utkastet én gang og endre det som ikke stemmer.';
  if (thing?.kind === 'handle') return 'Skriv det på handlelappen, så tar du det neste gang du er der.';
  const type = thing?.workType || detectWorkType(thing?.title || '');
  return FIRST[type] || FIRST.annet;
}

/** «Gjør den mindre»: et steg for en frist deles i to; en oppgave får et første steg på 5–10 minutter. */
export function makeSmaller(thing, stepId = null, newId = () => `s${Date.now().toString(36)}`) {
  if (thing.kind === 'frist' && thing.steps?.length) {
    const i = thing.steps.findIndex((s) => s.id === stepId) >= 0 ? thing.steps.findIndex((s) => s.id === stepId) : thing.steps.findIndex((s) => !s.done && !s.deliver);
    if (i < 0) return null;
    const s = thing.steps[i];
    const half = Math.max(5, Math.round((s.estimateMin || 30) / 2));
    const a = { ...s, title: `Første del: ${s.title.charAt(0).toLocaleLowerCase('nb')}${s.title.slice(1)}`, estimateMin: half };
    const b = { ...s, id: newId(), title: `Resten: ${s.title.charAt(0).toLocaleLowerCase('nb')}${s.title.slice(1)}`, estimateMin: half };
    // Planlagte økter deles i samme tidsrom: først en kort del, så resten rett etter.
    if (s.at) { a.end = s.at + half * 60000; b.at = a.end; b.end = Math.max(s.end || 0, b.at + half * 60000); }
    const steps = [...thing.steps.slice(0, i), a, b, ...thing.steps.slice(i + 1)];
    return { patch: { steps }, text: `Delte «${s.title}» i to mindre steg på ${half} minutter.` };
  }
  const step = firstSmallStep({ ...thing, firstStep: null });
  return { patch: { firstStep: step, estimateMin: Math.min(thing.estimateMin || 30, 10), suggestSmaller: false }, text: `Første steg er nå: ${step}` };
}
