#!/usr/bin/env node
// Cut a one-scene asset pack into one file per prop.
//
//   node tools/split-gltf.mjs --in pack/scene.gltf --out /tmp/props
//   node tools/split-gltf.mjs --in pack/scene.gltf --out /tmp/props --list
//
// Packs ship as a single scene with everything laid out in it — the Sketchfab
// gym pack is 57 props in one glTF sharing one material. The game loads props
// one at a time by name, so they have to come apart first, and doing that by
// hand in Blender 57 times is not a plan.
//
// PRESERVING THE TRANSFORM is the whole difficulty. An FBX that came through
// Sketchfab sits under a chain of parents carrying the Z-up-to-Y-up rotation
// and a centimetres-to-metres scale. Lift a prop out of that chain and it
// arrives on its side at a hundred times the size. So this does not extract the
// prop — it deletes its SIBLINGS and keeps every ancestor, which leaves the
// world transform exactly as the pack author left it.
import { NodeIO } from '@gltf-transform/core';
import { prune, dedup } from '@gltf-transform/functions';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const IN = flag('in');
const OUT = flag('out');
const LIST = args.includes('--list');
const KEEP_TEX = args.includes('--keep-textures');

/** Names that are scaffolding rather than props. */
const SCAFFOLD = /^(sketchfab_model|rootnode|.*\.fbx|scene)$/i;

const io = new NodeIO();

/**
 * Parents, worked out by walking down from the scene rather than asked for.
 *
 * The first version used the node's own parent accessor and every ancestor
 * chain came back empty, so the keep-set was one node, the scene's only child
 * was not in it, and the whole tree — target included — was deleted. Every
 * prop came out a valid glTF containing nothing: 436 bytes and zero vertices.
 * Deriving the map from the traversal cannot disagree with the traversal.
 */
function parentMap(scene) {
  const parent = new Map();
  const walk = (n) => {
    for (const c of n.listChildren()) { parent.set(c, n); walk(c); }
  };
  for (const c of scene.listChildren()) { parent.set(c, null); walk(c); }
  return parent;
}

async function main() {
  if (!IN) {
    console.log('node tools/split-gltf.mjs --in <scene.gltf|.glb> --out <dir> [--list]');
    process.exit(1);
  }
  const doc = await io.read(IN);
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];

  // A prop is a node with geometry somewhere under it whose name is not
  // scaffolding, taken as high up the tree as possible so a prop made of
  // several meshes stays one prop.
  const props = [];
  const seen = new Set();
  const visit = (node) => {
    const name = node.getName() || '';
    let hasMesh = false;
    const scan = (n) => {
      if (n.getMesh && n.getMesh()) hasMesh = true;
      for (const c of n.listChildren()) scan(c);
    };
    scan(node);
    if (hasMesh && !SCAFFOLD.test(name) && name) {
      if (!seen.has(name)) { seen.add(name); props.push({ name, node }); }
      return;                                   // do not descend into a claimed prop
    }
    for (const c of node.listChildren()) visit(c);
  };
  for (const c of scene.listChildren()) visit(c);

  console.log(`${props.length} prop(s) in ${IN}`);
  if (LIST) { for (const p of props) console.log('  ' + p.name); return; }
  if (!OUT) { console.log('give --out <dir> to write them'); process.exit(1); }
  await mkdir(OUT, { recursive: true });

  let done = 0;
  let bytes = 0;
  for (const { name } of props) {
    // Fresh read per prop. Mutating one document and undoing it is how you end
    // up shipping prop 40 with prop 39 still inside it.
    const d = await io.read(IN);
    const sc = d.getRoot().getDefaultScene() || d.getRoot().listScenes()[0];
    let target = null;
    for (const n of d.getRoot().listNodes()) if (n.getName() === name) { target = n; break; }
    if (!target) { console.log(`  --  ${name}: vanished on re-read`); continue; }

    const parent = parentMap(sc);
    const keep = new Set();
    for (let n = target; n; n = parent.get(n) ?? null) keep.add(n);
    // Detach anything that is neither an ancestor nor part of this prop.
    //
    // Stopping AT the target matters: the mesh does not hang on the prop node,
    // it hangs on a child of it (treadmill -> treadmill_gym_environment_0).
    // Keeping only the ancestor chain therefore kept the prop and deleted its
    // geometry, and every file came out a valid glTF containing nothing.
    const drop = [];
    const walk = (n) => {
      if (n === target) return;                 // the whole prop stays
      if (keep.has(n)) { for (const c of n.listChildren()) walk(c); return; }
      drop.push(n);                             // whole subtree goes
    };
    for (const c of sc.listChildren()) walk(c);
    for (const n of drop) n.dispose();

    // Drop the atlas unless asked to keep it. The pack shares one 2MB texture
    // between all 57 props, so embedding it in each of them turns a 2.8MB pack
    // into 105MB of output — and normalise() in the game rebuilds every
    // material as flat toon on load, so the map is deleted the moment it
    // arrives anyway. Paying 2MB per prop to throw it away is the worst of
    // both.
    if (!KEEP_TEX) for (const t of d.getRoot().listTextures()) t.dispose();
    await d.transform(prune(), dedup());
    const glb = await io.writeBinary(d);
    const file = join(OUT, `${name}.glb`);
    await writeFile(file, glb);
    bytes += glb.byteLength;
    done++;
    process.stdout.write(`\r  ${done}/${props.length}  ${name.padEnd(24)}`);
  }
  console.log(`\n\nwrote ${done} file(s) to ${OUT} (${(bytes / 1e6).toFixed(1)}MB total)`);
  console.log('now:  node tools/ingest-props.mjs --from ' + OUT + ' --dry');
}

await main();
