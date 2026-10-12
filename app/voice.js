// Stemme. Opplesing virker i de fleste nettlesere. Tale til tekst virker når appen kjører som fil i Safari eller Chrome;
// på claude.ai er mikrofonen stengt for siden, så der skriver du.
export const voice = {
  get canSpeak() { return typeof window !== 'undefined' && 'speechSynthesis' in window; },
  get canListen() {
    if (typeof window === 'undefined' || window.claude) return false;
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  },
  speaking: false,
  rec: null,

  speak(text, { onEnd = () => {} } = {}) {
    if (!this.canSpeak) return false;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'nb-NO';
      u.rate = 1.02;
      const v = window.speechSynthesis.getVoices().find((x) => /^(nb|no|nn)/i.test(x.lang));
      if (v) u.voice = v;
      u.onend = () => { this.speaking = false; onEnd(); };
      u.onerror = () => { this.speaking = false; onEnd(); };
      this.speaking = true;
      window.speechSynthesis.speak(u);
      return true;
    } catch { return false; }
  },

  stop() {
    try { window.speechSynthesis?.cancel(); } catch { /* ingen tale */ }
    this.speaking = false;
  },

  listen({ onText, onEnd }) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return false;
    try {
      const r = new SR();
      r.lang = 'nb-NO';
      r.interimResults = true;
      r.continuous = false;
      r.onresult = (e) => onText(Array.from(e.results).map((x) => x[0].transcript).join(' '), e.results[e.results.length - 1].isFinal);
      r.onend = () => { this.rec = null; onEnd(); };
      r.onerror = () => { this.rec = null; onEnd(); };
      r.start();
      this.rec = r;
      return true;
    } catch { return false; }
  },

  stopListening() { try { this.rec?.stop(); } catch { /* ferdig */ } },
};

/** Et mykt pling (bare når lyd er slått på og etter et trykk). */
let ctx = null;
export function chime() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;
    for (const [f, d] of [[660, 0], [880, 0.12]]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.12, t + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.6);
      o.connect(g).connect(ctx.destination);
      o.start(t + d);
      o.stop(t + d + 0.7);
    }
  } catch { /* ingen lyd */ }
}
