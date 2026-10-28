// Structure handling and morph generation. Pure JS, no dependencies, so it runs
// in the browser and in Node (tools/validate.mjs) with identical results.

// ---------- parsing ----------

// Parse Cα atoms of one chain from an mmCIF atom_site loop (ModelServer output).
export function parseCifCA(text, chain) {
  const cols = [];
  const out = [];
  const seen = new Set();
  for (const line of text.split('\n')) {
    if (line.startsWith('_atom_site.')) { cols.push(line.trim().slice(11)); continue; }
    if (!line.startsWith('ATOM')) continue;
    const f = line.trim().split(/\s+/);
    const r = {};
    cols.forEach((c, i) => (r[c] = f[i]));
    if (r.auth_asym_id !== chain || r.label_atom_id !== 'CA') continue;
    if (r.pdbx_PDB_model_num && r.pdbx_PDB_model_num !== '1') continue;
    if (r.label_alt_id && r.label_alt_id !== '.' && r.label_alt_id !== 'A') continue;
    const n = parseInt(r.auth_seq_id, 10);
    if (seen.has(n)) continue;
    seen.add(n);
    out.push([n, +r.Cartn_x, +r.Cartn_y, +r.Cartn_z]);
  }
  return out;
}

// ---------- geometry helpers ----------

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function centroid(P, w) {
  let s = 0, x = 0, y = 0, z = 0;
  P.forEach((p, i) => { const wi = w ? w[i] : 1; s += wi; x += p[0] * wi; y += p[1] * wi; z += p[2] * wi; });
  return [x / s, y / s, z / s];
}

// Jacobi eigen-decomposition of a symmetric 4x4 matrix; returns the eigenvector of the largest eigenvalue.
function topEigen4(M) {
  const a = M.map(r => r.slice());
  const v = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += a[p][q] * a[p][q];
    if (off < 1e-18) break;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) {
      if (Math.abs(a[p][q]) < 1e-30) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 4; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 4; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 4; k++) {
        const vkp = v[k][p], vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  let best = 0;
  for (let i = 1; i < 4; i++) if (a[i][i] > a[best][best]) best = i;
  return [v[0][best], v[1][best], v[2][best], v[3][best]];
}

// Weighted optimal rotation (Horn's quaternion method) taking centred Q onto centred P.
function bestRotation(P, Q, w) {
  let Sxx = 0, Sxy = 0, Sxz = 0, Syx = 0, Syy = 0, Syz = 0, Szx = 0, Szy = 0, Szz = 0;
  for (let i = 0; i < P.length; i++) {
    const p = P[i], q = Q[i], wi = w[i];
    Sxx += wi * q[0] * p[0]; Sxy += wi * q[0] * p[1]; Sxz += wi * q[0] * p[2];
    Syx += wi * q[1] * p[0]; Syy += wi * q[1] * p[1]; Syz += wi * q[1] * p[2];
    Szx += wi * q[2] * p[0]; Szy += wi * q[2] * p[1]; Szz += wi * q[2] * p[2];
  }
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ];
  const [q0, qx, qy, qz] = topEigen4(N);
  return [
    [q0 * q0 + qx * qx - qy * qy - qz * qz, 2 * (qx * qy - q0 * qz), 2 * (qx * qz + q0 * qy)],
    [2 * (qx * qy + q0 * qz), q0 * q0 - qx * qx + qy * qy - qz * qz, 2 * (qy * qz - q0 * qx)],
    [2 * (qx * qz - q0 * qy), 2 * (qy * qz + q0 * qx), q0 * q0 - qx * qx - qy * qy + qz * qz],
  ];
}
const rot = (R, p) => [
  R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2],
  R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2],
  R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2],
];

// ---------- pairing + superposition ----------

// resA/resB: [[authResNum, x, y, z], ...]. Returns ordered, superposed coordinates of shared residues.
export function pairStates(resA, resB, cfgA = {}, cfgB = {}) {
  const map = (res, cfg) => {
    const m = new Map();
    const [lo, hi] = cfg.range || [-1e9, 1e9];
    for (const r of res) {
      const n = r[0] + (cfg.offset || 0);
      if (n >= lo && n <= hi) m.set(n, [r[1], r[2], r[3]]);
    }
    return m;
  };
  const mA = map(resA, cfgA), mB = map(resB, cfgB);
  const nums = [...mA.keys()].filter(n => mB.has(n)).sort((a, b) => a - b);
  const { A, B } = superpose(nums.map(n => mA.get(n)), nums.map(n => mB.get(n)));
  // breaks[i] = true when residue i and i+1 are not sequence neighbours (missing residue)
  const breaks = nums.map((n, i) => i < nums.length - 1 && nums[i + 1] !== n + 1);
  return { nums, A, B, breaks };
}

