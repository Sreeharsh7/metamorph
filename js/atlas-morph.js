// One atlas morph: superpose, relax the path, assign secondary structure per
// frame and score the path's quality. Runs in js/morph-worker.js (or inline).
import { superpose, buildMorph } from './morph.js';
import { assignSS } from './ss.js';

const toPts = a => { const o = []; for (let i = 0; i < a.length; i += 3) o.push([a[i], a[i + 1], a[i + 2]]); return o; };

// closest non-bonded Cα approach in one frame
function minCA(P, n) {
  let m = Infinity;
  for (let i = 0; i < n; i++) for (let j = i + 3; j < n; j++) {
    const dx = P[i * 3] - P[j * 3], dy = P[i * 3 + 1] - P[j * 3 + 1], dz = P[i * 3 + 2] - P[j * 3 + 2];
    const d = dx * dx + dy * dy + dz * dz; if (d < m) m = d;
  }
  return Math.sqrt(m);
}

// A, B: flat paired Cα coordinates; breaks: indices i where i,i+1 are not bonded.
export function computeMorph({ A, B, breaks }) {
  const n = A.length / 3;
  const br = new Array(n).fill(false); for (const i of breaks) br[i] = true;
  const s = superpose(toPts(A), toPts(B));
  const morph = buildMorph(s.A, s.B, br);
  // centre every frame so rotation stays about the protein
  for (const f of morph.frames) {
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += f[i * 3]; cy += f[i * 3 + 1]; cz += f[i * 3 + 2]; }
    cx /= n; cy /= n; cz /= n;
    for (let i = 0; i < n; i++) { f[i * 3] -= cx; f[i * 3 + 1] -= cy; f[i * 3 + 2] -= cz; }
  }
  const ss = morph.frames.map(f => assignSS(f, br));
  const F = morph.frames.length;
  let maxR = 0;
  for (const f of [morph.frames[0], morph.frames[F - 1]]) for (let i = 0; i < f.length; i += 3) maxR = Math.max(maxR, Math.hypot(f[i], f[i + 1], f[i + 2]));
  // quality: no frame may bring the chain closer than the real structures do
  const ends = Math.min(minCA(morph.frames[0], n), minCA(morph.frames[F - 1], n));
  let closest = Infinity;
  for (let f = 0; f < F; f += 2) closest = Math.min(closest, minCA(morph.frames[f], n));
  const rmsd = Math.sqrt(morph.dispA.reduce((a, d) => a + d * d, 0) / n);
  return { frames: morph.frames, ss, disp: morph.disp, dispA: morph.dispA, maxR, rmsd, closest, ends, clean: closest >= Math.min(2.6, ends - 0.1), strategy: morph.strategy };
}
