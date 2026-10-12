// Himmelen følger klokka: lys morgen, blek dag, varm ettermiddag, blå time om kvelden.
// Tiden blir noe du ser rundt deg, ikke bare et tall.
const LIGHT = [
  [0, '#d9dbeb', '#ecedf4', 'rgba(160,170,230,0.35)'],
  [5.5, '#f1dcd0', '#efeaf2', 'rgba(255,190,150,0.55)'],
  [8, '#dbe7f6', '#f5f1ea', 'rgba(255,214,160,0.6)'],
  [12, '#d6e5f7', '#f0f3fa', 'rgba(255,236,190,0.5)'],
  [16, '#e2e3f5', '#f6eee6', 'rgba(255,200,150,0.55)'],
  [19, '#e5d9ee', '#f3e9eb', 'rgba(255,160,140,0.45)'],
  [21.5, '#d2d8f0', '#e8ebf5', 'rgba(150,160,240,0.42)'],
  [24, '#d9dbeb', '#ecedf4', 'rgba(160,170,230,0.35)'],
];
const DARK = [
  [0, '#0b0e1c', '#0f121e', 'rgba(90,100,210,0.26)'],
  [5.5, '#1c1622', '#11131c', 'rgba(220,130,110,0.24)'],
  [8, '#121a2a', '#0f131c', 'rgba(230,170,110,0.2)'],
  [12, '#111a2b', '#0f131d', 'rgba(160,190,255,0.18)'],
  [16, '#161828', '#11131c', 'rgba(240,170,120,0.2)'],
  [19, '#1b1528', '#11121b', 'rgba(230,120,140,0.24)'],
  [21.5, '#0f1430', '#0d1020', 'rgba(110,120,255,0.28)'],
  [24, '#0b0e1c', '#0f121e', 'rgba(90,100,210,0.26)'],
];

function hex(c) { return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)); }
function rgba(c) { return c.match(/[\d.]+/g).map(Number); }
function mix(a, b, f) { return a.map((x, i) => x + (b[i] - x) * f); }

export function skyAt(date, dark) {
  const tbl = dark ? DARK : LIGHT;
  const hr = date.getHours() + date.getMinutes() / 60;
  let i = 0;
  while (i < tbl.length - 2 && tbl[i + 1][0] <= hr) i++;
  const [h0, a0, b0, g0] = tbl[i];
  const [h1, a1, b1, g1] = tbl[i + 1];
  const f = Math.max(0, Math.min(1, (hr - h0) / (h1 - h0 || 1)));
  const a = mix(hex(a0), hex(a1), f).map(Math.round);
  const b = mix(hex(b0), hex(b1), f).map(Math.round);
  const g = mix(rgba(g0), rgba(g1), f);
  const sun = Math.max(8, Math.min(92, ((hr - 6) / 15) * 84 + 8));
  return { a: `rgb(${a.join(',')})`, b: `rgb(${b.join(',')})`, glow: `rgba(${g.slice(0, 3).map(Math.round).join(',')},${g[3].toFixed(2)})`, sun: `${sun.toFixed(1)}%` };
}

export function isDark() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches || false;
}

export function paintSky(date, mode = 'levende') {
  const root = document.documentElement;
  const dark = isDark();
  root.toggleAttribute('data-dark', dark);
  if (mode === 'av') { for (const k of ['--sky-a', '--sky-b', '--sky-glow', '--sun-x']) root.style.removeProperty(k); return; }
  const s = skyAt(mode === 'rolig' ? new Date(2026, 0, 1, 12) : date, dark);
  root.style.setProperty('--sky-a', s.a);
  root.style.setProperty('--sky-b', s.b);
  root.style.setProperty('--sky-glow', s.glow);
  root.style.setProperty('--sun-x', s.sun);
}
