// Bygger Jarvis til én selvstendig HTML-fil uten avhengigheter.
// 1) Pakker ES-modulene fra app/main.js til ett klassisk skript (enkel modulregistrering)
// 2) Skriver dist/jarvis.html (hele dokumentet) og dist/jarvis-artifact.html (innhold for claude.ai-artifact)
// Instruksene til Jarvis bygges i app/ai/brain.js (rulesText), fordi de tar med navn, stil og stab.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => path.relative(root, p).split(path.sep).join('/');

// ---------- 1. Pakking ----------
function transform(code, file) {
  const id = rel(file);
  const deps = [];
  const names = [];
  code = code.replace(/^import\s+(\{[\s\S]*?\}|\*\s+as\s+([A-Za-z_$][\w$]*))\s+from\s+['"](.+?)['"];?[ \t]*$/gm, (m, what, ns, spec) => {
    const dep = rel(path.resolve(path.dirname(file), spec));
    deps.push(path.join(root, dep));
    if (ns) return `const ${ns} = __req(${JSON.stringify(dep)});`;
    const inner = what.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean)
      .map((s) => { const [a, b] = s.split(/\s+as\s+/); return b ? `${a}: ${b}` : a; }).join(', ');
    return `const { ${inner} } = __req(${JSON.stringify(dep)});`;
  });
  code = code.replace(/^export\s+(async\s+function\*?|function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm, (m, kw, name) => {
    names.push(name);
    return `${kw} ${name}`;
  });
  code = code.replace(/^export\s*\{([^}]*)\};?[ \t]*$/gm, (m, list) => {
    list.split(',').map((s) => s.trim()).filter(Boolean).forEach((n) => {
      if (/\s+as\s+/.test(n)) throw new Error(`«export { a as b }» støttes ikke i ${id}`);
      names.push(n);
    });
    return '';
  });
  if (/^\s*export\s/m.test(code)) throw new Error(`Ustøttet export-form i ${id}`);
  if (/^\s*import\s/m.test(code)) throw new Error(`Ustøttet import-form i ${id}`);
  const props = names.map((n) => `${JSON.stringify(n)}: { get: () => ${n}, enumerable: true }`).join(',\n    ');
  const body = `__def(${JSON.stringify(id)}, function (__req) {\n${code}\n  return Object.defineProperties({}, {\n    ${props}\n  });\n});`;
  return { id, deps, body };
}

export function bundle(entry) {
  const seen = new Map();
  const order = [];
  const visit = (file) => {
    const key = path.resolve(file);
    if (seen.has(key)) return;
    seen.set(key, true);
    const t = transform(fs.readFileSync(key, 'utf8'), key);
    t.deps.forEach(visit);
    order.push(t);
  };
  visit(entry);
  const runtime = `(function () {
'use strict';
var __mods = {}, __cache = {};
function __def(id, fn) { __mods[id] = fn; }
function __req(id) {
  if (Object.prototype.hasOwnProperty.call(__cache, id)) {
    if (__cache[id] === null) throw new Error('Sirkulær import: ' + id);
    return __cache[id];
  }
  if (!__mods[id]) throw new Error('Fant ikke modul: ' + id);
  __cache[id] = null;
  var e = __mods[id](__req);
  __cache[id] = e;
  return e;
}
${order.map((o) => o.body).join('\n\n')}
__req(${JSON.stringify(rel(entry))});
})();`;
  return { code: runtime, modules: order.map((o) => o.id) };
}

// ---------- 2. HTML ----------
function build() {
  const { code, modules } = bundle(path.join(root, 'app', 'main.js'));
  const css = fs.readFileSync(path.join(root, 'app', 'styles.css'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'app', 'index.html'), 'utf8');
  const safeJs = code.replace(/<\/script/gi, '<\\/script');
  const style = `<style>\n${css}\n</style>`;
  const script = `<script>\n${safeJs}\n</script>`;

  const full = html
    .replace(/<link rel="stylesheet" href="\.\/styles\.css">/, () => style)
    .replace(/<script type="module" src="\.\/main\.js"><\/script>/, () => script)
    .replace(/<script src="\.\/secrets\.local\.js"[^>]*><\/script>\s*/, '');
  if (full.includes('src="./main.js"') || full.includes('href="./styles.css"')) throw new Error('Fant ikke plassholderne i index.html');

  // Artifact-versjonen: ingen doctype/html/head/body. Tittel og stil først.
  const title = (html.match(/<title>[\s\S]*?<\/title>/) || ['<title>Jarvis</title>'])[0];
  const fonts = (html.match(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/g) || []).join('\n');
  const bodyInner = full.match(/<body[^>]*>([\s\S]*)<\/body>/)[1];
  const artifact = `${title}\n${fonts}\n${style}\n${bodyInner.replace(style, '')}`;

  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist', 'jarvis.html'), full);
  fs.writeFileSync(path.join(root, 'dist', 'jarvis-artifact.html'), artifact);
  const kb = (s) => `${Math.round(Buffer.byteLength(s) / 1024)} KB`;
  console.log(`Bygget ${modules.length} moduler.`);
  console.log(`dist/jarvis.html (${kb(full)}) og dist/jarvis-artifact.html (${kb(artifact)})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) build();
