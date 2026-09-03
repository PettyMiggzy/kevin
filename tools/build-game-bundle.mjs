#!/usr/bin/env node
// Bundle the gym into one self-contained HTML file.
//
//   node tools/build-game-bundle.mjs        -> dist/kevin-gym.html
//
// Everything inlined: three.js, the addons, the twelve props as base64, the
// crew grids. No network at all once it has loaded, so it works from a file://
// path, an email attachment, or a host that will not serve .glb.
//
// Modules are stitched together with blob URLs and an import map rather than by
// concatenating sources. Concatenation looks simpler and then breaks the first
// time two files declare the same name; blob URLs keep every module in its own
// scope, exactly as the browser would.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist');

const MODULES = {
  three: 'game/vendor/three.module.js',
  'three/addons/utils/BufferGeometryUtils.js': 'game/vendor/addons/utils/BufferGeometryUtils.js',
  'three/addons/loaders/GLTFLoader.js': 'game/vendor/addons/loaders/GLTFLoader.js',
  'three/addons/libs/meshopt_decoder.module.js': 'game/vendor/addons/libs/meshopt_decoder.module.js',
  'three/addons/effects/OutlineEffect.js': 'game/vendor/addons/effects/OutlineEffect.js',
  'kevin/save.js': 'game/js/save.js',
  'kevin/voxel.js': 'game/js/voxel.js',
  'kevin/main.js': 'game/js/main.js',
};

/**
 * A tiny module registry, because the two obvious approaches both fail.
 *
 * Blob URLs plus an import map work locally but need blob: in script-src, and
 * a hosted page under a strict Content-Security-Policy can refuse it. Plain
 * concatenation needs no blob: and then dies on the first name two files share
 * — three.module.js and BufferGeometryUtils both declare _identityMatrix.
 *
 * So each module keeps its own scope inside an IIFE, publishes what it exports
 * into __m, and has its imports rewritten to read back out of __m. One inline
 * module script, nothing for a CSP to block, and no shared namespace to collide
 * in. Order in MODULES is load-bearing: a module must be listed after anything
 * it imports.
 */
function wrap(src, spec) {
  const exports = new Set();

  // Registry keys are the bare specifiers in MODULES, but a module refers to
  // its neighbours relatively — GLTFLoader reaches for
  // '../utils/BufferGeometryUtils.js'. Resolve those against the importer's own
  // path first, or the lookup misses and the import comes back undefined.
  const dir = spec.includes('/') ? spec.slice(0, spec.lastIndexOf('/')) : '';
  src = src.replace(/(['"])(\.\.?\/[^'"]+)\1/g, (m, q, rel) => {
    const parts = dir.split('/').filter(Boolean);
    for (const seg of rel.split('/')) {
      if (seg === '.' || seg === '') continue;
      if (seg === '..') parts.pop();
      else parts.push(seg);
    }
    return JSON.stringify(parts.join('/'));
  });

  let out = src
    // import { a, b as c } from 'x'  ->  const { a, b: c } = __m['x']
    .replace(/^[ \t]*import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]\s*;?/gm,
      (m, names, from) => `const {${names.replace(/\bas\b/g, ':')}} = __m[${JSON.stringify(from)}];`)
    // import * as NS from 'x'
    .replace(/^[ \t]*import\s*\*\s*as\s+(\w+)\s*from\s*['"]([^'"]+)['"]\s*;?/gm,
      (m, ns, from) => `const ${ns} = __m[${JSON.stringify(from)}];`)
    // import Default from 'x'
    .replace(/^[ \t]*import\s+(\w+)\s*from\s*['"]([^'"]+)['"]\s*;?/gm,
      (m, d, from) => `const ${d} = __m[${JSON.stringify(from)}].default;`)
    // bare side-effect import
    .replace(/^[ \t]*import\s*['"][^'"]+['"]\s*;?\s*$/gm, '');

  // export { a, b as c };
  out = out.replace(/^[ \t]*export\s*\{([^}]*)\}\s*;?/gm, (m, names) => {
    for (const part of names.split(',')) {
      const [local, exported] = part.split(/\s+as\s+/).map((x) => x.trim());
      if (local) exports.add(`${JSON.stringify(exported || local)}: ${local}`);
    }
    return '';
  });

  // export class X / function X / const X ...
  out = out.replace(/^([ \t]*)export\s+(?=(class|function|const|let|var|async)\b)/gm, (m, indent) => indent);
  for (const m of src.matchAll(/^[ \t]*export\s+(?:async\s+)?(?:class|function|const|let|var)\s+(\w+)/gm)) {
    exports.add(`${JSON.stringify(m[1])}: ${m[1]}`);
  }

  return `__m[${JSON.stringify(spec)}] = (function () {\n${out}\nreturn {${[...exports].join(', ')}};\n})();`;
}

