// Loads both states of a protein: RCSB ModelServer first (Cα only, a few KB),
// bundled fallback if offline or slow. Then pairs, superposes and builds the morph.
// Also handles user-supplied structures (PDB IDs or dropped .pdb/.cif files).
import { STATES } from './states.js';
import { FALLBACK } from '../data/fallback.js';
import { parseCifCA, pairStates, buildMorph } from './morph.js';
import { morphSS } from './cartoon.js';

const cache = new Map();

export async function fetchCA(pdb, chain, timeoutMs = 6000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const url = `https://models.rcsb.org/v1/${pdb.toLowerCase()}/atoms?label_atom_id=CA&auth_asym_id=${encodeURIComponent(chain)}&model_nums=1&encoding=cif`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`${pdb.toUpperCase()} chain ${chain}: HTTP ${res.status}`);
    return parseCifCA(await res.text(), chain);
  } finally {
    clearTimeout(timer);
  }
}

// Legacy PDB format: Cα of one chain (first model, altloc A).
export function parsePdbCA(text, chain) {
  const out = [], seen = new Set();
  for (const line of text.split('\n')) {
    if (line.startsWith('ENDMDL')) break;
    if (!line.startsWith('ATOM')) continue;
    if (line.slice(12, 16).trim() !== 'CA') continue;
    const alt = line[16];
    if (alt !== ' ' && alt !== 'A') continue;
    if (chain && line[21] !== chain) continue;
    const n = parseInt(line.slice(22, 26), 10);
    if (seen.has(n)) continue;
    seen.add(n);
    out.push([n, +line.slice(30, 38), +line.slice(38, 46), +line.slice(46, 54)]);
  }
  return out;
}

// First chain that has Cα atoms, for files where the user gave no chain.
export function firstChain(text) {
  if (/^data_/m.test(text) || text.includes('_atom_site.')) {
    const m = text.match(/^ATOM\s.*$/m);
    if (!m) return null;
    const cols = []; for (const l of text.split('\n')) if (l.startsWith('_atom_site.')) cols.push(l.trim().slice(11));
    const f = m[0].trim().split(/\s+/);
    return f[cols.indexOf('auth_asym_id')] || null;
  }
  const m = text.match(/^ATOM.{17}(.)/m);
  return m ? m[1] : null;
}

export function parseAnyCA(text, chain) {
  const cif = /^data_/m.test(text) || text.includes('_atom_site.');
  const ch = chain || firstChain(text);
  return cif ? parseCifCA(text, ch) : parsePdbCA(text, ch);
}

function centreFrames(frames) {
  for (const f of frames) {
    let cx = 0, cy = 0, cz = 0;
    const n = f.length / 3;
    for (let i = 0; i < n; i++) { cx += f[i * 3]; cy += f[i * 3 + 1]; cz += f[i * 3 + 2]; }
    cx /= n; cy /= n; cz /= n;
    for (let i = 0; i < n; i++) { f[i * 3] -= cx; f[i * 3 + 1] -= cy; f[i * 3 + 2] -= cz; }
  }
}

// a, b: [[resNum, x, y, z], ...]
export function prepare(a, b, cfgA = {}, cfgB = {}, meta = {}) {
  const pair = pairStates(a, b, cfgA, cfgB);
  if (pair.nums.length < 12) throw new Error(`Only ${pair.nums.length} residues are shared by both structures (by residue number). Try an offset or a different chain.`);
  const morph = buildMorph(pair.A, pair.B, pair.breaks);
  centreFrames(morph.frames);
  let maxR = 0;
  // size by the two real folds; an unfolded intermediate may poke out briefly
  for (const f of [morph.frames[0], morph.frames[morph.frames.length - 1]]) for (let i = 0; i < f.length; i += 3) maxR = Math.max(maxR, Math.hypot(f[i], f[i + 1], f[i + 2]));
  return {
    ...meta, pair, nums: pair.nums, breaks: pair.breaks, morph, maxR,
    ss: morphSS(morph, pair.breaks),
    // plain linear interpolation, built lazily for the comparison section
    linear() {
      if (!this._lin) { this._lin = buildMorph(pair.A, pair.B, pair.breaks, { linear: true, frames: morph.frames.length }); centreFrames(this._lin.frames); this._lin.ss = morphSS(this._lin, pair.breaks); }
      return this._lin;
    },
  };
}

export async function loadProtein(id, { timeoutMs = 4500 } = {}) {
  if (cache.has(id)) return cache.get(id);
  const cfg = STATES[id];
  let a = FALLBACK[id].a, b = FALLBACK[id].b, source = 'bundled';
  try {
    const [fa, fb] = await Promise.all([fetchCA(cfg.a.pdb, cfg.a.chain, timeoutMs), fetchCA(cfg.b.pdb, cfg.b.chain, timeoutMs)]);
    const enough = (got, want) => got.length >= want.length * 0.95;
    if (enough(fa, a) && enough(fb, b)) { a = fa; b = fb; source = 'RCSB PDB (live)'; }
  } catch (e) { /* offline or blocked: bundled copy */ }
  const data = prepare(a, b, cfg.a, cfg.b, { id, source, pdbA: cfg.a.pdb, pdbB: cfg.b.pdb });
  cache.set(id, data);
  return data;
}
