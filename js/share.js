// 2D drawing of Cα traces (level thumbnails, end-screen loop, share card).
import { sampleMorph } from './morph.js';

export const HEX = { a: '#38e8ff', b: '#ffae3b' };

// Principal axes of a frame, so every protein is drawn from its widest side.
export function viewBasis(P) {
  const n = P.length / 3;
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += P[i * 3 + a] * P[i * 3 + b];
  const power = (deflate) => {
    let v = [1, 0.7, 0.3];
    for (let it = 0; it < 60; it++) {
      let w = [0, 1, 2].map(a => C[a][0] * v[0] + C[a][1] * v[1] + C[a][2] * v[2]);
      if (deflate) { const d = w[0] * deflate[0] + w[1] * deflate[1] + w[2] * deflate[2]; w = w.map((x, k) => x - d * deflate[k]); }
      const l = Math.hypot(...w) || 1; v = w.map(x => x / l);
    }
    return v;
  };
  const e1 = power(null), e2 = power(e1);
  const e3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  return [e1, e2, e3];
}

// Draw P (Float32Array n*3, Å) centred at (cx, cy) fitting `size` px, with glow.
export function drawTrace(ctx, P, cx, cy, size, color, basis, angle = 0, extent) {
  const n = P.length / 3;
  const [e1, e2, e3] = basis;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const pts = [];
  let maxR = 0;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const u = x * e1[0] + y * e1[1] + z * e1[2], v = x * e2[0] + y * e2[1] + z * e2[2], w = x * e3[0] + y * e3[1] + z * e3[2];
    const ur = u * ca + w * sa, wr = -u * sa + w * ca;
    pts.push([ur, v, wr]);
    maxR = Math.max(maxR, Math.hypot(ur, v));
  }
  const s = (size / 2) / (extent || maxR || 1);
  const zs = pts.map(p => p[2]), zmin = Math.min(...zs), zmax = Math.max(...zs);
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const pass = (width, alpha, blur) => {
    ctx.shadowColor = color; ctx.shadowBlur = blur;
    for (let i = 0; i < n - 1; i++) {
      const depth = (pts[i][2] - zmin) / ((zmax - zmin) || 1);
      ctx.globalAlpha = alpha * (0.35 + 0.65 * depth);
      ctx.strokeStyle = color; ctx.lineWidth = width * (0.6 + 0.6 * depth);
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1];
      ctx.beginPath();
      ctx.moveTo(cx + ((p0[0] + p1[0]) / 2) * s, cy - ((p0[1] + p1[1]) / 2) * s);
      ctx.quadraticCurveTo(cx + p1[0] * s, cy - p1[1] * s, cx + ((p1[0] + p2[0]) / 2) * s, cy - ((p1[1] + p2[1]) / 2) * s);
      ctx.stroke();
    }
  };
  pass(size / 28, 0.25, size / 10);
  pass(size / 80, 1, 0);
  ctx.restore();
  return maxR;
}

export function frameExtent(frames, basis) {
  let m = 0;
  for (const P of frames) for (let i = 0; i < P.length; i += 3) {
    const [e1, e2] = basis;
    const u = P[i] * e1[0] + P[i + 1] * e1[1] + P[i + 2] * e1[2], v = P[i] * e2[0] + P[i + 1] * e2[1] + P[i + 2] * e2[2];
    m = Math.max(m, Math.hypot(u, v));
  }
  return m * 1.05;
}

