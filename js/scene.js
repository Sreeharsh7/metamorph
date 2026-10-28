// Three.js world: the protein character (a glowing Cα tube rebuilt from morph
// frames), obstacles, zones, particles and bloom.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { sampleMorph } from './morph.js';

export const COLORS = {
  a: new THREE.Color('#38e8ff'),   // Spring fold
  b: new THREE.Color('#ffae3b'),   // Shell fold
  hazard: new THREE.Color('#ff5470'),
  atp: new THREE.Color('#b8ffcf'),
  bgDay: new THREE.Color('#1b2846'),
  bgNight: new THREE.Color('#04050a'),
};

// ---------- tube ----------
class Tube {
  constructor(n, segs = 4, radial = 7, radius = 0.05) {
    this.n = n; this.S = segs; this.R = radial; this.radius = radius;
    this.M = (n - 1) * segs + 1;
    const vcount = this.M * radial;
    this.pos = new Float32Array(vcount * 3);
    this.col = new Float32Array(vcount * 3);
    this.samples = new Float32Array(this.M * 3);
    const idx = [];
    for (let s = 0; s < this.M - 1; s++) for (let r = 0; r < radial; r++) {
      const a = s * radial + r, b = s * radial + ((r + 1) % radial), c = a + radial, d = b + radial;
      idx.push(a, c, b, b, c, d);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
    this.mesh.frustumCulled = false;
  }
  // P: Float32Array n*3 (already scaled); rgb: Float32Array n*3 per residue
  update(P, rgb) {
    const { n, S, R, M, samples: Q } = this;
    const g = (i, k) => P[Math.min(n - 1, Math.max(0, i)) * 3 + k];
    let m = 0;
    for (let i = 0; i < n - 1; i++) {
      for (let s = 0; s < S; s++, m++) {
        const t = s / S, t2 = t * t, t3 = t2 * t;
        for (let k = 0; k < 3; k++) {
          const p0 = g(i - 1, k), p1 = g(i, k), p2 = g(i + 1, k), p3 = g(i + 2, k);
          Q[m * 3 + k] = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
        }
      }
    }
    for (let k = 0; k < 3; k++) Q[m * 3 + k] = P[(n - 1) * 3 + k];
    // parallel-transport frames
    let nx = 0, ny = 0, nz = 0;
    for (let s = 0; s < M; s++) {
      const a = Math.max(0, s - 1), b = Math.min(M - 1, s + 1);
      let tx = Q[b * 3] - Q[a * 3], ty = Q[b * 3 + 1] - Q[a * 3 + 1], tz = Q[b * 3 + 2] - Q[a * 3 + 2];
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      if (s === 0) { // any perpendicular
        if (Math.abs(tx) < 0.9) { nx = 0; ny = -tz; nz = ty; } else { nx = -tz; ny = 0; nz = tx; }
      }
      // remove tangent component, renormalise
      const d = nx * tx + ny * ty + nz * tz;
      nx -= d * tx; ny -= d * ty; nz -= d * tz;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
      const res = Math.min(n - 1, Math.floor(s / S + 0.5));
      const cr = rgb[res * 3], cg = rgb[res * 3 + 1], cb = rgb[res * 3 + 2];
      for (let r = 0; r < R; r++) {
        const th = (r / R) * Math.PI * 2, c = Math.cos(th) * this.radius, si = Math.sin(th) * this.radius;
        const v = (s * R + r) * 3;
        this.pos[v] = Q[s * 3] + nx * c + bx * si;
        this.pos[v + 1] = Q[s * 3 + 1] + ny * c + by * si;
        this.pos[v + 2] = Q[s * 3 + 2] + nz * c + bz * si;
        // fake rim light: darker on the far side of the tube
        const shade = 0.72 + 0.28 * Math.cos(th);
        this.col[v] = cr * shade; this.col[v + 1] = cg * shade; this.col[v + 2] = cb * shade;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
  dispose() { this.geo.dispose(); this.mesh.material.dispose(); }
}

function dotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.35, 'rgba(255,255,255,0.5)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function labelTexture(text, sub, color) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.textAlign = 'center';
  g.fillStyle = color; g.font = '600 44px "Space Grotesk", system-ui, sans-serif';
  g.fillText(text.toUpperCase(), 256, 54);
  g.globalAlpha = 0.75; g.font = '400 30px "Space Grotesk", system-ui, sans-serif';
  g.fillText(sub, 256, 100);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- scene ----------
export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.setClearColor(0x05060b, 1);
    this.scene = new THREE.Scene();
    this.scene.background = COLORS.bgNight.clone();
    this.scene.fog = new THREE.Fog(0x05060b, 18, 60);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    this.quality = 1;
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.4, 0.42);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.dot = dotTexture();
    this.shake = 0;
    this.camX = 0;
    this.menuMode = true;

    this.player = new THREE.Group();
    this.scene.add(this.player);
    this.spin = new THREE.Group();
    this.player.add(this.spin);
    this.tube = null;

    this.items = new THREE.Group(); this.scene.add(this.items);
    this.zoneGroup = new THREE.Group(); this.scene.add(this.zoneGroup);
    this.buildBackground();
    this.buildParticles();
    this.shared = this.buildShared();
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  setQuality(q) {
    this.quality = q;
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    const pr = Math.min(devicePixelRatio || 1, this.quality > 0 ? 1.5 : 1);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;
    // keep at least ~13 units of horizontal play area on narrow screens
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const minW = this.camera.aspect < 1 ? 11 : 13;
    const visH = Math.max(9.5, minW / this.camera.aspect);
    this.visW = visH * this.camera.aspect;
    this.camDist = visH / 2 / tan;
    this.visH = visH;
    this.camera.updateProjectionMatrix();
  }

  buildBackground() {
    // ground: bright line + faint perspective grid
    const lineGeo = new THREE.BoxGeometry(400, 0.03, 0.03);
    this.ground = new THREE.Mesh(lineGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.22, 0.32, 0.55), toneMapped: false }));
    this.ground.position.y = -0.02;
    this.scene.add(this.ground);
    const pts = [];
    for (let i = -40; i <= 40; i++) { pts.push(i, 0, 1.5, i * 1.6, 0, -14); }
    for (let k = 0; k < 8; k++) { const z = -k * k * 0.25; pts.push(-60, 0, z, 60, 0, z); }
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.grid = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0x1a2a4a, transparent: true, opacity: 0.55 }));
    this.grid.position.y = -0.03;
    this.scene.add(this.grid);
    // drifting background motes (solvent, other molecules)
    const N = 260;
    const p = new Float32Array(N * 3), c = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      p[i * 3] = (Math.random() - 0.5) * 90; p[i * 3 + 1] = Math.random() * 16 - 2; p[i * 3 + 2] = -4 - Math.random() * 30;
      const t = Math.random(); const col = new THREE.Color().lerpColors(COLORS.a, COLORS.b, t).multiplyScalar(0.25 + Math.random() * 0.35);
      c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b;
    }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(p, 3)); mg.setAttribute('color', new THREE.BufferAttribute(c, 3));
    this.motes = new THREE.Points(mg, new THREE.PointsMaterial({ size: 0.35, map: this.dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.motes.frustumCulled = false;
    this.scene.add(this.motes);
  }

  buildParticles() {
    const N = 700;
    this.pN = N; this.pi = 0;
    this.pPos = new Float32Array(N * 3); this.pCol = new Float32Array(N * 3);
    this.pVel = new Float32Array(N * 3); this.pLife = new Float32Array(N); this.pBase = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) this.pPos[i * 3 + 1] = -999;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.particles = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.22, map: this.dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);
  }

  emit(x, y, z, color, count, speed = 4, life = 0.8, spread = 1) {
    for (let k = 0; k < count; k++) {
      const i = this.pi; this.pi = (this.pi + 1) % this.pN;
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1), s = speed * (0.3 + Math.random() * 0.7);
      this.pPos[i * 3] = x + (Math.random() - 0.5) * 0.2 * spread; this.pPos[i * 3 + 1] = y + (Math.random() - 0.5) * 0.2 * spread; this.pPos[i * 3 + 2] = z;
      this.pVel[i * 3] = Math.sin(ph) * Math.cos(th) * s; this.pVel[i * 3 + 1] = Math.sin(ph) * Math.sin(th) * s; this.pVel[i * 3 + 2] = Math.cos(ph) * s * 0.5;
      this.pLife[i] = life * (0.6 + Math.random() * 0.6);
      this.pBase[i * 3] = color.r * 1.6; this.pBase[i * 3 + 1] = color.g * 1.6; this.pBase[i * 3 + 2] = color.b * 1.6;
    }
  }

  updateParticles(dt) {
    for (let i = 0; i < this.pN; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      const a = Math.max(0, this.pLife[i]);
      this.pPos[i * 3] += this.pVel[i * 3] * dt; this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt; this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
      this.pVel[i * 3] *= 0.96; this.pVel[i * 3 + 1] = this.pVel[i * 3 + 1] * 0.96 - dt * 1.5; this.pVel[i * 3 + 2] *= 0.96;
      const f = Math.min(1, a * 2);
      this.pCol[i * 3] = this.pBase[i * 3] * f; this.pCol[i * 3 + 1] = this.pBase[i * 3 + 1] * f; this.pCol[i * 3 + 2] = this.pBase[i * 3 + 2] * f;
      if (a <= 0) this.pPos[i * 3 + 1] = -999;
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
    this.particles.geometry.attributes.color.needsUpdate = true;
  }

  // ---------- protein ----------
  setProtein(data) {
    if (this.tube) { this.spin.remove(this.tube.mesh); this.tube.dispose(); }
    this.protein = data;
    const n = data.morph.n;
    // thinner tube for bigger proteins so the fold stays legible
    const radius = n > 150 ? 0.028 : n > 80 ? 0.036 : 0.045;
    this.tube = new Tube(n, n > 150 ? 3 : 4, 6, radius);
    this.spin.add(this.tube.mesh);
    this.scale = 1.0 / data.maxR;
    this.tube.mesh.scale.setScalar(1);
    this.raw = new Float32Array(n * 3);
    this.scaled = new Float32Array(n * 3);
    this.rgb = new Float32Array(n * 3);
    this.drawProtein(0, 0, 0, 0);
  }

  // t: morph progress 0..1; glow: 0..1 morph pulse; time: seconds; hurt: 0..1 red flash
  drawProtein(t, glow, time, hurt) {
    const d = this.protein; if (!d) return;
    sampleMorph(d.morph, t, this.raw);
    const s = this.scale, n = d.morph.n;
    for (let i = 0; i < n * 3; i++) this.scaled[i] = this.raw[i] * s;
    const base = new THREE.Color().lerpColors(COLORS.a, COLORS.b, t);
    for (let i = 0; i < n; i++) {
      const shimmer = 0.62 + 0.2 * Math.sin(i * 0.45 - time * 5);
      const g = d.morph.disp[i] * glow * 3.2;
      let r = base.r * shimmer + g, gg = base.g * shimmer + g, b = base.b * shimmer + g * 0.9;
      if (hurt > 0) { r = r * (1 - hurt) + 2.2 * hurt; gg *= 1 - hurt * 0.8; b *= 1 - hurt * 0.7; }
      this.rgb[i * 3] = r; this.rgb[i * 3 + 1] = gg; this.rgb[i * 3 + 2] = b;
    }
    this.tube.update(this.scaled, this.rgb);
  }

  // ---------- items ----------
  buildShared() {
    const mat = (c, o = 1, add = false) => new THREE.MeshBasicMaterial({ color: c, transparent: o < 1 || add, opacity: o, depthWrite: !add && o >= 1, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: false });
    const edge = c => new THREE.LineBasicMaterial({ color: c.clone().multiplyScalar(1.8), toneMapped: false });
    return {
      wallFill: mat(COLORS.a.clone().multiplyScalar(0.18)), wallEdge: edge(COLORS.a),
      barFill: mat(COLORS.b.clone().multiplyScalar(0.35)), barEdge: edge(COLORS.b), barVeil: mat(COLORS.b.clone().multiplyScalar(0.25), 0.07, true),
      hazard: new THREE.MeshBasicMaterial({ color: COLORS.hazard.clone().multiplyScalar(1.6), wireframe: true, toneMapped: false }),
      hazardCore: mat(COLORS.hazard.clone().multiplyScalar(0.5), 0.5, true),
      gateA: mat(COLORS.a, 0.22, true), gateB: mat(COLORS.b, 0.22, true),
      atp: mat(COLORS.atp.clone().multiplyScalar(1.7)),
      pickA: mat(COLORS.a.clone().multiplyScalar(1.8)), pickB: mat(COLORS.b.clone().multiplyScalar(1.8)), salt: mat(new THREE.Color(2, 2, 2.2)),
      octa: new THREE.OctahedronGeometry(0.22), spike: new THREE.IcosahedronGeometry(0.34, 0), ring: new THREE.TorusGeometry(0.45, 0.07, 8, 28),
      knot: new THREE.TorusKnotGeometry(0.26, 0.06, 64, 6), cube: new THREE.BoxGeometry(0.3, 0.3, 0.3), sphere: new THREE.SphereGeometry(0.12, 10, 8),
    };
  }

  boxWithEdges(w, h, d, fill, edgeMat) {
    const g = new THREE.Group();
    const geo = new THREE.BoxGeometry(w, h, d);
    g.add(new THREE.Mesh(geo, fill));
    g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat));
    g.userData.dispose = [geo];
    return g;
  }

  spawn(it) {
    const S = this.shared;
    let m;
    switch (it.type) {
      case 'wall':
        m = this.boxWithEdges(it.w, it.h, 1.2, S.wallFill, S.wallEdge);
        m.position.set(it.x, it.h / 2, 0);
        break;
      case 'bar': {
        // glowing beam at the ceiling height, faint blocked column above it
        m = new THREE.Group();
        const beam = this.boxWithEdges(it.w, 0.4, 1.2, S.barFill, S.barEdge);
        beam.position.y = it.y0 + 0.2;
        const h = 7 - it.y0 - 0.4;
        const geo = new THREE.BoxGeometry(it.w, h, 1.2);
        const veil = new THREE.Mesh(geo, S.barVeil);
        veil.position.y = it.y0 + 0.4 + h / 2;
        m.add(beam, veil);
        m.position.set(it.x, 0, 0);
        m.userData.dispose = [geo, ...beam.userData.dispose];
        break;
      }
      case 'protease':
        m = new THREE.Group();
        for (let k = 0; k < 7; k++) {
          const s = new THREE.Mesh(S.spike, S.hazard);
          s.position.set(Math.sin(k * 2.1) * 0.15, 0.35 + k * 0.85, Math.cos(k * 1.7) * 0.2);
          s.userData.spin = 1 + (k % 3);
          m.add(s);
        }
        m.position.set(it.x, 0, 0);
        m.userData.spinner = true;
        break;
      case 'gate': {
        const geo = new THREE.BoxGeometry(0.25, 7, 1.4);
        m = new THREE.Mesh(geo, it.fold ? S.gateB : S.gateA);
        m.position.set(it.x, 3.5, 0);
        m.userData.dispose = [geo];
        break;
      }
      case 'pickup': {
        const k = it.kind;
        if (k === 'atp') m = new THREE.Mesh(S.octa, S.atp);
        else if (k === 'ribosome') { m = new THREE.Mesh(S.ring, S.pickB); m.scale.setScalar(1.15); }
        else if (k === 'xcr1') m = new THREE.Mesh(S.ring, S.pickA);
        else if (k === 'heparin') {
          m = new THREE.Group();
          for (let j = 0; j < 6; j++) { const s = new THREE.Mesh(S.sphere, S.pickB); s.position.set((j - 2.5) * 0.2, Math.sin(j * 1.3) * 0.12, 0); m.add(s); }
        } else if (k === 'cdc20') m = new THREE.Mesh(S.knot, S.pickB);
        else if (k === 'salt') m = new THREE.Mesh(S.cube, S.salt);
        m.position.set(it.x, it.y, 0);
        m.userData.bob = it.y;
        break;
      }
      case 'finish': {
        const geo = new THREE.BoxGeometry(0.12, 7, 2);
        m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.6, 1.8), transparent: true, opacity: 0.5, toneMapped: false }));
        m.position.set(it.x, 3.5, 0);
        m.userData.dispose = [geo];
        break;
      }
    }
    if (m) { this.items.add(m); it.mesh = m; }
  }

  despawn(it) {
    const m = it.mesh; if (!m) return;
    this.items.remove(m);
    (m.userData.dispose || []).forEach(g => g.dispose());
    it.mesh = null;
  }

  spawnZone(z, colorHex) {
    const w = z.x1 - z.x0;
    const g = new THREE.Group();
    const col = new THREE.Color(colorHex);
    const geo = new THREE.PlaneGeometry(w, 8);
    // soft field: bright near the ground, fading up and feathered at both ends
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const cx = c.getContext('2d'); const img = cx.createImageData(64, 64);
    const feather = Math.min(0.45, 1.5 / w);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const u = x / 63, v = 1 - y / 63;
      const ex = Math.min(1, Math.min(u, 1 - u) / feather);
      const a = Math.pow(1 - v, 2.2) * ex * ex * (3 - 2 * ex);
      const i = (y * 64 + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = a * 255;
    }
    cx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    const plane = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col, map: tex, transparent: true, opacity: 0.13, depthWrite: false, blending: THREE.AdditiveBlending }));
    plane.position.set(0, 4 - 0.05, -1.6);
    g.add(plane);
    const lt = labelTexture(z.label, z.sub || '', '#' + col.getHexString());
    const lgeo = new THREE.PlaneGeometry(3.2, 0.8);
    const label = new THREE.Mesh(lgeo, new THREE.MeshBasicMaterial({ map: lt, transparent: true, depthWrite: false }));
    label.position.set(Math.min(0, -w / 2 + 1.8), 5.2, -1.5);
    g.add(label);
    g.position.x = (z.x0 + z.x1) / 2;
    g.userData.dispose = [geo, lgeo, tex, lt, plane.material, label.material];
    this.zoneGroup.add(g);
    z.mesh = g;
  }

  despawnZone(z) {
    if (!z.mesh) return;
    this.zoneGroup.remove(z.mesh);
    z.mesh.userData.dispose.forEach(o => o.dispose());
    z.mesh = null;
  }

  clearAll(items, zones) {
    items.forEach(it => this.despawn(it));
    zones.forEach(z => this.despawnZone(z));
  }

  // ---------- per-frame ----------
  frame(dt, time, s) {
    // s: { px, py, form (0..1 visual), morphT, glow, hurt, rolling, menu, night, lookAhead }
    this.drawProtein(s.morphT, s.glow, time, s.hurt);
    const shellK = s.form;
    const scale = 1 - 0.28 * shellK;
    this.player.scale.setScalar(scale * (1 + s.glow * 0.18));
    this.player.position.set(s.px, s.py + 0.85 * scale + (s.menu ? 0 : 0.03), 0);
    // Spring: lazy turntable; Shell: roll with distance travelled
    this.spin.rotation.y += dt * (0.7 + s.glow * 9) * (1 - shellK * 0.6);
    this.spin.rotation.z = -s.roll * shellK;
    this.spin.rotation.x = Math.sin(time * 0.7) * 0.25;

    this.ground.visible = this.grid.visible = !s.menu;
    if (s.menu) {
      // protein floats in the upper third, above the logo
      this.camX = s.px;
      const d = Math.max(5.8, 4.2 / this.camera.aspect);
      const lift = d * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 0.5;
      this.camera.position.set(s.px, 1.15 - lift, d);
      this.camera.lookAt(s.px, 1.15 - lift, 0);
    } else {
      const target = s.px + this.visW * 0.31;   // player sits ~19% from the left edge
      this.camX += (target - this.camX) * Math.min(1, dt * 6);
      const sh = this.shake; this.shake = Math.max(0, this.shake - dt * 2.5);
      const groundFrac = 0.27;   // ground sits ~27% up from the bottom
      const cy = this.visH * (0.5 - groundFrac);
      this.camera.position.set(this.camX + (Math.random() - 0.5) * sh, cy + (Math.random() - 0.5) * sh, this.camDist);
      this.camera.lookAt(this.camX, cy, 0);
    }
    this.ground.position.x = this.camX;
    this.grid.position.x = Math.round(this.camX / 1.6) * 1.6;
    // wrap motes around the camera
    const mp = this.motes.geometry.attributes.position.array;
    for (let i = 0; i < mp.length; i += 3) {
      if (mp[i] < this.camX - 45) mp[i] += 90; else if (mp[i] > this.camX + 45) mp[i] -= 90;
      mp[i + 1] += Math.sin(time * 0.3 + i) * dt * 0.05;
    }
    this.motes.geometry.attributes.position.needsUpdate = true;
    // background: day/night tint
    this.scene.background.lerpColors(COLORS.bgNight, COLORS.bgDay, s.day || 0);
    this.scene.fog.color.copy(this.scene.background);
    // animate items
    for (const m of this.items.children) {
      if (m.userData.spinner) m.children.forEach(c => { c.rotation.x += dt * c.userData.spin; c.rotation.y += dt * 1.3; });
      if (m.userData.bob !== undefined) { m.rotation.y += dt * 2; m.position.y = m.userData.bob + Math.sin(time * 3 + m.position.x) * 0.1; }
    }
    this.updateParticles(dt);
    if (this.quality > 0) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}
