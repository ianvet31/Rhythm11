/**
 * Stage — Mango Stomp, in 3D.
 *
 * ── What changed from the 2D version ─────────────────────────────────────────
 *
 * Everything visual. The old stage drew flat vector shapes with canvas paths;
 * this one runs a software 3D rasterizer (src/gfx/) into a 320×180 indexed
 * framebuffer and blits it upscaled. The gameplay contract is identical — same
 * notes, same judgment, same cue rules — so only presentation moved.
 *
 * ── The one equation, now in 3D ──────────────────────────────────────────────
 *
 * A note's world position along the path is:
 *
 *      worldX = (note.time − songTime) × SPEED
 *
 * The camera and the elephant stay put at the origin; the WORLD scrolls past in
 * −X. Constant world-units per second means the spacing between two fruit is
 * exactly proportional to the gap between two notes, just as before — the
 * notation is still honest, it's just drawn in perspective now.
 *
 * She is yawed slightly toward the camera so she walks right AND toward the
 * viewer. That single rotation is most of what makes the scene read as a place
 * rather than a diorama.
 *
 * ── Cue audit ────────────────────────────────────────────────────────────────
 *
 *   FRUIT POSITION   reliable spatial timing cue. This level deliberately
 *                    relaxes the house rule; see game/levels/grove.js.
 *   FRUIT HEIGHT     random, seeded, meaningless. Scatter, not signal.
 *   MARIMBA CALL     one bar before each cluster, plays its exact figure.
 *   WALK CYCLE       locked to beat phase. Shows the PULSE, not the notes.
 *   STOMP / CHEW     reaction only, never anticipation.
 */

import { Stage } from '../stage.js';
import { VW, VH } from '../../render/view.js';
import { boldText, layer, INK, ease, clamp, lerp } from '../../render/shapes.js';
import { Framebuffer, Renderer, mat4, m4mul, m4rotY, m4translate, m4scale }
  from '../../gfx/raster.js';
import { PAL32, MATERIALS } from '../../gfx/palette32.js';
import { buildElephant } from '../../gfx/elephant3d.js';
import { Spring } from '../../render/beasts.js';
import {
  drawSky, buildGrove, buildFruitCanopy, drawFruit, drawStalk, drawShadow,
  FRUIT_Y, CANOPY_Y,
} from '../../gfx/grove3d.js';

const FB_W = 320;
const FB_H = 180;

/** World units per second the grove scrolls past. Sets fruit spacing. */
const SPEED = 3.05;

/** She stands here; the world moves instead. */
const HER_X = 0;
const HER_Z = 0;
/** Facing right, yawed toward the camera. */
const HER_YAW = -0.40;

/** Fruit sits directly above her head at the instant its note is due. */
const FRUIT_Z = 0.30;

const FALL_TIME = 0.22;
const KNOCK_DELAY = 0.03;
/** Where the trunk tip waits to receive a fruit. */
const CATCH = [0.95, 1.55, 0.30];

export class GroveStage extends Stage {
  constructor(P, data) {
    super(P, data);

    this.fb = new Framebuffer(FB_W, FB_H, PAL32);
    this.r = new Renderer(this.fb);

    for (const n of this.notes) {
      n._hangY = FRUIT_Y + (hash01(n.hangSeed ?? 0) - 0.5) * 1.05;
      n._spin = hash01((n.hangSeed ?? 0) + 91) * 6.28;
    }

    this.trunk = new Spring(0, 200, 25);
    this.head = new Spring(0, 190, 22);
    this.reset();
  }

  reset() {
    super.reset();
    this.animTime = 0;
    this.songTime = 0;
    this.stompAt = -9;
    this.eatAt = -9;
    this.callAt = -9;
    this.missAt = -9;
    this.fallers = [];
    this.eaten = 0;
    this.carrying = null;
    this.trunk?.set(0);
    this.head?.set(0);
  }

  /* ── Reactions ─────────────────────────────────────────────────────────── */

  onCue(cue) {
    if (cue.kind === 'call') this.callAt = this.animTime;
  }

  onJudge(note, grade) {
    this.stompAt = this.animTime;

    if (grade === 'miss' || grade === 'holdbreak') {
      this.missAt = this.animTime;
      return;
    }

    // Knock it loose slightly after the foot lands — the shockwave has to
    // travel up the tree. That gap is the difference between "two things
    // happened" and "one thing caused another".
    this.fallers.push({
      t0: this.animTime + KNOCK_DELAY,
      x0: 0, y0: note._hangY, z0: FRUIT_Z,
      kind: note.kind, spin: note._spin,
      dur: FALL_TIME, finale: !!note.finale,
    });

    this.trunk.target = 1;
    this.head.target = -0.13;
  }

  /** Feedback lands over her head, projected from 3D. */
  focus() {
    const p = this.r.project([HER_X + 0.6, 2.5, HER_Z]);
    if (!p) return { x: VW * 0.35, y: VH * 0.45 };
    return { x: (p.x / FB_W) * VW, y: (p.y / FB_H) * VH };
  }

  /* ── Update ────────────────────────────────────────────────────────────── */

