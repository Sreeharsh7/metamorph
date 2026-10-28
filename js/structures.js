// Loads both states of a level's protein: RCSB ModelServer first (Cα only, a few KB),
// bundled fallback if offline or slow. Then pairs, superposes and builds the morph.
import { STATES } from './states.js';
import { FALLBACK } from '../data/fallback.js';
import { parseCifCA, pairStates, buildMorph } from './morph.js';

const cache = new Map();

async function fetchCA(s, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const url = `https://models.rcsb.org/v1/${s.pdb.toLowerCase()}/atoms?label_atom_id=CA&auth_asym_id=${s.chain}&model_nums=1&encoding=cif`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return parseCifCA(await res.text(), s.chain);
  } finally {
    clearTimeout(timer);
  }
}

export async function loadProtein(id, { timeoutMs = 4500 } = {}) {
  if (cache.has(id)) return cache.get(id);
  const cfg = STATES[id];
  let a = FALLBACK[id].a, b = FALLBACK[id].b, source = 'bundled';
  try {
    const [fa, fb] = await Promise.all([fetchCA(cfg.a, timeoutMs), fetchCA(cfg.b, timeoutMs)]);
    // only trust the download if it covers what the level needs
    const enough = (got, want) => got.length >= want.length * 0.95;
    if (enough(fa, a) && enough(fb, b)) { a = fa; b = fb; source = 'RCSB PDB (live)'; }
  } catch (e) { /* offline or blocked: bundled copy */ }
  const pair = pairStates(a, b, cfg.a, cfg.b);
  const morph = buildMorph(pair.A, pair.B, pair.breaks);
  // centre every frame on its own centroid so the character doesn't drift while morphing
  for (const f of morph.frames) {
    let cx = 0, cy = 0, cz = 0;
    const n = f.length / 3;
    for (let i = 0; i < n; i++) { cx += f[i * 3]; cy += f[i * 3 + 1]; cz += f[i * 3 + 2]; }
    cx /= n; cy /= n; cz /= n;
    for (let i = 0; i < n; i++) { f[i * 3] -= cx; f[i * 3 + 1] -= cy; f[i * 3 + 2] -= cz; }
  }
  let maxR = 0;
  // size the character by its two real folds; the unfolded intermediate may poke out briefly
  for (const f of [morph.frames[0], morph.frames[morph.frames.length - 1]]) for (let i = 0; i < f.length; i += 3) maxR = Math.max(maxR, Math.hypot(f[i], f[i + 1], f[i + 2]));
  const data = { id, nums: pair.nums, morph, maxR, source, pdbA: cfg.a.pdb, pdbB: cfg.b.pdb };
  cache.set(id, data);
  return data;
}