// A, B: paired [[x,y,z], ...]. Returns A centred and B superposed onto it.
export function superpose(A, B) {
  // Iterative Gaussian-weighted superposition: the conserved core dominates the fit,
  // so the residues that genuinely refold show up as the ones that move.
  const cA = centroid(A);
  A = A.map(p => sub(p, cA));
  let w = A.map(() => 1);
  let Bs = B;
  for (let it = 0; it < 8; it++) {
    const cAw = centroid(A, w), cBw = centroid(B, w);
    const Ac = A.map(p => sub(p, cAw)), Bc = B.map(p => sub(p, cBw));
    const R = bestRotation(Ac, Bc, w);
    Bs = Bc.map(p => { const r = rot(R, p); return [r[0] + cAw[0], r[1] + cAw[1], r[2] + cAw[2]]; });
    w = A.map((p, i) => Math.exp(-(dist(p, Bs[i]) ** 2) / (2 * 2.5 * 2.5)) + 1e-3);
  }
  return { A, B: Bs };
}

// ---------- morph ----------

// Builds frames from A to B by targeted relaxation (a coarse-grained cousin of
// targeted MD): every step, each Cα moves toward its B position by at most
// `speed` Å, then the chain is relaxed so virtual bonds keep their length,
// i,i+2 distances stay in a physical range and non-bonded Cα never get closer
// than they are in either endpoint (capped at 4 Å). Because no atom ever jumps
// more than a fraction of the excluded-volume radius, strands slide around each
// other instead of tunnelling through, as plain linear interpolation does.
// The raw path is resampled to `frames` frames evenly spaced in RMSD.
// opts.linear = true gives plain linear interpolation (for comparison only).
export function buildMorph(A, B, breaks, opts = {}) {
  const F = opts.frames || 40;
  const speed = opts.speed || 0.35;
  const relaxIters = opts.relaxIters || 12;
  const n = A.length;
  const disp = A.map((p, i) => dist(p, B[i]));
  const maxD = Math.max(...disp);
  const result = raw => ({ frames: resample(raw, F, n), disp: disp.map(d => d / maxD), dispA: disp, n });

  if (opts.linear) {
    const raw = [];
    for (let f = 0; f < F; f++) {
      const t = f / (F - 1), Y = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) Y[i * 3 + k] = A[i][k] + (B[i][k] - A[i][k]) * t;
      raw.push(Y);
    }
    return result(raw);
  }

  const bondA = [], bondB = [];
  for (let i = 0; i < n - 1; i++) { bondA.push(dist(A[i], A[i + 1])); bondB.push(dist(B[i], B[i + 1])); }
  // per-pair minimum separation, never stricter than what either real structure shows
  const minSep = new Float32Array(n * n);
  for (let i = 0; i < n; i++) for (let j = i + 3; j < n; j++) minSep[i * n + j] = Math.min(4.0, dist(A[i], A[j]) - 0.05, dist(B[i], B[j]) - 0.05);

  const angLo = [];
  for (let i = 0; i < n - 2; i++) angLo.push(Math.min(5.0, dist(A[i], A[i + 2]), dist(B[i], B[i + 2])));
  const rmsd0 = Math.sqrt(disp.reduce((a, d) => a + d * d, 0) / n);
  const cA = centroid(A), cB = centroid(B);
  const flat = P => { const T = new Float64Array(n * 3); P.forEach((p, i) => { T[i * 3] = p[0]; T[i * 3 + 1] = p[1]; T[i * 3 + 2] = p[2]; }); return T; };
  // Copy of P with residue i pushed out from the centroid by factor 1+(f-1)*w[i]:
  // a partially unfolded version where the weighted segments have room to reroute.
  const swollen = (P, c, f, w) => flat(P.map((p, i) => { const s = 1 + (f - 1) * w[i]; return [c[0] + (p[0] - c[0]) * s, c[1] + (p[1] - c[1]) * s, c[2] + (p[2] - c[2]) * s]; }));

  // One targeted run through a list of waypoints; the last one is B and must be
  // reached. Intermediate waypoints are left once progress stalls (the bond
  // constraints stop the chain from matching an inflated target exactly).
  const run = waypoints => {
    const X = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) X[i * 3 + k] = A[i][k];
    const raw = [Float32Array.from(X)];
    let w = 0, T = waypoints[0];
    let pairs = [], stageSteps = 0, prevSq = Infinity;
    for (let step = 0; step < 2400; step++, stageSteps++) {
      if (step % 4 === 0) pairs = neighbourPairs(X, n, 9.5);
      let maxDev = 0, sq = 0, sqB = 0;
      for (let i = 0; i < n; i++) {
        const dx = T[i * 3] - X[i * 3], dy = T[i * 3 + 1] - X[i * 3 + 1], dz = T[i * 3 + 2] - X[i * 3 + 2];
        const d = Math.hypot(dx, dy, dz);
        maxDev = Math.max(maxDev, d); sq += d * d;
        sqB += (B[i][0] - X[i * 3]) ** 2 + (B[i][1] - X[i * 3 + 1]) ** 2 + (B[i][2] - X[i * 3 + 2]) ** 2;
        const s = d > speed ? speed / d : 1;
        X[i * 3] += dx * s; X[i * 3 + 1] += dy * s; X[i * 3 + 2] += dz * s;
      }
      const final = w === waypoints.length - 1;
      if (final && maxDev < 0.6) { raw.push(Float32Array.from(X)); return raw; }
      if (!final && maxDev < 2.5) { T = waypoints[++w]; stageSteps = -1; prevSq = Infinity; continue; }
      if (stageSteps % 10 === 0) {
        if (stageSteps > 0 && sq > prevSq * 0.985) {
          if (final) break;                       // stuck
          T = waypoints[++w]; stageSteps = -1; prevSq = Infinity; continue;
        }
        prevSq = sq;
      }
      const progress = Math.min(1, Math.max(0, 1 - Math.sqrt(sqB / n) / rmsd0));
      for (let it = 0; it < relaxIters; it++) {
        for (let i = 0; i < n - 1; i++) {
          if (breaks[i]) continue;
          const L = bondA[i] + (bondB[i] - bondA[i]) * progress;
          adjust(X, i, i + 1, L, L, 0.8);
        }
        for (let i = 0; i < n - 2; i++) {
          if (breaks[i] || breaks[i + 1]) continue;
          adjust(X, i, i + 2, angLo[i], 7.3, 0.4);
        }
        for (let p = 0; p < pairs.length; p += 2) adjust(X, pairs[p], pairs[p + 1], minSep[pairs[p] * n + pairs[p + 1]], Infinity, 0.8);
      }
      raw.push(Float32Array.from(X));
    }
    raw.stuck = true;
    const fin = raw[raw.length - 1];
    raw.residual = A.map((_, i) => Math.hypot(fin[i * 3] - B[i][0], fin[i * 3 + 1] - B[i][1], fin[i * 3 + 2] - B[i][2]));
    return raw;
  };

  // Waypoints that carry the moving segments around the conserved core instead
  // of through it: lift each moving residue off the surface, swing it along a
  // great circle from its A direction to its B direction, then let it dock.
  // The core just interpolates. This is the "peel off, swing over, re-pair"
  // picture of a strand changing partners (e.g. the Mad2 safety belt).
  const orbitWaypoints = (K, lift) => {
    const wMove = disp.map(d => Math.min(1, Math.max(0, (d - 3) / 4)));
    const wCore = wMove.map(x => 1 - x);
    const c = centroid(A.map((p, i) => [(p[0] + B[i][0]) / 2, (p[1] + B[i][1]) / 2, (p[2] + B[i][2]) / 2]), wCore);
    const radii = A.map((p, i) => wCore[i] > 0.5 ? dist(p, c) : 0).filter(r => r > 0).sort((a, b) => a - b);
    const rCore = radii[Math.floor(radii.length * 0.9)] || 10;
    const out = [];
    for (let k = 0; k <= K; k++) {
      const t = k / K;
      out.push(flat(A.map((a, i) => {
        const b = B[i];
        const lin = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        if (wMove[i] === 0) return lin;
        const da = sub(a, c), db = sub(b, c);
        const ra = Math.hypot(...da), rb = Math.hypot(...db);
        const ua = da.map(x => x / ra), ub = db.map(x => x / rb);
        const om = Math.acos(Math.min(1, Math.max(-1, ua[0] * ub[0] + ua[1] * ub[1] + ua[2] * ub[2])));
        let u;
        if (om < 1e-3) u = ua;
        else if (Math.PI - om < 1e-3) { // antipodal: go round any perpendicular
          const perp = Math.abs(ua[0]) < 0.9 ? [0, -ua[2], ua[1]] : [-ua[2], 0, ua[0]];
          const pl = Math.hypot(...perp), pn = perp.map(x => x / pl);
          u = ua.map((x, j) => x * Math.cos(Math.PI * t) + pn[j] * Math.sin(Math.PI * t));
        } else {
          const sa = Math.sin((1 - t) * om) / Math.sin(om), sb = Math.sin(t * om) / Math.sin(om);
          u = ua.map((x, j) => x * sa + ub[j] * sb);
        }
        const r = Math.max(ra, rb, rCore) + lift;
        const orb = u.map((x, j) => c[j] + x * r);
        const m = wMove[i];
        return lin.map((x, j) => x + (orb[j] - x) * m);
      })));
    }
    return out;
  };

  // Strategy ladder: direct; then route moving segments around the core; then
  // swell (partially unfold) the whole protein on both ends of the path.
  const Bt = flat(B);
  let raw = run([Bt]);
  raw.strategy = 'direct';
  if (raw.stuck) {
    const ones = A.map(() => 1);
    const wMove = disp.map(d => Math.min(1, Math.max(0, (d - 3) / 4)));
    // Prefer routes that keep the conserved core folded: swing or locally open
    // the moving segments first, and only swell the whole protein as a last resort.
    const tries = [
      ['orbit +6', () => [...orbitWaypoints(10, 6), Bt]],
      ['orbit +10', () => [...orbitWaypoints(12, 10), Bt]],
      ['local unfold x2', () => [swollen(A, cA, 2, wMove), swollen(B, cB, 2, wMove), Bt]],
      ['local unfold x3', () => [swollen(A, cA, 3, wMove), swollen(B, cB, 3, wMove), Bt]],
      ['orbit +18', () => [...orbitWaypoints(16, 18), Bt]],
      ['global unfold x1.6', () => [swollen(A, cA, 1.6, ones), swollen(B, cB, 1.6, ones), Bt]],
      ['global unfold x2.2', () => [swollen(A, cA, 2.2, ones), swollen(B, cB, 2.2, ones), Bt]],
      ['global unfold x3', () => [swollen(A, cA, 3, ones), swollen(B, cB, 3, ones), Bt]],
    ];
    const resid = r => r.residual ? r.residual.reduce((a, d) => a + d * d, 0) : Infinity;
    let best = raw;
    for (const [name, wp] of tries) {
      const r = run(wp());
      r.strategy = name;
      if (!r.stuck) { best = r; break; }
      if (resid(r) < resid(best)) best = r;
    }
    raw = best;
  }
  const last = raw[raw.length - 1];
  for (let f = 1; f <= 3; f++) {
    const Y = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) Y[i * 3 + k] = last[i * 3 + k] + (B[i][k] - last[i * 3 + k]) * (f / 3);
    raw.push(Y);
  }
  const res = result(raw);
  res.strategy = raw.strategy; res.stuck = !!raw.stuck;
  return res;
}

