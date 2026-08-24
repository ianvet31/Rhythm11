/**
 * elephant3d — an actual rigged 3D elephant.
 *
 * ── Orientation ──────────────────────────────────────────────────────────────
 *
 * Built facing +X (screen right) standing on Y=0. The stage then yaws her a few
 * degrees toward the camera so she reads as walking right AND slightly toward
 * the viewer, which is what gives the scene depth — a pure side-on view is what
 * made the old 2D version look like a diorama.
 *
 * ── Why the model is rebuilt every frame ─────────────────────────────────────
 *
 * The trunk and legs are swept tubes along paths that change with the pose, so
 * their geometry genuinely differs frame to frame — you cannot animate a curved
 * trunk with a rigid transform. At ~900 triangles that rebuild costs well under
 * a millisecond, and it buys real deformation: the trunk curls, the legs bend
 * at the knee, the body squashes on impact.
 *
 * ── Anatomy notes that make it read as an elephant ───────────────────────────
 *
 * A grey blob is not an elephant. The specific reads, in order of importance:
 *
 *   1. SILHOUETTE PROPORTION — the body is a big rounded mass sitting HIGH on
 *      relatively short columnar legs, with the belly line above the knee. Draw
 *      it low-slung and it becomes a hippo.
 *   2. THE DOME — an African elephant's skull rises to a domed forehead well
 *      above the eye line. Skip it and you get a pig.
 *   3. EAR SIZE — enormous, reaching from above the eye to below the jaw, and
 *      angled OUT from the head rather than lying flat. This is most of the
 *      silhouette from three-quarter view.
 *   4. THE TRUNK'S TAPER AND CURVE — thick as the leg at the root, tapering to
 *      a finger. A constant-width tube reads as a hose.
 *   5. BACK LINE — a shallow S: withers high, dip behind them, rump rounded.
 *      A flat back is the fastest way to look like a toy.
 */

import {
  emptyMesh, merge, place, box, spheroid, tube, hash, lerp, clamp,
} from './mesh.js';

/**
 * Leg phase offsets for a walking gait, as fractions of one cycle.
 * Order: [frontLeft, frontRight, backLeft, backRight].
 *
 * Real elephants use a lateral-sequence walk: LH, LF, RH, RF — the two legs on
 * one side never leave the ground together, which is why they look so stable.
 * Faking a diagonal trot gait reads as a horse.
 */
const LEG_PHASE = [0.0, 0.5, 0.25, 0.75];

/** Where each leg attaches, in model space. */
const LEG_ROOT = [
  [0.62, 1.30, 0.42],    // front left
  [0.62, 1.30, -0.42],   // front right
  [-0.72, 1.28, 0.44],   // back left
  [-0.72, 1.28, -0.44],  // back right
];

/**
 * Build the elephant mesh for a given pose.
 *
 * @param {object} pose
 * @param {number} pose.walkPhase  0..1 through the gait cycle
 * @param {number} pose.stomp      0..1 impact envelope
 * @param {number} pose.trunkCurl  0 = hanging, 1 = curled to mouth
 * @param {number} pose.headTurn   yaw of the head, radians
 * @param {number} pose.headNod    pitch of the head, radians
 * @param {number} pose.earFlap    0..1
 * @param {number} pose.blink      0..1
 * @param {number} pose.chew       0..1
 */
