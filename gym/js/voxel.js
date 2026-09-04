// Turn a KEVIN'S CREW avatar into a body you can walk around in.
//
// This is why the collection is a 32x32 grid rather than twenty paintings. The
// token somebody owns extrudes into the character they play — mechanically, with
// no modelling, no rigging, no skinning, no Mixamo, and no morph targets.
//
// That last part matters more than the convenience. The riskiest item in the
// whole gym plan was the character pipeline: a rig you cannot guarantee an
// auto-rigger will accept, and a muscle morph that glTF will refuse outright if
// the two meshes do not share vertex count and ordering. A voxel body assembled
// from separate parts has no rig, no skin weights and no shared-topology rule.
// The entire risk category stops existing, and "muscle" becomes group.scale.
import * as THREE from 'three';

/** Merge a run of same-coloured cells into one box rather than one box per pixel. */
function runs(grid, y) {
  const out = [];
  let x = 0;
  while (x < grid.w) {
    const c = grid.cells[y * grid.w + x];
    if (c < 0) { x++; continue; }
    let n = 1;
    while (x + n < grid.w && grid.cells[y * grid.w + x + n] === c) n++;
    out.push({ x, n, c });
    x += n;
  }
  return out;
}

/**
 * Extrude rows [y0, y1] of a grid into a solid block.
 *
 * The avatar is a portrait, so only the face is drawn. The back and sides get
 * the fill colour — one flat colour behind the head reads correctly and costs
 * nothing, and nobody is looking at the back of a 32px head anyway.
 */
export function extrude(grid, { y0, y1, depth, unit, fill, faceDepth = 2 }) {
  const geoms = [];
  const colour = new THREE.Color();
  const w = grid.w;
  const cx = (w * unit) / 2;
  const cy = (y1 - y0 + 1) * unit;

  for (let y = y0; y <= y1; y++) {
    for (const r of runs(grid, y)) {
      // The drawn pixels sit at the front; behind them is one solid slab.
      const box = new THREE.BoxGeometry(r.n * unit, unit, faceDepth * unit);
      box.translate(
        (r.x + r.n / 2) * unit - cx,
        cy - (y - y0 + 0.5) * unit,
        depth * unit * 0.5 - (faceDepth * unit) / 2
      );
      colour.set(grid.palette[r.c]);
      const c = new Float32Array(box.attributes.position.count * 3);
      for (let i = 0; i < c.length; i += 3) c.set([colour.r, colour.g, colour.b], i);
      box.setAttribute('color', new THREE.BufferAttribute(c, 3));
      geoms.push(box);
    }
  }

  // The slab behind the face, sized to the drawn silhouette so the head is not
  // a rectangle. Found by scanning each row for its filled extent.
  let minX = w, maxX = -1;
  for (let y = y0; y <= y1; y++) {
    for (let x = 0; x < w; x++) {
      if (grid.cells[y * w + x] >= 0) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
    }
  }
  // Skip it entirely when the runs are already full depth: a zero-thickness box
  // is degenerate geometry that z-fights the face it sits behind. Callers that
  // want an exact silhouette rather than a slab pass faceDepth === depth.
  if (maxX >= minX && depth > faceDepth) {
    const back = new THREE.BoxGeometry((maxX - minX + 1) * unit, (y1 - y0 + 1) * unit, (depth - faceDepth) * unit);
    back.translate(
      (minX + (maxX - minX + 1) / 2) * unit - cx,
      cy / 2,
      -(faceDepth * unit) / 2
    );
    colour.set(fill);
    const c = new Float32Array(back.attributes.position.count * 3);
    for (let i = 0; i < c.length; i += 3) c.set([colour.r, colour.g, colour.b], i);
    back.setAttribute('color', new THREE.BufferAttribute(c, 3));
    geoms.push(back);
  }

  return geoms;
}

/** One BufferGeometry out of many boxes, so a head is a single draw call. */
export function merge(geoms) {
  let verts = 0;
  for (const g of geoms) verts += g.attributes.position.count;
  const pos = new Float32Array(verts * 3);
  const nor = new Float32Array(verts * 3);
  const col = new Float32Array(verts * 3);
  const idx = [];
  let v = 0;
  for (const g of geoms) {
    pos.set(g.attributes.position.array, v * 3);
    nor.set(g.attributes.normal.array, v * 3);
    col.set(g.attributes.color.array, v * 3);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx.push(gi[i] + v);
    v += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(idx);
  return out;
}

/** Lift a colour toward white, for the parts that catch the light. */
function light(hex, amount) {
  const c = new THREE.Color(hex);
  return `#${c.lerp(new THREE.Color('#FFFFFF'), amount).getHexString()}`;
}

const box = (w, h, d, colour, mat) => {
  const g = new THREE.BoxGeometry(w, h, d);
  const c = new THREE.Color(colour);
  const arr = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) arr.set([c.r, c.g, c.b], i);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return new THREE.Mesh(g, mat);
};