const PROPS = [
  'bench', 'bucket', 'dumbbell-rack', 'dumbbell', 'gym-mirror', 'locker',
  'plate-tree', 'protein-tub', 'speaker', 'squat-rack', 'treadmill', 'water-cooler',
];

/**
 * A </script> anywhere inside an inlined script ends it early, whatever the
 * type. Splitting the token is the standard, boring fix.
 */
const safe = (s) => s.replace(/<\/script>/gi, '<\\/script>');

async function main() {
  await mkdir(OUT, { recursive: true });

  const sources = {};
  for (const [spec, path] of Object.entries(MODULES)) {
    sources[spec] = wrap(await readFile(join(ROOT, path), 'utf8'), spec);
  }

  // The registry is filled in order, so a module listed before something it
  // imports gets undefined at runtime and fails somewhere far away from the
  // cause. Catch it here, where the fix is obvious.
  const defined = new Set();
  for (const [spec, body] of Object.entries(sources)) {
    for (const m of body.matchAll(/__m\["([^"]+)"\]/g)) {
      if (m[1] !== spec && !defined.has(m[1])) {
        throw new Error(`${spec} imports ${m[1]}, which is not bundled yet — move it earlier in MODULES`);
      }
    }
    defined.add(spec);
  }

  const grids = JSON.parse(await readFile(join(ROOT, 'assets/crew/grids.json'), 'utf8'));

  const props = {};
  let propBytes = 0;
  for (const name of PROPS) {
    const buf = await readFile(join(ROOT, `game/assets/props/${name}.glb`));
    props[name] = buf.toString('base64');
    propBytes += buf.length;
  }

  // The shell's markup and styles, lifted straight out of the served page so
  // the two cannot drift.
  const page = await readFile(join(ROOT, 'game/index.html'), 'utf8');
  const style = page.match(/<style>([\s\S]*?)<\/style>/)[1];
  const body = page.match(/<body>([\s\S]*?)<script type="importmap">/)[1];

  const html = `<title>Kevin's Gym</title>
<meta name="description" content="I work the fryer. I also lift. Miss a day and it comes off.">
<style>${style}</style>
${body}
<script type="application/json" id="kevin-grids">${safe(JSON.stringify(grids))}</script>
<script type="application/json" id="kevin-props">${safe(JSON.stringify(props))}</script>
<script>
(function () {
  var raw = JSON.parse(document.getElementById('kevin-props').textContent);
  var props = {};
  for (var k in raw) {
    var bin = atob(raw[k]), n = bin.length, out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    props[k] = out.buffer;
  }
  window.__KEVIN_ASSETS = {
    grids: JSON.parse(document.getElementById('kevin-grids').textContent),
    props: props,
  };
})();
<\/script>
<script type="module">
var __m = {};\n${safe(Object.values(sources).join('\n'))}
<\/script>`;

  const outPath = join(OUT, 'kevin-gym.html');
  await writeFile(outPath, html);
  const size = Buffer.byteLength(html);
  console.log(
    `dist/kevin-gym.html  ${(size / 1048576).toFixed(2)}MB\n` +
    `  js (one module)  ${(Object.values(sources).reduce((n, s) => n + s.length, 0) / 1024).toFixed(0)}KB\n` +
    `  ${PROPS.length} props        ${(propBytes / 1024).toFixed(0)}KB raw, ${((propBytes * 4 / 3) / 1024).toFixed(0)}KB as base64\n` +
    `  crew grids       ${(JSON.stringify(grids).length / 1024).toFixed(0)}KB`
  );
}

await main();