// Pairs (i, j>i+2) closer than cutoff, via a uniform grid. Flat [i0, j0, i1, j1, ...].
function neighbourPairs(X, n, cutoff) {
  const cells = new Map();
  const key = (a, b, c) => (a * 73856093) ^ (b * 19349663) ^ (c * 83492791);
  const cell = i => [Math.floor(X[i * 3] / cutoff), Math.floor(X[i * 3 + 1] / cutoff), Math.floor(X[i * 3 + 2] / cutoff)];
  for (let i = 0; i < n; i++) {
    const [a, b, c] = cell(i), k = key(a, b, c);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(i);
  }
  const out = [], c2 = cutoff * cutoff;
  for (let i = 0; i < n; i++) {
    const [a, b, c] = cell(i);
    for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) for (let dc = -1; dc <= 1; dc++) {
      const list = cells.get(key(a + da, b + db, c + dc));
      if (!list) continue;
      for (const j of list) {
        if (j < i + 3) continue;
        const d2 = (X[i * 3] - X[j * 3]) ** 2 + (X[i * 3 + 1] - X[j * 3 + 1]) ** 2 + (X[i * 3 + 2] - X[j * 3 + 2]) ** 2;
        if (d2 < c2) out.push(i, j);
      }
    }
  }
  return out;
}