/**
 * Build a playable body from a crew grid.
 *
 * Separate groups for head, torso, arms and legs — the parts that need to move
 * independently. Rotating a group is the entire animation system, which is all
 * a blocky character needs and is why there is no skeleton anywhere in here.
 */
export function buildCrewBody(grid, { unit = 0.027, material } = {}) {
  const mat = material ?? new THREE.MeshToonMaterial({ vertexColors: true });

  const traits = grid.traits || {};
  const hood = traits.hood || '#E8232B';
  const shirt = traits.shirtColor || '#E8232B';

  // Rows 0-23 are head and hair; 24-31 are the shoulders the avatar draws,
  // which the 3D body replaces with something that can actually move.
  const HEAD_ROWS = 23;
  const headGeo = merge(extrude(grid, { y0: 0, y1: HEAD_ROWS, depth: 7, unit, fill: hood }));
  const head = new THREE.Group();
  const headMesh = new THREE.Mesh(headGeo, mat);
  headMesh.scale.setScalar(0.88);   // it was eating four tenths of his height
  head.add(headMesh);

  const headH = (HEAD_ROWS + 1) * unit;
  const torsoH = headH * 0.80;
  const legH = headH * 0.98;
  const armH = torsoH * 0.95;

  const g = new THREE.Group();
  // An inner rig, so a pose can tilt the body in its OWN frame while the outer
  // group keeps owning world position and facing. Rotating the outer group for
  // both fights itself — you get a figure lying at an angle to the bench it is
  // supposed to be on.
  const rig = new THREE.Group();
  g.add(rig);

  const legs = [];
  for (const sx of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(sx * unit * 4.2, legH, 0);
    const m = box(unit * 6.4, legH, unit * 6, '#2B2B2B', mat);
    m.position.y = -legH / 2;
    leg.add(m);
    const shoe = box(unit * 7, unit * 2.4, unit * 8.4, '#FFFFFF', mat);
    shoe.position.set(0, -legH + unit, unit * 1.1);
    leg.add(shoe);
    rig.add(leg);
    legs.push(leg);
  }

  // The torso is segmented, and that is the whole point. A single slab can only
  // get bigger — scale it and you have a wider box, which is what "square"
  // looks like. Split into chest, waist and shoulder caps, growth can be spent
  // where it changes the OUTLINE: nearly all of it above the ribs, almost none
  // at the waist. That difference is the V, and the V is what reads as strong.
  // Bare skin, with a vest over the middle.
  //
  // The old body was one flat shirt colour from neck to hip, so every gram of
  // muscle it grew was hidden under a t-shirt — which defeats the entire
  // product. Skin is the crew colour; the vest is a narrow strip that does NOT
  // grow, so he visibly fills it out and then bulges past it.
  const torso = new THREE.Group();
  torso.position.y = legH;

  const waist = box(unit * 11.0, torsoH * 0.40, unit * 7.0, hood, mat);
  waist.position.y = torsoH * 0.20;
  torso.add(waist);

  const chest = box(unit * 14.0, torsoH * 0.48, unit * 8.0, hood, mat);
  chest.position.y = torsoH * 0.70;
  torso.add(chest);

  // Pecs and abs, proud of the chest so light catches them. Without separate
  // geometry there is nothing on the body for growth to show up ON.
  const pecs = [];
  for (const sx of [-1, 1]) {
    const pec = box(unit * 6.4, torsoH * 0.26, unit * 1.1, light(hood, 0.07), mat);
    pec.position.set(sx * unit * 3.5, torsoH * 0.80, unit * 4.0);
    torso.add(pec);
    pecs.push(pec);
  }

  const abs = [];
  for (let row = 0; row < 3; row++) {
    for (const sx of [-1, 1]) {
      const ab = box(unit * 3.6, torsoH * 0.085, unit * 0.9, light(hood, 0.06), mat);
      ab.position.set(sx * unit * 2.1, torsoH * (0.44 - row * 0.105), unit * 3.6);
      torso.add(ab);
      abs.push(ab);
    }
  }

  // No vest. A panel across the chest hid the abs and read as a bib, and the
  // one thing this body has to do is show what you built. Just a waistband.
  const vest = box(unit * 11.4, torsoH * 0.12, unit * 7.4, shirt, mat);
  vest.position.y = torsoH * 0.03;
  torso.add(vest);

  const delts = [];
  for (const sx of [-1, 1]) {
    const d = box(unit * 4.6, unit * 4.6, unit * 7.4, hood, mat);
    d.position.set(sx * unit * 7.4, torsoH * 0.94, 0);
    torso.add(d);
    delts.push(d);
  }

  const lats = [];
  for (const sx of [-1, 1]) {
    const l = box(unit * 3.0, torsoH * 0.46, unit * 7.0, hood, mat);
    l.position.set(sx * unit * 6.0, torsoH * 0.52, 0);
    l.rotation.z = sx * 0.30;
    torso.add(l);
    lats.push(l);
  }

  const neck = box(unit * 5.2, unit * 2.6, unit * 5.2, hood, mat);
  neck.position.y = torsoH * 1.02;
  torso.add(neck);

  rig.add(torso);

  const arms = [];
  const biceps = [];
  const forearms = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(sx * unit * 9.4, legH + torsoH * 0.94, 0);
    // Bare, and split at the elbow so the upper arm can outgrow the forearm.
    const bicep = box(unit * 4.4, armH * 0.56, unit * 5.2, hood, mat);
    bicep.position.y = -armH * 0.28;
    arm.add(bicep);
    // A peak on top of the bicep — the bit people actually flex.
    const peak = box(unit * 3.6, armH * 0.16, unit * 4.2, light(hood, 0.16), mat);
    peak.position.y = -armH * 0.16;
    arm.add(peak);
    const fore = box(unit * 3.6, armH * 0.44, unit * 4.4, hood, mat);
    fore.position.y = -armH * 0.78;
    arm.add(fore);
    const hand = box(unit * 4.8, unit * 3.6, unit * 4.8, '#FFFFFF', mat);
    hand.position.y = -armH;
    arm.add(hand);
    rig.add(arm);
    arms.push(arm);
    biceps.push({ bicep, peak });
    forearms.push(fore);
  }

  head.position.y = legH + torsoH;
  rig.add(head);

  return { group: g, rig, head, torso, chest, waist, pecs, abs, vest, lats, delts, neck, arms, biceps, forearms, legs, unit, headH, torsoH, legH };
}

