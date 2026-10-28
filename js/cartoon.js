// Cartoon ribbons from Cα-only coordinates.
// Secondary structure comes from Cα geometry (P-SEA-style distance windows plus
// a strand-pairing check), so it can be re-assigned on every morph frame and
// the ribbons visibly change from helix to coil to strand during a switch.
import * as THREE from 'three';

import { assignSS } from './ss.js';
export { assignSS };

// ---------- ribbon profile ----------
// half-width / half-thickness in Å for coil, helix, strand
const PROFILE = [[0.32, 0.32], [1.15, 0.22], [1.05, 0.26]];
export const SS_COLORS = [new THREE.Color('#8f97a8'), new THREE.Color('#5cb8b2'), new THREE.Color('#e8b46a')];

export class Cartoon {
  constructor(n, opts = {}) {
    this.n = n;
    this.S = opts.samples || (n > 150 ? 5 : 7);
    this.R = opts.radial || 10;
    this.M = (n - 1) * this.S + 1;
    const V = this.M * this.R;
    this.pos = new Float32Array(V * 3);
    this.nor = new Float32Array(V * 3);
    this.col = new Float32Array(V * 3);
    this.q = new Float32Array(this.M * 3);   // spline samples
    this.g = new Float32Array(this.M * 3);   // guide (surface normal) samples
    this.w = new Float32Array(this.M); this.h = new Float32Array(this.M);
    this.c = new Float32Array(this.M * 3);
    const idx = [];
    for (let s = 0; s < this.M - 1; s++) for (let r = 0; r < this.R; r++) {
      const a = s * this.R + r, b = s * this.R + ((r + 1) % this.R);
      idx.push(a, a + this.R, b, b, a + this.R, b + this.R);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(idx);
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
  }

  // P: Float32Array n*3 (Å). prof: Float32Array n*2 per-residue [halfWidth, halfThick].
  // rgb: Float32Array n*3. arrow: Uint8Array n (1 on the last residue of a strand).
  update(P, prof, rgb, arrow, breaks) {
    const { n, S, R, M, q, g } = this;
    const at = (i, k) => P[Math.min(n - 1, Math.max(0, i)) * 3 + k];
    // guide vectors per residue: points from the neighbours' midpoint to the Cα
    // (radially outward on a helix, along the pleat on a strand)
    const G = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      let x = 2 * at(i, 0) - at(a, 0) - at(b, 0), y = 2 * at(i, 1) - at(a, 1) - at(b, 1), z = 2 * at(i, 2) - at(a, 2) - at(b, 2);
      const l = Math.hypot(x, y, z);
      if (l < 1e-3 && i > 0) { x = G[(i - 1) * 3]; y = G[(i - 1) * 3 + 1]; z = G[(i - 1) * 3 + 2]; }
      else { x /= l || 1; y /= l || 1; z /= l || 1; }
      // keep successive guides on the same side (strands zig-zag)
      if (i > 0 && x * G[(i - 1) * 3] + y * G[(i - 1) * 3 + 1] + z * G[(i - 1) * 3 + 2] < 0) { x = -x; y = -y; z = -z; }
      G[i * 3] = x; G[i * 3 + 1] = y; G[i * 3 + 2] = z;
    }
    // smooth guides (flattens strands, keeps helices)
    const Gs = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      Gs[i * 3 + k] = G[a * 3 + k] * 0.25 + G[i * 3 + k] * 0.5 + G[b * 3 + k] * 0.25;
    }
    const gat = (i, k) => Gs[Math.min(n - 1, Math.max(0, i)) * 3 + k];
    let m = 0;
    for (let i = 0; i < n - 1; i++) {
      const wi = prof[i * 2], hi = prof[i * 2 + 1], wj = prof[(i + 1) * 2], hj = prof[(i + 1) * 2 + 1];
      for (let s = 0; s < S; s++, m++) {
        const t = s / S, t2 = t * t, t3 = t2 * t;
        for (let k = 0; k < 3; k++) {
          const p0 = at(i - 1, k), p1 = at(i, k), p2 = at(i + 1, k), p3 = at(i + 2, k);
          q[m * 3 + k] = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
          g[m * 3 + k] = gat(i, k) * (1 - t) + gat(i + 1, k) * t;
          this.c[m * 3 + k] = rgb[i * 3 + k] * (1 - t) + rgb[(i + 1) * 3 + k] * t;
        }
        const e = t * t * (3 - 2 * t);
        let w = wi + (wj - wi) * e, h = hi + (hj - hi) * e;
        if (arrow[i]) { w = prof[i * 2] * 1.55 * (1 - t) + 0.25 * t; h = hi; }    // arrowhead
        this.w[m] = w; this.h[m] = h;
      }
    }
    for (let k = 0; k < 3; k++) { q[m * 3 + k] = P[(n - 1) * 3 + k]; g[m * 3 + k] = gat(n - 1, k); this.c[m * 3 + k] = rgb[(n - 1) * 3 + k]; }
    this.w[m] = prof[(n - 1) * 2]; this.h[m] = prof[(n - 1) * 2 + 1];

    for (let s = 0; s < M; s++) {
      const a = Math.max(0, s - 1), b = Math.min(M - 1, s + 1);
      let tx = q[b * 3] - q[a * 3], ty = q[b * 3 + 1] - q[a * 3 + 1], tz = q[b * 3 + 2] - q[a * 3 + 2];
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      let nx = g[s * 3], ny = g[s * 3 + 1], nz = g[s * 3 + 2];
      const dt = nx * tx + ny * ty + nz * tz;
      nx -= dt * tx; ny -= dt * ty; nz -= dt * tz;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      // width direction lies in the ribbon plane
      const wx = ty * nz - tz * ny, wy = tz * nx - tx * nz, wz = tx * ny - ty * nx;
      const W = this.w[s], H = this.h[s];
      for (let r = 0; r < R; r++) {
        const th = (r / R) * Math.PI * 2;
        // superellipse-ish section: flat faces for ribbons, round for coil
        const c = Math.cos(th), si = Math.sin(th);
        const flat = W / H > 2 ? 0.45 : 1;
        const cc = Math.sign(c) * Math.pow(Math.abs(c), flat), ss = Math.sign(si) * Math.pow(Math.abs(si), flat);
        const v = (s * R + r) * 3;
        this.pos[v] = q[s * 3] + wx * W * cc + nx * H * ss;
        this.pos[v + 1] = q[s * 3 + 1] + wy * W * cc + ny * H * ss;
        this.pos[v + 2] = q[s * 3 + 2] + wz * W * cc + nz * H * ss;
        // section normal: gradient of the ellipse
        let ox = wx * c / W + nx * si / H, oy = wy * c / W + ny * si / H, oz = wz * c / W + nz * si / H;
        const ol = Math.hypot(ox, oy, oz) || 1;
        this.nor[v] = ox / ol; this.nor[v + 1] = oy / ol; this.nor[v + 2] = oz / ol;
        this.col[v] = this.c[s * 3]; this.col[v + 1] = this.c[s * 3 + 1]; this.col[v + 2] = this.c[s * 3 + 2];
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.normal.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    void breaks;
  }

  dispose() { this.geo.dispose(); this.material.dispose(); }
}

// Precompute per-frame secondary structure for a morph so playback is cheap.
export function morphSS(morph, breaks) {
  return morph.frames.map(f => assignSS(f, breaks));
}