export function buildElephant(pose = {}) {
  const {
    walkPhase = 0, stomp = 0, trunkCurl = 0,
    headTurn = 0, headNod = 0, earFlap = 0, blink = 0, chew = 0,
    walking = 1,
  } = pose;

  const M = emptyMesh();

  /* ── Body-level motion ──────────────────────────────────────────────────
     The bob comes from the gait rather than being authored separately, so it
     can never drift out of step with the feet. Four footfalls per cycle means
     the vertical oscillation runs at 4× the cycle rate, but the WEIGHT shifts
     twice, so the dominant term is 2×. */
  const bob = (Math.sin(walkPhase * Math.PI * 4) * 0.035
    + Math.sin(walkPhase * Math.PI * 2) * 0.02) * walking;

  /* ── The stomp ──────────────────────────────────────────────────────────
     `stomp` arrives as a linear 1→0 decay, which on its own reads as a limp
     fade. Reshaping it is what makes the hit land:

       squash   pow(s, 0.35)   rises almost instantly, releases slowly —
                               so the compression is at its most extreme on the
                               very first frame, where the eye reads impact
       recoil   sin(π·s)·s     a secondary bounce as she pushes back up,
                               peaking after the squash rather than with it

     Staggering the two is the whole trick. Squash and recovery on the same
     curve is a rubber ball; offset, it's a heavy body absorbing a landing. */
  const hit = Math.pow(clamp(stomp, 0, 1), 0.35);
  const recoil = Math.sin(Math.PI * stomp) * stomp;

  const squash = 1 + hit * 0.17 - recoil * 0.07;
  const bodyY = 1.62 + bob - hit * 0.17 + recoil * 0.09;

  // Slight roll as weight transfers side to side. Small — 3 degrees — but it's
  // the difference between walking and sliding. The stomp adds a lurch onto
  // the stomping side.
  const roll = Math.sin(walkPhase * Math.PI * 2) * 0.05 * walking - hit * 0.05;

  // She pitches forward into the stomp and rocks back out of it.
  const pitch = hit * 0.055 - recoil * 0.035;

  /* ── Torso ──────────────────────────────────────────────────────────────
     Two overlapping spheroids: a deep chest and a rounder rump, with the chest
     set slightly higher. That's what produces the shallow S-curve back line;
     one spheroid gives you a loaf of bread. */
  const chest = spheroid(0.80, 0.66, 0.66, 'hide', 12, 8);
  merge(M, chest, (v) => bodyRig(v, 0.40, bodyY + 0.04, 0, squash, roll, pitch));

  const rump = spheroid(0.74, 0.62, 0.64, 'hide', 12, 8);
  merge(M, rump, (v) => bodyRig(v, -0.66, bodyY - 0.04, 0, squash, roll, pitch));

  // Belly filler so the two masses read as one animal.
  const belly = spheroid(0.78, 0.46, 0.58, 'hideDark', 10, 6);
  merge(M, belly, (v) => bodyRig(v, -0.14, bodyY - 0.30, 0, squash, roll, pitch));

  // Withers hump — the high point just behind the neck.
  const withers = spheroid(0.36, 0.22, 0.48, 'hide', 8, 5);
  merge(M, withers, (v) => bodyRig(v, 0.44, bodyY + 0.52, 0, squash, roll, pitch));

  // Neck: bridges body to head so they don't read as two separate balls.
  const neck = spheroid(0.34, 0.40, 0.44, 'hide', 8, 5);
  merge(M, neck, (v) => bodyRig(v, 1.02, bodyY + 0.34, 0, squash, roll, pitch));

  /* ── Legs ───────────────────────────────────────────────────────────────
     Columnar, thick, with a slight knee bend. Elephant legs are near-vertical
     pillars — that's why they can stand for hours — so the bend is subtle.
     Front legs are marginally longer and straighter than back. */
  for (let i = 0; i < 4; i++) {
    const front = i < 2;
    const ph = (walkPhase + LEG_PHASE[i]) % 1;
    const root = LEG_ROOT[i];
    const isStomping = front && i === 1;

    const leg = buildLeg(ph, front, walking, isStomping ? hit : 0);
    // root[1] matters: legs hang FROM the shoulder, not from the origin.
    // Dropping it detaches them from the body entirely.
    // Legs take a fraction of the body's lean: the shoulders move with the
    // torso, the feet stay planted. Giving them the full rotation would slide
    // her feet through the ground on every stomp.
    merge(M, leg, (v) => bodyRig(
      [v[0] + root[0], v[1] + root[1] + bob * 0.6, v[2] + root[2]],
      0, 0, 0, 1, roll * 0.4, pitch * 0.35,
    ));
  }

  /* ── Tail ───────────────────────────────────────────────────────────────
     Thin, with a tufted end. Swings with a phase lag behind the body roll —
     lag is what makes an appendage feel attached rather than glued. */
  const tailSwing = Math.sin((walkPhase - 0.18) * Math.PI * 2) * 0.16 * walking;
  const tailPath = [];
  const tailR = [];
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    tailPath.push([
      -1.42 - t * 0.20,
      bodyY + 0.42 - t * 1.30,
      Math.sin(t * 2.2) * tailSwing,
    ]);
    tailR.push(lerp(0.10, 0.035, t));
  }
  merge(M, tube(tailPath, tailR, 'hideDark', 5), (v) => rollOnly(v, roll));
  // Tuft
  merge(M, spheroid(0.09, 0.16, 0.09, 'hideDark', 5, 4),
    place(-1.63, bodyY - 0.94, Math.sin(2.2) * tailSwing));

  /* ── Head ───────────────────────────────────────────────────────────────
     Placed forward and slightly down from the withers. The dome is a separate
     spheroid ON TOP of the skull, which is the read that says "elephant".      */
  const headBase = [1.42, bodyY + 0.30, 0];
  const hn = headNod + Math.sin(walkPhase * Math.PI * 2 + 0.6) * 0.03 * walking;
  const headRig = (v) => {
    // Yaw then pitch about the head's own origin, then translate into place.
    let [x, y, z] = v;
    const cy = Math.cos(headTurn); const sy = Math.sin(headTurn);
    [x, z] = [x * cy + z * sy, -x * sy + z * cy];
    const cp = Math.cos(hn); const sp = Math.sin(hn);
    [x, y] = [x * cp - y * sp, x * sp + y * cp];
    return bodyRig([x + headBase[0], y + headBase[1], z + headBase[2]], 0, 0, 0, 1, roll, pitch);
  };

  /* Friendliness is proportion, not expression.
     A bigger head relative to the body, a higher rounder dome, and fuller
     cheeks all read as juvenile — the same neotenic cues that make any animal
     look approachable. The previous head was anatomically closer to an adult
     African elephant and correspondingly severe. */
  merge(M, spheroid(0.50, 0.48, 0.48, 'hide', 11, 8), (v) => headRig(v));
  // The dome — rounder and taller than life, which is most of the charm.
  merge(M, spheroid(0.42, 0.40, 0.44, 'hide', 10, 7),
    (v) => headRig([v[0] - 0.03, v[1] + 0.34, v[2]]));
  // Full round cheeks.
  merge(M, spheroid(0.34, 0.31, 0.42, 'hide', 9, 6),
    (v) => headRig([v[0] + 0.18, v[1] - 0.26, v[2]]));

  /* ── Ears ───────────────────────────────────────────────────────────────
     Huge, thin, angled out and back. Built as a squashed spheroid so they have
     a little thickness — a flat quad would vanish edge-on and pop.            */
  const flap = earFlap * 0.45 + Math.sin(walkPhase * Math.PI * 2 - 0.9) * 0.12 * walking;
  for (const side of [1, -1]) {
    /**
     * The ear is a large thin fan. Built thin in Z so its broad faces already
     * point sideways, then yawed about Y to rake it backward and outward.
     *
     * Size is not exaggeration: an African elephant's ear runs from above the
     * eye to below the jaw and is nearly as tall as the skull. Undersized ears
     * were most of why the first attempt read as a hippo.
     */
    const yaw = side * (0.50 + flap * 0.6);
    const cy = Math.cos(yaw); const sy = Math.sin(yaw);
    /**
     * Offset must clear the skull. The skull's half-width is 0.42, so an ear
     * centred at z = ±0.30 sits INSIDE it and is completely swallowed — which
     * is exactly what happened on the first attempt. Pushing it to 0.50 and
     * back along -X puts the whole fan outside the head where it belongs.
     */
    const earRig = (v) => {
      const x = v[0]; const y = v[1]; const z = v[2];
      return headRig([
        // Raked well BACK so the fan extends behind the skull into open sky.
        // An ear that only sticks out sideways is hidden by the head from a
        // three-quarter view, which is the angle the game actually uses.
        // Set well BACK from the eye. The skull grew when she was made
        // friendlier, and at the old offset the ear fan covered her face.
        (x * cy + z * sy) - 0.46,
        y + 0.08,
        (-x * sy + z * cy) + side * 0.56,
      ]);
    };
    // Outer ear — its own ramp so it separates from the skull. See palette32.
    merge(M, spheroid(0.50, 0.66, 0.05, 'earOuter', 9, 8), earRig);
    // Inner ear — warmer, inset, on the head-facing side.
    merge(M, spheroid(0.36, 0.50, 0.03, 'ear', 8, 7),
      (v) => earRig([v[0] + 0.04, v[1] - 0.03, v[2] - side * 0.045]));
    // Thickened top edge where the ear meets the skull, plus a short neck of
    // hide bridging the gap — without it the ear reads as a floating plate.
    merge(M, spheroid(0.30, 0.10, 0.09, 'hide', 6, 4),
      (v) => earRig([v[0], v[1] + 0.58, v[2]]));
    merge(M, spheroid(0.16, 0.30, 0.20, 'hide', 6, 5),
      (v) => headRig([v[0] - 0.14, v[1] + 0.10, v[2] + side * 0.34]));
  }

  /* ── Eyes ───────────────────────────────────────────────────────────────
     Small and set LOW and FORWARD on the skull, just above the trunk root.
     Putting them centre-face is what made the old 2D version cyclopean.       */
  /* Eyes: bigger, rounder, and set slightly further apart and lower.
     Large eyes low on a tall skull is the single strongest "friendly" signal
     available; the previous pair were small, high and close together, which
     reads as watchful. A white catchlight sphere on the upper-left of each
     pupil costs almost nothing and makes them look alive rather than painted. */
  const eyeOpen = 1 - blink;
  for (const side of [1, -1]) {
    // The dark pupil has to dominate: a big white sclera with a small pupil
    // reads as a startled cartoon, and at 320x180 it just reads as a white
    // blob. Pupil large, sclera a thin rim around it.
    merge(M, spheroid(0.088, 0.088 * eyeOpen + 0.010, 0.088, 'eyeWhite', 7, 5),
      (v) => headRig([v[0] + 0.30, v[1] - 0.06, v[2] + side * 0.33]));
    merge(M, spheroid(0.068, 0.068 * eyeOpen + 0.008, 0.068, 'eye', 6, 5),
      (v) => headRig([v[0] + 0.35, v[1] - 0.06, v[2] + side * 0.345]));
    if (eyeOpen > 0.4) {
      merge(M, spheroid(0.024, 0.024, 0.024, 'eyeWhite', 4, 3),
        (v) => headRig([v[0] + 0.39, v[1] - 0.015, v[2] + side * 0.315]));
    }
    // A soft brow. Angled slightly UP toward the outside, which is a raised,
    // open expression rather than a furrowed one.
    merge(M, spheroid(0.11, 0.038, 0.08, 'hide', 5, 3),
      (v) => headRig([v[0] + 0.30, v[1] + 0.09 + side * 0.005, v[2] + side * 0.31]));
    // Round cheek blush, in the warm ear tone.
    merge(M, spheroid(0.10, 0.075, 0.05, 'ear', 6, 4),
      (v) => headRig([v[0] + 0.28, v[1] - 0.24, v[2] + side * 0.34]));
  }

  /* A smile. Two short tapered tubes curving UP at the corners, tucked under
     the trunk root. Tiny, mostly hidden at this resolution, and it changes the
     whole face — the difference between an animal that tolerates you and one
     that's pleased to see you. */
  for (const side of [1, -1]) {
    const sm = [];
    const smR = [];
    for (let k = 0; k <= 3; k++) {
      const t = k / 3;
      sm.push([0.42 - t * 0.04, -0.40 + t * t * 0.07, side * t * 0.17]);
      smR.push(lerp(0.028, 0.016, t));
    }
    merge(M, tube(sm, smR, 'eye', 4, false), (v) => headRig(v));
  }

  /* ── Tusks ──────────────────────────────────────────────────────────────
     Short and curving forward and slightly out. Small, so she reads young. */
  // Short, blunt and turned UP at the tips. Long forward-pointing tusks read
  // as weaponry; stubby upturned ones read as a young animal.
  for (const side of [1, -1]) {
    const tuskPath = [];
    const tuskR = [];
    for (let i = 0; i <= 3; i++) {
      const t = i / 3;
      tuskPath.push([
        0.50 + t * 0.26,
        -0.34 - t * 0.16 + t * t * 0.20,
        side * (0.20 + t * 0.07),
      ]);
      tuskR.push(lerp(0.070, 0.030, t));
    }
    merge(M, tube(tuskPath, tuskR, 'tusk', 5), (v) => headRig(v));
  }

  /* ── Trunk ──────────────────────────────────────────────────────────────
     The single most important part. A swept tube with a real taper, blended
     between a hanging pose and a curled-to-mouth pose. The curl travels DOWN
     the trunk (later stations lag earlier ones) rather than the whole thing
     rotating, which is what makes it feel like muscle instead of a hinge.     */
  const STATIONS = 9;
  const trunkPath = [];
  const trunkR = [];
  const sway = Math.sin((walkPhase - 0.25) * Math.PI * 2) * 0.10 * walking;

  for (let i = 0; i < STATIONS; i++) {
    const t = i / (STATIONS - 1);

    // Hanging: drops from between the tusks, bulging forward then tucking the
    // tip back under — the classic resting curve.
    const down = [
      0.30 + Math.sin(t * 2.1) * 0.30 - t * t * 0.22,
      -0.24 - t * 1.62,
      sway * t * t,
    ];
    // Curled: sweeps up and back toward the mouth.
    const up = [
      0.44 + Math.sin(t * Math.PI) * 0.52,
      -0.28 - t * 0.24 + Math.sin(t * Math.PI * 0.9) * 0.62,
      sway * t * 0.3,
    ];

    const local = clamp((trunkCurl - t * 0.30) / 0.70, 0, 1);
    const e = local * local * (3 - 2 * local);        // smoothstep
    trunkPath.push([
      lerp(down[0], up[0], e),
      lerp(down[1], up[1], e),
      lerp(down[2], up[2], e),
    ]);
    // Taper: thick as a leg at the root, a finger at the tip. The exponent
    // keeps it fat near the face and thins fast toward the end — a linear
    // taper reads as a traffic cone.
    trunkR.push(lerp(0.22, 0.045, Math.pow(t, 0.72)));
  }
  merge(M, tube(trunkPath, trunkR, 'hide', 7), (v) => headRig(v));

  // Trunk-tip "finger" — the little prehensile lip.
  const tip = trunkPath[STATIONS - 1];
  merge(M, spheroid(0.06, 0.05, 0.06, 'ear', 5, 4),
    (v) => headRig([v[0] + tip[0] + 0.02, v[1] + tip[1], v[2] + tip[2]]));

  // Mouth, only visible when chewing.
  if (chew > 0.04) {
    merge(M, spheroid(0.12, 0.05 + chew * 0.09, 0.14, 'ear', 6, 4),
      (v) => headRig([v[0] + 0.30, v[1] - 0.46, v[2]]));
  }

  return M;
}