/**
 * Muscle, as one number. No morph targets, no blend shapes, no topology lock —
 * the reason this approach is worth having. The head deliberately does not
 * grow; that is what sells the rest of him getting bigger.
 */
export function applyCrewMuscle(body, t) {
  const m = Math.min(1, Math.max(0, t));

  // Spend the growth where it changes the outline. Chest and shoulders take
  // almost all of it, the waist takes almost none — that difference is the V.
  body.chest.scale.set(1 + m * 0.52, 1 + m * 0.10, 1 + m * 0.34);
  body.waist.scale.set(1 + m * 0.06, 1, 1 + m * 0.12);
  body.neck.scale.set(1 + m * 0.80, 1 + m * 0.45, 1 + m * 0.80);

  // Pecs swell forward and up. Forward is what makes them read as pecs rather
  // than as a wider chest — you have to see them come off the body.
  for (let i = 0; i < body.pecs.length; i++) {
    const sx = i === 0 ? -1 : 1;
    body.pecs[i].scale.set(1 + m * 0.42, 1 + m * 0.34, 1 + m * 2.2);
    body.pecs[i].position.x = sx * body.unit * (3.5 + m * 1.4);
    body.pecs[i].position.z = body.unit * (4.0 + m * 1.1);
  }

  // Abs only appear once there is something to appear on: flat until about a
  // third of the way up, then they cut in. A six-pack on a beginner is a lie.
  const cut = Math.max(0, (m - 0.3) / 0.7);
  for (const ab of body.abs) {
    ab.scale.set(1 + cut * 0.15, 1 + cut * 0.35, 0.2 + cut * 2.4);
    ab.visible = cut > 0.04;
  }

  // The vest deliberately does NOT grow. He fills it, then bulges past it.
  for (let i = 0; i < body.lats.length; i++) {
    const sx = i === 0 ? -1 : 1;
    body.lats[i].scale.set(1 + m * 1.6, 1 + m * 0.15, 1 + m * 0.35);
    body.lats[i].position.x = sx * body.unit * (6.0 + m * 2.4);
    body.lats[i].rotation.z = sx * (0.30 + m * 0.22);
  }

  for (let i = 0; i < body.delts.length; i++) {
    const sx = i === 0 ? -1 : 1;
    body.delts[i].scale.setScalar(1 + m * 1.05);
    body.delts[i].position.x = sx * body.unit * (7.4 + m * 3.2);
    body.delts[i].position.y = body.torsoH * (0.94 + m * 0.04);
  }

  for (let i = 0; i < body.arms.length; i++) {
    const sx = i === 0 ? -1 : 1;
    body.arms[i].position.x = sx * body.unit * (9.4 + m * 4.4);
    body.arms[i].rotation.z = sx * m * 0.52;
    body.biceps[i].bicep.scale.set(1 + m * 1.20, 1, 1 + m * 1.20);
    // The peak grows faster than the arm under it, so the bicep gains a shape
    // rather than just a diameter.
    body.biceps[i].peak.scale.set(1 + m * 1.05, 1 + m * 1.6, 1 + m * 1.35);
    body.biceps[i].peak.position.y = -body.arms[i].children[0].geometry.parameters.height * 0.16;
    body.forearms[i].scale.set(1 + m * 0.50, 1, 1 + m * 0.50);
  }

  for (const l of body.legs) l.scale.set(1 + m * 0.45, 1, 1 + m * 0.45);
}


