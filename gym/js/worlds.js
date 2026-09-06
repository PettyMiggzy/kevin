// Worlds: build one on the way in, take it apart on the way out.
//
// The street and the crib used to be one scene with everything in it. That is
// fine while there is not much of it and hopeless the moment there is: every
// world pays for every other world's geometry, textures and draw calls, whether
// you can see them or not, and the ceiling that matters is a phone's. Building
// on entry and DISPOSING on exit means detail added to one room costs nothing
// anywhere else — which is the whole point of splitting them up.
//
// Hiding is not disposing. A hidden mesh still holds its buffers on the GPU and
// its textures in memory; all you save is the draw call. So this actually frees
// things, which means it has to be careful about what it is allowed to free.

/**
 * Take a world apart.
 *
 * THREE does not do this for you: dropping the last reference to a Mesh leaves
 * its geometry and textures resident on the GPU until something calls dispose.
 *
 * The trap is shared geometry. Props are loaded once, cached, and `clone()`d
 * per world, and a clone SHARES its source's geometry — dispose it here and the
 * next world to spawn that prop gets an empty box, or a crash, depending on the
 * driver. Anything cloned off the cache is flagged, and its geometry is left
 * alone. Materials are safe either way: normalise() rebuilds every one of them
 * per instance, so nothing else is holding them.
 */
export function disposeWorld(group) {
  const textures = new Set();
  group.traverse((o) => {
    if (o.isMesh || o.isLine || o.isPoints) {
      if (o.geometry && !o.userData.sharedGeometry) o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m) continue;
        // gradientMap is NOT in this list on purpose. It is the toon ramp —
        // one texture created once at module load and shared by every material
        // in the game — so disposing it here frees something this world does not
        // own, on behalf of every other world too.
        for (const k of ['map', 'alphaMap', 'emissiveMap', 'normalMap']) {
          if (m[k]?.isTexture) textures.add(m[k]);
        }
        m.dispose();
      }
    }
  });
  for (const t of textures) t.dispose();
  group.removeFromParent();
  group.clear();
}

/**
 * Run a build function that adds straight to the scene, and collect whatever it
 * added into a group.
 *
 * Every builder in this project takes the scene and calls scene.add. Rewriting
 * all of them to thread a group through would touch every one and be a much
 * bigger diff than this: note what was there, run the builder, and adopt the
 * difference. Reparenting keeps world matrices, so nothing moves.
 */
export function captureInto(scene, group, build) {
  const before = new Set(scene.children);
  const out = build();
  for (const child of [...scene.children]) {
    if (!before.has(child) && child !== group) group.add(child);
  }
  return out;
}
