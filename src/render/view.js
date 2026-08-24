/**
 * View — the canvas, the virtual resolution, and the camera.
 *
 * Everything in the game draws into a fixed 960×540 coordinate space. The view
 * scales that to the window. Two reasons this matters more than usual here:
 *
 *   • Layout stability. The judgment ring must sit at the same *visual* spot at
 *     every window size, or muscle memory breaks when you resize.
 *   • Crisp lines. We snap the backing store to exact device pixels so the thick
 *     ink outlines of the art style stay sharp instead of turning into grey mush
 *     on a fractional-DPR display.
 *
 * The camera supports shake and punch (uniform zoom). Both are *cosmetic only* —
 * they never touch gameplay coordinates, so a screen shake can never cause a
 * missed read of an incoming cue.
 */

export const VW = 960;
export const VH = 540;

export class View {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    // `desynchronized: true` lets the browser skip a compositing step where it
    // can. On supporting platforms it measurably reduces the delay between
    // drawing a hit flash and the player seeing it.

    this.scale = 1;
    this.dpr = 1;

    // Camera state
    this.shakeAmp = 0;
    this.shakeDecay = 8;
    this.shakePhase = Math.random() * 1000;
    this.punch = 0;        // extra zoom, decays
    this.tilt = 0;
    this.offsetX = 0;
    this.offsetY = 0;

    this._onResize = this.resize.bind(this);
    window.addEventListener('resize', this._onResize);
    this.resize();
  }

  destroy() { window.removeEventListener('resize', this._onResize); }

  /**
   * Blit a low-resolution indexed Framebuffer (see gfx/raster.js) so it fills
   * the virtual 960×540 play area.
   *
   * Two details matter and both are easy to get wrong:
   *
   *   • `imageSmoothingEnabled = false`. Without it the browser bilinearly
   *     interpolates the upscale and every hard pixel edge turns to mush —
   *     which destroys the entire point of rendering at 320×180.
   *   • Draw through an intermediate canvas rather than putImageData directly.
   *     putImageData ignores the current transform, so it would land in the
   *     wrong place and at the wrong size the moment the camera shakes.
   */
  blitFramebuffer(fb) {
    if (!this._fbCanvas || this._fbCanvas.width !== fb.w || this._fbCanvas.height !== fb.h) {
      this._fbCanvas = document.createElement('canvas');
      this._fbCanvas.width = fb.w;
      this._fbCanvas.height = fb.h;
      this._fbCtx = this._fbCanvas.getContext('2d');
      this._fbImage = this._fbCtx.createImageData(fb.w, fb.h);
    }
    fb.toRGBA(this._fbImage.data, 1);
    this._fbCtx.putImageData(this._fbImage, 0, 0);

    const c = this.ctx;
    const prev = c.imageSmoothingEnabled;
    c.imageSmoothingEnabled = false;
    c.drawImage(this._fbCanvas, 0, 0, VW, VH);
    c.imageSmoothingEnabled = prev;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const availW = window.innerWidth;
    const availH = window.innerHeight;
    const scale = Math.min(availW / VW, availH / VH);

    // CSS size, rounded so the letterbox is symmetric.
    const cssW = Math.round(VW * scale);
    const cssH = Math.round(VH * scale);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;

    // Backing store in whole device pixels.
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);

    this.dpr = dpr;
    this.scale = (this.canvas.width / VW);
  }

  /** Screen-space shake, in virtual units. */
  shake(amount) { this.shakeAmp = Math.max(this.shakeAmp, amount); }
  /** Zoom pop, e.g. 0.02 for a subtle beat punch. */
  kick(amount) { this.punch = Math.max(this.punch, amount); }

  update(dt) {
    this.shakeAmp *= Math.exp(-this.shakeDecay * dt);
    if (this.shakeAmp < 0.05) this.shakeAmp = 0;
    this.punch *= Math.exp(-11 * dt);
    if (this.punch < 0.0005) this.punch = 0;
    this.tilt *= Math.exp(-9 * dt);
    this.shakePhase += dt * 60;
  }

  /**
   * Begin a frame: reset transform, apply camera.
   *
   * Transform is composed once, explicitly, in this order:
   *   screen = fit-scale · translate(centre) · zoom · rotate · translate(-centre) · shake
   * so that punch-zoom and tilt both pivot on the middle of the frame rather
   * than the top-left corner.
   */
  begin() {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const cx = VW / 2, cy = VH / 2;
    const z = 1 + this.punch;

    c.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    c.translate(cx, cy);
    c.scale(z, z);
    if (this.tilt) c.rotate(this.tilt);
    c.translate(-cx, -cy);

    if (this.shakeAmp > 0) {
      // Two incommensurate sines: reads as chaotic without an RNG, and is
      // deterministic, so a replay of the same frame looks identical.
      const p = this.shakePhase;
      c.translate(
        Math.sin(p * 1.7) * this.shakeAmp,
        Math.cos(p * 2.31) * this.shakeAmp * 0.8,
      );
    }
    c.translate(this.offsetX, this.offsetY);

    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.textBaseline = 'middle';
  }
}
