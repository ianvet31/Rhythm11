/**
 * Build — inline the whole game into one self-contained .html file.
 *
 * Why bother, when the source already runs in a browser?
 *
 * ES modules can't load over `file://` (the origin is opaque, so the fetch is
 * blocked). That means the source tree needs a local server to run at all, which
 * is a real barrier for "just let someone try it". The bundled build has no
 * imports, no fetches, and no assets — the music is synthesized and the art is
 * drawn — so the output is a single file you can double-click, email, or drop on
 * any static host.
 *
 * It is a ~150-line module concatenator rather than a real bundler, which is
 * possible only because this codebase sticks to a small subset of module syntax
 * (no dynamic import, no re-export, no circular dependencies). The parser below
 * asserts that assumption instead of silently mis-compiling if it's ever broken.
 *
 * Run: node tools/build.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = 'src/main.js';

/* ── Module graph ──────────────────────────────────────────────────────────── */

const modules = new Map();   // id -> { code, deps }

function resolve(fromId, spec) {
  if (!spec.startsWith('.')) throw new Error(`bare import "${spec}" in ${fromId} — not supported`);
  return posix.normalize(posix.join(posix.dirname(fromId), spec));
}

const IMPORT_RE = /^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?\s*$/gm;
const SIDE_EFFECT_IMPORT_RE = /^import\s+['"]([^'"]+)['"];?\s*$/gm;

function load(id) {
  if (modules.has(id)) return;
  let code;
  try { code = readFileSync(join(ROOT, id), 'utf8'); }
  catch { throw new Error(`cannot resolve module: ${id}`); }

  // Run the "unsupported syntax" checks against a comment-stripped copy. The
  // codebase is full of JSDoc types like {import('./view.js').View}, which are
  // documentation, not dynamic imports.
  const bare = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  if (/\bimport\s*\(/.test(bare)) throw new Error(`${id}: dynamic import() is not supported by this bundler`);
  if (/^export\s+\{[^}]*\}\s+from/m.test(bare)) throw new Error(`${id}: re-export is not supported by this bundler`);

  const deps = [];
  const exportNames = new Set();
  let hasDefault = false;

  // ── imports → __req() ────────────────────────────────────────────────────
  code = code.replace(SIDE_EFFECT_IMPORT_RE, (_m, spec) => {
    const dep = resolve(id, spec);
    deps.push(dep);
    return `__req(${JSON.stringify(dep)});`;
  });

  code = code.replace(IMPORT_RE, (_m, clause, spec) => {
    const dep = resolve(id, spec);
    deps.push(dep);
    const req = `__req(${JSON.stringify(dep)})`;
    clause = clause.trim();

    // import * as NS from '…'
    let m = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/.exec(clause);
    if (m) return `const ${m[1]} = ${req};`;

    // import Default, { a, b } from '…'   /   import Default from '…'
    m = /^([A-Za-z_$][\w$]*)\s*(?:,\s*\{([\s\S]*)\})?$/.exec(clause);
    if (m) {
      const out = [`const ${m[1]} = ${req}.default;`];
      if (m[2]) out.push(`const {${named(m[2])}} = ${req};`);
      return out.join('\n');
    }

    // import { a, b as c } from '…'
    m = /^\{([\s\S]*)\}$/.exec(clause);
    if (m) return `const {${named(m[1])}} = ${req};`;

    throw new Error(`${id}: unsupported import clause "${clause}"`);
  });

  // ── exports → record the name, strip the keyword ─────────────────────────
  code = code.replace(/^export\s+default\s+/gm, () => {
    hasDefault = true;
    return 'const __default = ';
  });

  code = code.replace(
    /^export\s+(async\s+)?(function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
    (_m, asyncKw = '', kind, name) => {
      exportNames.add(name);
      return `${asyncKw}${kind} ${name}`;
    },
  );

  // export { a, b as c };
  code = code.replace(/^export\s+\{([^}]*)\};?\s*$/gm, (_m, list) => {
    for (const part of list.split(',')) {
      const [local, exported] = part.split(/\s+as\s+/).map((s) => s.trim());
      if (local) exportNames.add(exported || local);
    }
    return '';
  });

  if (/^export\s/m.test(code)) {
    throw new Error(`${id}: leftover export syntax the bundler does not understand`);
  }

  const tail = [
    ...[...exportNames].map((n) => `__x.${n} = ${n};`),
    ...(hasDefault ? ['__x.default = __default;'] : []),
  ].join('\n');

  modules.set(id, { code: `${code}\n${tail}\n` });
  for (const d of deps) load(d);
}

function named(list) {
  return list.split(',').map((s) => s.trim()).filter(Boolean)
    .map((s) => {
      const m = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(s);
      return m ? `${m[1]}: ${m[2]}` : s;
    }).join(', ');
}

load(ENTRY);

/* ── Emit ──────────────────────────────────────────────────────────────────── */

const css = readFileSync(join(ROOT, 'src/style.css'), 'utf8');

const runtime = `
// Minimal CommonJS-style registry, generated by tools/build.mjs.
// Modules execute lazily on first require, in dependency order.
const __defs = Object.create(null);
const __cache = Object.create(null);
function __def(id, fn) { __defs[id] = fn; }
function __req(id) {
  if (id in __cache) return __cache[id];
  const fn = __defs[id];
  if (!fn) throw new Error('module not bundled: ' + id);
  const __x = __cache[id] = {};
  fn(__x, __req);
  return __x;
}
`;

const body = [...modules.entries()]
  .map(([id, m]) => `__def(${JSON.stringify(id)}, (__x, __req) => {\n${m.code}\n});`)
  .join('\n\n');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Rhythm11</title>
<style>
${css}
</style>
</head>
<body>
  <div id="stage">
    <canvas id="game"></canvas>
    <div id="ui"></div>
  </div>
<script>
"use strict";
(function () {
${runtime}
${body}
__req(${JSON.stringify(ENTRY)});
})();
<\/script>
</body>
</html>
`;

mkdirSync(join(ROOT, 'dist'), { recursive: true });
const out = join(ROOT, 'dist', 'rhythm11.html');
writeFileSync(out, html);

const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
console.log(`built dist/rhythm11.html — ${modules.size} modules, ${kb} kB, 0 external assets`);