/**
 * Apply body squash, roll and pitch, then translate.
 *
 * Squash is volume-preserving: compressing vertically by k expands horizontally
 * by k. Skip that and "squash" just reads as "the model got shorter", which is
 * the most common tell of amateur cartoon animation.
 */
function bodyRig(v, tx, ty, tz, squash, roll, pitch = 0) {
  let [x, y, z] = v;
  x += tx; y += ty; z += tz;

  // Squash about the ground plane, so she compresses down onto her feet.
  if (squash !== 1) {
    y *= 1 / squash;
    x *= squash;
    z *= squash;
  }

  /**
   * Pitch and roll about the BODY, not the world origin.
   *
   * Rotating about (0,0,0) — which sits on the ground, a metre below and
   * behind her mass — turns a small rotation into a large translation, and the
   * body visibly tears away from the legs. Rotating about a pivot inside the
   * torso is what makes it read as the animal leaning.
   */
  const PX = 0.15;
  const PY = 1.45;
  if (pitch) {
    const c = Math.cos(pitch); const s = Math.sin(pitch);
    const dx = x - PX; const dy = y - PY;
    x = PX + dx * c - dy * s;
    y = PY + dx * s + dy * c;
  }
  if (roll) {
    const c = Math.cos(roll); const s = Math.sin(roll);
    const dy = y - PY;
    y = PY + dy * c - z * s;
    z = dy * s + z * c;
  }
  return [x, y, z];
}