// Animated morph loop for the end screen. Returns a stop() function.
export function morphLoop(canvas, protein) {
  const ctx = canvas.getContext('2d');
  const frames = protein.morph.frames;
  const basis = viewBasis(frames[0]);
  const ext = frameExtent([frames[0], frames[frames.length - 1]], basis) * 1.1;
  const buf = new Float32Array(protein.morph.n * 3);
  let raf, t0 = performance.now();
  const draw = now => {
    const T = (now - t0) / 1000;
    const ph = (T % 4) / 4;  // hold, morph, hold, morph back
    const m = ph < 0.3 ? 0 : ph < 0.5 ? (ph - 0.3) / 0.2 : ph < 0.8 ? 1 : 1 - (ph - 0.8) / 0.2;
    const e = m * m * (3 - 2 * m);
    sampleMorph(protein.morph, e, buf);
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    drawTrace(ctx, buf, w / 2, h / 2, Math.min(w, h) * 0.9, mixHex(HEX.a, HEX.b, e), basis, T * 0.5, ext);
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
}

export function mixHex(a, b, t) {
  const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16)), pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16));
  return 'rgb(' + pa.map((x, i) => Math.round(x + (pb[i] - x) * t)).join(',') + ')';
}

// Both folds side by side in a small canvas (level select).
export function drawThumb(canvas, protein) {
  const ctx = canvas.getContext('2d');
  const f = protein.morph.frames, A = f[0], B = f[f.length - 1];
  const basis = viewBasis(A), ext = frameExtent([A, B], basis);
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  drawTrace(ctx, A, w * 0.27, h / 2, Math.min(w * 0.46, h * 0.92), HEX.a, basis, 0.3, ext);
  drawTrace(ctx, B, w * 0.73, h / 2, Math.min(w * 0.46, h * 0.92), HEX.b, basis, 0.3, ext);
}

// 1200×630 share card.
export function makeCard({ level, protein, score, best, mode, result, url }) {
  const W = 1200, H = 630;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#070912'); bg.addColorStop(1, '#0b0f1e');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  // faint dot field
  for (let i = 0; i < 160; i++) {
    g.globalAlpha = 0.08 + Math.random() * 0.15; g.fillStyle = Math.random() < 0.5 ? HEX.a : HEX.b;
    g.beginPath(); g.arc(Math.random() * W, Math.random() * H, Math.random() * 2 + 0.5, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
  const f = protein.morph.frames, A = f[0], B = f[f.length - 1];
  const basis = viewBasis(A), ext = frameExtent([A, B], basis);
  drawTrace(g, A, 300, 330, 400, HEX.a, basis, 0.3, ext);
  drawTrace(g, B, 900, 330, 400, HEX.b, basis, 0.3, ext);
  // arrow
  g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(545, 330); g.lineTo(655, 330); g.moveTo(640, 318); g.lineTo(655, 330); g.lineTo(640, 342); g.stroke();
  g.beginPath(); g.moveTo(655, 352); g.lineTo(545, 352); g.moveTo(560, 340); g.lineTo(545, 352); g.lineTo(560, 364); g.stroke();
  const font = (w, s) => `${w} ${s}px "Space Grotesk", system-ui, sans-serif`;
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#fff'; g.font = font(700, 54); g.fillText('METAMORPH', 60, 92);
  g.font = font(400, 24); g.fillStyle = 'rgba(255,255,255,0.65)';
  g.fillText(mode === 'endless' ? 'Endless mode' : `${level.full} · ${result}`, 62, 130);
  g.textAlign = 'right'; g.fillStyle = '#fff'; g.font = font(700, 64); g.fillText(score.toLocaleString(), W - 60, 96);
  g.font = font(400, 22); g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillText(`best ${best.toLocaleString()}`, W - 62, 130);
  g.textAlign = 'center'; g.font = font(600, 26);
  const names = level.folds || [{ name: 'fold A', pdb: protein.pdbA }, { name: 'fold B', pdb: protein.pdbB }];
  g.fillStyle = HEX.a; g.fillText(names[0].name, 300, 560);
  g.fillStyle = HEX.b; g.fillText(names[1].name, 900, 560);
  g.font = font(400, 20); g.fillStyle = 'rgba(255,255,255,0.5)';
  g.fillText(`PDB ${protein.pdbA}`, 300, 590); g.fillText(`PDB ${protein.pdbB}`, 900, 590);
  g.fillText('One sequence, two folds. Play: ' + url, W / 2, 618);
  return c;
}