  update(dt, adt, t) {
    super.update(dt, adt, t);
    this.animTime += adt;
    this.songTime = t.songTime;

    for (let i = this.fallers.length - 1; i >= 0; i--) {
      const f = this.fallers[i];
      if ((this.animTime - f.t0) / f.dur < 1) continue;
      this.eatAt = this.animTime;
      this.eaten++;
      this.carrying = { kind: f.kind, spin: f.spin };
      this.fallers.splice(i, 1);
    }

    const chewing = Stage.since(this.animTime, this.eatAt, 0.34);
    if (chewing <= 0) {
      this.trunk.target = 0;
      this.head.target = 0;
      this.carrying = null;
    }
    this.trunk.step(adt);
    this.head.step(adt);
  }

  /* ── Draw ──────────────────────────────────────────────────────────────── */

  draw(c, t) {
    const now = this.animTime;
    const scroll = this.songTime * SPEED;
    const sway = now * 0.55;
    const stomp = Stage.since(now, this.stompAt, 0.26);
    const chew = Stage.since(now, this.eatAt, 0.34);

    const fb = this.fb;
    const r = this.r;

    fb.clear(0);
    drawSky(fb);
    fb.depth.fill(0);

    /* Camera. Slight vertical drift on a long, irrational period so the shot
       breathes — a perfectly locked camera in a 3D scene feels like a webcam.
       Deliberately NOT tempo-locked; a camera that bounced on the beat would
       compete with the fruit for the player's timing attention. */
    const drift = Math.sin(now * 0.31) * 0.10;
    r.setCamera(
      [-1.2, 3.45 + drift, 8.8],
      [1.9, 1.95 + drift * 0.5, 0.0],
      Math.PI / 4.4,
    );
    r.begin();

    buildGrove(r, { scroll, sway, materials: MATERIALS });
    buildFruitCanopy(r, MATERIALS, scroll, sway);

    // Contact shadow. Squashes on impact, which sells the weight.
    drawShadow(r, MATERIALS, HER_X + 0.1, HER_Z, 1.55 + stomp * 0.35, 1);

    this._fruit(r, now);
    this._fallers(r, now);

    // The elephant.
    const beat = t.beat;
    const mesh = buildElephant({
      // One full gait cycle every two beats: one footfall per beat, so she is
      // physically incapable of walking out of time with the music.
      walkPhase: (beat * 0.5) % 1,
      stomp,
      trunkCurl: clamp(this.trunk.value, 0, 1.1),
      headNod: this.head.value,
      earFlap: 0.18 + stomp * 0.5,
      blink: this.blink,
      chew,
      walking: 1,
    });
    r.mesh(mesh, m4mul(m4translate(HER_X, 0, HER_Z), m4rotY(HER_YAW)), MATERIALS);

    // A fruit held in the trunk tip, drawn separately so it can be any kind.
    if (this.carrying) {
      drawFruit(r, MATERIALS, CATCH[0], CATCH[1], CATCH[2],
        this.carrying.kind, 1 - chew * 0.5, this.carrying.spin);
    }

    r.flush();

    // Blit the 3D frame, then let the engine's 2D juice and HUD draw over it.
    c.imageSmoothingEnabled = false;
    this.view?.blitFramebuffer ? this.view.blitFramebuffer(fb) : blitVia(c, fb);

    if (this.eaten > 0) {
      layer(c, () => {
        c.globalAlpha = 0.8;
        boldText(c, `${this.eaten}`, 40, VH - 34, 26, '#ffd166', INK, 'left');
      });
    }
  }

  /* ── Fruit ─────────────────────────────────────────────────────────────── */

  _fruit(r, now) {
    // The canopy shivers when the marimba calls — a visual echo of the audio
    // telegraph, placed on the leaves rather than on any individual fruit.
    const shiver = Stage.since(now, this.callAt, 0.30);

    for (const n of this.notes) {
      if (n.judged) continue;
      const dt = n.time - this.songTime;
      if (dt < -0.4 || dt > 7.5) continue;

      const x = dt * SPEED;
      const bob = Math.sin(now * 1.5 + n.hangSeed) * 0.03
        + shiver * Math.sin(now * 40) * 0.05;
      const y = n._hangY + bob;

      drawStalk(r, MATERIALS, x, y, FRUIT_Z, CANOPY_Y - y);
      drawFruit(r, MATERIALS, x, y, FRUIT_Z, n.kind, 1, n._spin + now * 0.25);
    }
  }

  _fallers(r, now) {
    for (const f of this.fallers) {
      const u = (now - f.t0) / f.dur;
      if (u < 0 || u > 1) continue;
      // Constant acceleration down, easing across to the trunk tip. Fall time
      // is FIXED regardless of hang height (see the note in levels/grove.js):
      // consistency of feedback beats consistency of physics.
      const x = lerp(f.x0, CATCH[0], u);
      const y = lerp(f.y0, CATCH[1], u * u);
      const z = lerp(f.z0, CATCH[2], u);
      drawFruit(r, MATERIALS, x, y, z, f.kind,
        (f.finale ? 1.5 : 1) * (1 + u * 0.15), f.spin + u * 9);
    }
  }
}

/** Fallback blit when the stage has no View reference. */
function blitVia(c, fb) {
  const img = c.createImageData(fb.w, fb.h);
  fb.toRGBA(img.data, 1);
  c.putImageData(img, 0, 0);
}

function hash01(i) {
  const v = Math.sin(i * 127.1 + 43.7) * 43758.5453;
  return v - Math.floor(v);
}