function rollOnly(v, roll) {
  if (!roll) return v;
  const c = Math.cos(roll); const s = Math.sin(roll);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}

/**
 * One leg, as a tapered tube with a foot.
 *
 * @param {number} ph  0..1 through this leg's own cycle. 0 = footfall.
 */
function buildLeg(ph, front, walking, stompAmt) {
  const M = emptyMesh();

  /* Gait split: roughly 60% of the cycle is STANCE (foot planted, body moving
     over it) and 40% SWING (foot in the air moving forward). Getting this ratio
     wrong is what makes walk cycles look like marching. */
  const STANCE = 0.62;
  let footX;
  let footY = 0;

  if (ph < STANCE) {
    // Planted: foot slides backward relative to the body at constant speed.
    const t = ph / STANCE;
    footX = lerp(0.34, -0.34, t) * walking;
  } else {
    // Swing: lifts, travels forward, plants. Front-loaded so it ARRIVES.
    const t = (ph - STANCE) / (1 - STANCE);
    footX = lerp(-0.34, 0.34, t * t * (3 - 2 * t)) * walking;
    footY = Math.sin(t * Math.PI) * 0.30 * walking;
  }

  footY += stompAmt * -0.05;

  const len = front ? 1.30 : 1.26;
  const knee = front ? 0.42 : 0.46;

  // Path from hip to foot with a subtle forward knee.
  const path = [];
  const radii = [];
  const N = 5;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const bendAmt = Math.sin(t * Math.PI) * knee * 0.22;
    path.push([
      lerp(0, footX, t * t) + bendAmt * (front ? 1 : -1),
      -t * len + footY * t * t,
      0,
    ]);
    // Thick at the shoulder, narrowing to the ankle, then the foot flares.
    radii.push(lerp(0.30, 0.19, t));
  }
  merge(M, tube(path, radii, front ? 'hide' : 'hideDark', 6));

  // Foot: a flattened cylinder, wider than the ankle.
  const f = path[N - 1];
  merge(M, spheroid(0.26, 0.13, 0.25, front ? 'hide' : 'hideDark', 7, 4),
    place(f[0], f[1] - 0.06, f[2]));

  // Toenails — three small pale nubs on the front face. Tiny, but they're the
  // detail that reads as "elephant foot" rather than "post".
  for (const d of [-1, 0, 1]) {
    merge(M, spheroid(0.055, 0.035, 0.05, 'tusk', 4, 3),
      place(f[0] + 0.19, f[1] - 0.04, f[2] + d * 0.115));
  }

  return M;
}