// Pick F frames evenly spaced along the path's cumulative RMSD.
function resample(raw, F, n) {
  const cum = [0];
  for (let f = 1; f < raw.length; f++) {
    let s = 0;
    for (let i = 0; i < n * 3; i++) s += (raw[f][i] - raw[f - 1][i]) ** 2;
    cum.push(cum[f - 1] + Math.sqrt(s / n));
  }
  const total = cum[cum.length - 1] || 1;
  // long paths get more frames so playback interpolation never cuts corners
  F = Math.max(F, Math.min(200, Math.ceil(total / 0.2)));
  const out = [];
  let j = 0;
  for (let f = 0; f < F; f++) {
    const target = (total * f) / (F - 1);
    while (j < raw.length - 2 && cum[j + 1] < target) j++;
    const a = Math.min(1, Math.max(0, (target - cum[j]) / ((cum[j + 1] - cum[j]) || 1)));
    const Y = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) Y[i] = raw[j][i] + (raw[j + 1][i] - raw[j][i]) * a;
    out.push(Y);
  }
  return out;
}

// Move atoms i and j so their distance lies in [lo, hi].
function adjust(Y, i, j, lo, hi, gain) {
  const dx = Y[j * 3] - Y[i * 3], dy = Y[j * 3 + 1] - Y[i * 3 + 1], dz = Y[j * 3 + 2] - Y[i * 3 + 2];
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 >= lo * lo && d2 <= hi * hi) return;
  const d = Math.sqrt(d2) || 1e-6;
  const target = d < lo ? lo : hi;
  const s = ((d - target) / d) * gain * 0.5;
  Y[i * 3] += dx * s; Y[i * 3 + 1] += dy * s; Y[i * 3 + 2] += dz * s;
  Y[j * 3] -= dx * s; Y[j * 3 + 1] -= dy * s; Y[j * 3 + 2] -= dz * s;
}

