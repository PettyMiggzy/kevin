// Kevin as Todd drew him, standing up in the 3D world.
//
// The characters are voxel because they are extruded straight out of a 32x32
// NFT grid, which was the right call for the NFT pipeline and is the wrong
// answer to "why doesn't he look like the drawing". Nothing bought from an
// asset store will look like Todd's Kevin either; the only thing that looks
// like Todd's Kevin is Todd's Kevin.
//
// So: a billboard. A quad that always faces the camera, showing one cell of the
// walk sheet — the same nine-frame cycles that make the good stickers, which
// means the character in the world and the character in Telegram are literally
// the same drawings. 2D characters in a 3D room is not a compromise, it is a
// look with a long history (Doom, Paper Mario, Don't Starve), and it is the
// only one that can be exactly on model.
import * as THREE from 'three';

const COLS = 9;
const ROWS = ['front', 'back', 'left', 'right', 'diagonal'];
/** How tall he stands, in metres. Matched to the voxel body he replaces. */
const HEIGHT = 1.85;

/**
 * Which row to show, given where he is facing.
 *
 * Facing is the same `atan2(nx, nz)` the movement code already produces: 0 is
 * walking toward the camera, PI is walking away, +PI/2 is walking right. Todd
 * drew five directions, not eight, so the two diagonals are the same drawing
 * mirrored — which is what `flip` is for, and is also why left and right can
 * come from one sheet if either is ever missing.
 */
function pick(angle) {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  const flip = a < 0;                    // mirror the whole left half
  const m = Math.abs(a);
  if (m < Math.PI / 8) return { row: 'front', flip: false };
  if (m < (3 * Math.PI) / 8) return { row: 'diagonal', flip };
  if (m < (5 * Math.PI) / 8) return { row: flip ? 'left' : 'right', flip: false };
  if (m < (7 * Math.PI) / 8) return { row: 'diagonal', flip: !flip };
  return { row: 'back', flip: false };
}

/**
 * @param texture the walk atlas, 9 columns by 5 rows
 * @returns a body with the same shape main.js expects of the voxel one — group,
 *          arms, legs, head, torso — so nothing else has to know which it got.
 *          The limbs are real Object3Ds that simply are not drawn: the walk
 *          code writes rotations to them every frame and would throw on stubs.
 */
export function buildSpriteKevin(texture) {
  const map = texture.clone();
  map.needsUpdate = true;
  map.colorSpace = THREE.SRGBColorSpace;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.repeat.set(1 / COLS, 1 / ROWS.length);
  map.generateMipmaps = true;

  const w = HEIGHT * (158 / 176);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, HEIGHT),
    // Basic, not toon: the drawing already has its own shading and its own
    // black outline, and lighting it again muddies both. alphaTest rather than
    // blending so he never sorts wrongly against the props behind him.
    new THREE.MeshBasicMaterial({ map, transparent: true, alphaTest: 0.45, side: THREE.DoubleSide })
  );
  mesh.material.userData.outlineParameters = { visible: false };
  mesh.position.y = HEIGHT / 2;

  const group = new THREE.Group();
  group.add(mesh);

  // Limbs the rest of the game can write to without knowing they are not drawn.
  const spare = () => { const o = new THREE.Object3D(); group.add(o); return o; };
  const body = {
    group,
    mesh,
    sprite: true,
    arms: [spare(), spare()],
    legs: [spare(), spare()],
    head: spare(),
    torso: spare(),
    torsoH: 0.7,
    frame: 0,
    facing: Math.PI,
  };

  /** Show a cell. Mirroring is a negative repeat, which costs nothing. */
  body.show = (row, col, flip) => {
    const r = ROWS.indexOf(row);
    if (r < 0) return;
    map.repeat.x = flip ? -1 / COLS : 1 / COLS;
    map.offset.set(flip ? (col + 1) / COLS : col / COLS, 1 - (r + 1) / ROWS.length);
  };

  /**
   * @param moving   whether to run the cycle or stand
   * @param camYaw   the camera's heading, so "facing the camera" is honest
   *                 rather than assuming the camera is always at +z
   */
  body.step = (dt, moving, camYaw = 0) => {
    if (moving) body.frame = (body.frame + dt * 11) % COLS;
    else body.frame = 0;                                   // the standing pose
    const { row, flip } = pick(body.facing - camYaw);
    body.show(row, Math.floor(body.frame), flip);
    // Billboard on Y only. Tilting to face a camera that is above him would lay
    // him back like a card on a table.
    group.rotation.y = camYaw;
  };

  body.show('back', 0, false);
  return body;
}
