// The sticky 3D viewer: one protein at a time as a matte cartoon, coloured by
// secondary structure (re-assigned along the morph), with drag-to-rotate.
import * as THREE from 'three';
import { sampleMorph } from './morph.js';
import { Cartoon, SS_COLORS } from './cartoon.js';

const PROFILE = [[0.32, 0.32], [1.15, 0.22], [1.05, 0.26]];
const CLASH = new THREE.Color('#ff5a5f');

export class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 1, 1000);
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2018, 1.35));
    const key = new THREE.DirectionalLight(0xffffff, 1.9); key.position.set(40, 60, 80); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fc7ff, 0.8); rim.position.set(-60, -20, -50); this.scene.add(rim);
    this.pivot = new THREE.Group(); this.scene.add(this.pivot);
    this.inner = new THREE.Group(); this.pivot.add(this.inner);
    this.rotY = 0.6; this.rotX = 0.15; this.velY = 0; this.auto = 0.12; this.dragging = false;
    this.t = 0; this.target = 0; this.highlightMoving = false; this.useLinear = false;
    this.zoomK = 1;
    this.protein = null; this.cartoon = null;
    this.bindDrag();
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fit();
  }

  fit() {
    if (!this.protein) return;
    const R = this.protein.maxR * 1.12 + 2;
    const fovV = THREE.MathUtils.degToRad(this.camera.fov);
    const fovH = 2 * Math.atan(Math.tan(fovV / 2) * this.camera.aspect);
    const dist = R / Math.sin(Math.min(fovV, fovH) / 2);
    this.camDist = dist / this.zoomK;
    this.camera.position.set(0, 0, this.camDist);
    this.camera.near = Math.max(1, this.camDist - R * 3); this.camera.far = this.camDist + R * 3;
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
  }

  bindDrag() {
    const c = this.canvas;
    let lx = 0, ly = 0, id = null, horizontal = null;
    c.addEventListener('pointerdown', e => { id = e.pointerId; lx = e.clientX; ly = e.clientY; horizontal = e.pointerType === 'mouse' ? true : null; this.dragging = true; });
    addEventListener('pointermove', e => {
      if (e.pointerId !== id) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      // on touch, only claim mostly-horizontal drags so the page still scrolls
      if (horizontal === null && Math.hypot(dx, dy) > 6) { horizontal = Math.abs(dx) > Math.abs(dy); if (horizontal) c.setPointerCapture(id); }
      if (!horizontal) return;
      lx = e.clientX; ly = e.clientY;
      this.rotY += dx * 0.008; this.velY = dx * 0.008;
      if (e.pointerType === 'mouse') this.rotX = Math.max(-1.2, Math.min(1.2, this.rotX + dy * 0.006));
    });
    const up = e => { if (e.pointerId === id) { id = null; this.dragging = false; } };
    addEventListener('pointerup', up); addEventListener('pointercancel', up);
  }

  setProtein(p) {
    if (this.protein === p) return;
    if (this.cartoon) { this.inner.remove(this.cartoon.mesh); this.cartoon.dispose(); }
    this.protein = p;
    const n = p.morph.n;
    this.cartoon = new Cartoon(n);
    this.inner.add(this.cartoon.mesh);
    this.P = new Float32Array(n * 3);
    this.prof = new Float32Array(n * 2);
    this.rgb = new Float32Array(n * 3);
    this.arrow = new Uint8Array(n);
    this.curProf = null;   // smoothed profile, initialised on first draw
    this.clash = new Float32Array(n);
    this.fit();
    this.draw(0, true);
  }

  morph() { return this.useLinear ? this.protein.linear() : this.protein.morph; }

  // Closest non-bonded Cα–Cα approach, marking residues closer than 3 Å.
  measureClashes() {
    const P = this.P, n = this.protein.morph.n;
    this.clash.fill(0);
    let min = Infinity;
    for (let i = 0; i < n; i++) for (let j = i + 3; j < n; j++) {
      const dd = Math.hypot(P[i * 3] - P[j * 3], P[i * 3 + 1] - P[j * 3 + 1], P[i * 3 + 2] - P[j * 3 + 2]);
      if (dd < min) min = dd;
      if (dd < 3) { this.clash[i] = 1; this.clash[j] = 1; }
    }
    return min;
  }

  draw(dt, snap = false) {
    const p = this.protein; if (!p) return;
    const m = this.morph();
    sampleMorph(m, this.t, this.P);
    const F = m.frames.length;
    const fi = Math.round(this.t * (F - 1));
    const ss = (m.ss || p.ss)[Math.min(F - 1, Math.max(0, fi))];
    const n = m.n;
    if (!this.curProf || snap) { this.curProf = new Float32Array(n * 2); this.curCol = new Float32Array(n * 3); snap = true; }
    const k = snap ? 1 : 1 - Math.exp(-dt * 14);
    this.minDist = this.showClashes ? this.measureClashes() : null;
    for (let i = 0; i < n; i++) {
      const pr = PROFILE[ss[i]];
      this.curProf[i * 2] += (pr[0] - this.curProf[i * 2]) * k;
      this.curProf[i * 2 + 1] += (pr[1] - this.curProf[i * 2 + 1]) * k;
      let col = SS_COLORS[ss[i]];
      if (this.showClashes && this.clash[i]) col = CLASH;
      // optionally fade residues that barely move so the switching region stands out
      const dim = this.highlightMoving ? 0.28 + 0.72 * Math.min(1, p.morph.disp[i] * 1.6) : 1;
      this.curCol[i * 3] += (col.r * dim - this.curCol[i * 3]) * k;
      this.curCol[i * 3 + 1] += (col.g * dim - this.curCol[i * 3 + 1]) * k;
      this.curCol[i * 3 + 2] += (col.b * dim - this.curCol[i * 3 + 2]) * k;
      this.arrow[i] = ss[i] === 2 && (i === n - 1 || ss[i + 1] !== 2) ? 1 : 0;
    }
    this.cartoon.update(this.P, this.curProf, this.curCol, this.arrow, p.breaks);
  }

  frame(dt) {
    if (!this.protein) return;
    // ease the morph toward its target (widgets set target; scrub sets t directly)
    if (this.target !== null) {
      const diff = this.target - this.t;
      const step = Math.sign(diff) * Math.min(Math.abs(diff), dt / (this.morphSeconds || 1.2));
      this.t += step;
    }
    if (!this.dragging) { this.velY *= 0.94; this.rotY += this.velY + this.auto * dt; }
    this.pivot.rotation.set(this.rotX, this.rotY, 0);
    this.draw(dt);
    this.renderer.render(this.scene, this.camera);
  }
}