// Sample a morph at continuous t in [0,1] into out (Float32Array n*3).
export function sampleMorph(morph, t, out) {
  const F = morph.frames.length;
  const x = Math.min(F - 1, Math.max(0, t * (F - 1)));
  const f0 = Math.floor(x), f1 = Math.min(F - 1, f0 + 1), a = x - f0;
  const A = morph.frames[f0], B = morph.frames[f1];
  for (let i = 0; i < out.length; i++) out[i] = A[i] + (B[i] - A[i]) * a;
  return out;
}

// ---------- validation ----------

// Closest approach between segments p1p2 and q1q2.
function segDist(p1, p2, q1, q2) {
  const d1 = sub(p2, p1), d2 = sub(q2, q1), r = sub(p1, q1);
  const a = d1[0] ** 2 + d1[1] ** 2 + d1[2] ** 2, e = d2[0] ** 2 + d2[1] ** 2 + d2[2] ** 2;
  const f = d2[0] * r[0] + d2[1] * r[1] + d2[2] * r[2];
  const c = d1[0] * r[0] + d1[1] * r[1] + d1[2] * r[2];
  const b = d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2];
  const den = a * e - b * b;
  let s = den > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
  let u = (b * s + f) / e;
  if (u < 0) { u = 0; s = Math.min(1, Math.max(0, -c / a)); }
  else if (u > 1) { u = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
  const cp = [p1[0] + d1[0] * s, p1[1] + d1[1] * s, p1[2] + d1[2] * s];
  const cq = [q1[0] + d2[0] * u, q1[1] + d2[1] * u, q1[2] + d2[2] * u];
  return dist(cp, cq);
}

// Samples playback (including between frames) and reports bond stretch, closest
// non-bonded segment approach, and largest per-sample atom displacement. A chain
// can only pass through itself if two non-adjacent segments meet (distance → 0).
export function validateMorph(morph, breaks, subSteps = 6) {
  const n = morph.n;
  const total = (morph.frames.length - 1) * subSteps;
  let maxBondDev = 0, minSegSep = Infinity, maxStep = 0, worstT = 0;
  const cur = new Float32Array(n * 3), prev = new Float32Array(n * 3);
  const P = i => [cur[i * 3], cur[i * 3 + 1], cur[i * 3 + 2]];
  for (let s = 0; s <= total; s++) {
    sampleMorph(morph, s / total, cur);
    for (let i = 0; i < n - 1; i++) if (!breaks[i]) maxBondDev = Math.max(maxBondDev, Math.abs(dist(P(i), P(i + 1)) - 3.8));
    for (let i = 0; i < n - 1; i++) {
      if (breaks[i]) continue;
      for (let j = i + 3; j < n - 1; j++) {
        if (breaks[j]) continue;
        const d = segDist(P(i), P(i + 1), P(j), P(j + 1));
        if (d < minSegSep) { minSegSep = d; worstT = s / total; }
      }
    }
    if (s > 0) for (let i = 0; i < n; i++) maxStep = Math.max(maxStep, Math.hypot(cur[i * 3] - prev[i * 3], cur[i * 3 + 1] - prev[i * 3 + 1], cur[i * 3 + 2] - prev[i * 3 + 2]));
    prev.set(cur);
  }
  return { maxBondDev, minSegSep, worstT, maxStep };
}
