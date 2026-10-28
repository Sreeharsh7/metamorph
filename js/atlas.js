// Fold-Switch Atlas: searchable list of known fold-switching pairs, a viewer
// that animates the selected pair, and a secondary-structure track that shows
// fold A, the current frame and fold B along the chain.
import { ATLAS } from '../data/atlas.js';
import { Viewer } from './viewer.js';
import { assignSS } from './ss.js';
import { computeMorph } from './atlas-morph.js';

const $ = s => document.querySelector(s);
const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
const SS_FILL = ['var(--coil)', 'var(--helix)', 'var(--strand)'];
const SS_CH = ['-', 'H', 'E'];

// ---------- tidy RCSB annotations ----------
const SMALL = new Set(['of', 'and', 'the', 'in', 'for', 'to', 'a', 'by', 'with', 'from']);
function tidy(s) {
  if (!s) return '';
  if (s !== s.toUpperCase()) return s;          // already mixed case
  return s.toLowerCase().replace(/\b([a-z])([a-z]*)/g, (m, a, b, i) => (i > 0 && SMALL.has(m) ? m : a.toUpperCase() + b))
    .replace(/\b(Dna|Rna|Atp|Gtp|Nadh?|Ii|Iii|Iv|Hiv|Sars|Cov|Mhc|Lps|Abc)\b/g, m => m.toUpperCase());
}
const organism = s => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '');

// ---------- per-pair summary (cheap: endpoint secondary structure only) ----------
const breaksArr = e => { const b = new Array(e.seq.length).fill(false); for (const i of e.breaks) b[i] = true; return b; };
function classify(ss, lo, hi) {
  let h = 0, s = 0;
  for (let i = lo; i <= hi; i++) { if (ss[i] === 1) h++; else if (ss[i] === 2) s++; }
  const L = hi - lo + 1;
  if (h / L >= 0.3 && h >= s) return 'α';
  if (s / L >= 0.25) return 'β';
  if (h / L >= 0.2) return 'α';
  return 'coil';
}
function summarise(e) {
  const br = breaksArr(e);
  e.ssA = assignSS(Float32Array.from(e.A), br);
  e.ssB = assignSS(Float32Array.from(e.B), br);
  const [lo, hi] = e.fsr || [0, e.seq.length - 1];
  const a = classify(e.ssA, lo, hi), b = classify(e.ssB, lo, hi);
  e.type = a === b ? `${a} rearranged` : `${a} → ${b}`;
  e.title = tidy(e.name) || `${e.a.pdb} / ${e.b.pdb}`;
  e.org = organism(e.organism);
  e.hay = `${e.title} ${e.org} ${e.a.pdb} ${e.b.pdb} ${e.a.title} ${e.b.title}`.toLowerCase();
}
ATLAS.forEach(summarise);
ATLAS.sort((x, y) => x.title.localeCompare(y.title));

// ---------- list ----------
let filter = 'all', query = '', current = null;
const entries = [...ATLAS];

function spark(e) {
  // two mini bars: the fold-switching region in fold A (top) and fold B (bottom)
  const [lo, hi] = e.fsr || [0, e.seq.length - 1];
  const s = svg('svg', { class: 'spark', viewBox: '0 0 44 22', 'aria-hidden': 'true' });
  const L = hi - lo + 1, w = 44 / L;
  for (const [ss, y] of [[e.ssA, 3], [e.ssB, 13]]) {
    let i = lo;
    while (i <= hi) {
      let j = i; while (j <= hi && ss[j] === ss[i]) j++;
      const thin = ss[i] === 0;
      svg('rect', { x: ((i - lo) * w).toFixed(2), y: thin ? y + 2 : y, width: ((j - i) * w + 0.3).toFixed(2), height: thin ? 2 : 6, rx: 1, fill: SS_FILL[ss[i]] }, s);
      i = j;
    }
  }
  return s;
}

function renderChips() {
  const counts = {};
  for (const e of entries) counts[e.type] = (counts[e.type] || 0) + 1;
  const types = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const box = $('#chips'); box.textContent = '';
  for (const [t, c] of [['all', entries.length], ...types]) {
    const b = document.createElement('button');
    b.className = 'chip' + (filter === t ? ' on' : '');
    b.innerHTML = `${t === 'all' ? 'all' : t}<b>${c}</b>`;
    b.addEventListener('click', () => { filter = t; renderChips(); renderList(); });
    box.appendChild(b);
  }
}

function renderList() {
  const list = $('#list'); list.textContent = '';
  const q = query.trim().toLowerCase();
  const shown = entries.filter(e => (filter === 'all' || e.type === filter) && (!q || q.split(/\s+/).every(w => e.hay.includes(w))));
  for (const e of shown) {
    const li = document.createElement('li');
    li.className = 'item' + (current === e ? ' on' : '');
    li.tabIndex = 0;
    li.dataset.id = e.id;
    li.setAttribute('role', 'button');
    li.setAttribute('aria-label', `${e.title}, ${e.a.pdb} to ${e.b.pdb}`);
    li.appendChild(spark(e));
    const mid = document.createElement('div');
    mid.innerHTML = `<div class="nm"></div><div class="sub">${e.a.pdb}_${e.a.chain} → ${e.b.pdb}_${e.b.chain} · ${e.seq.length} aa</div>`;
    mid.querySelector('.nm').textContent = e.title;
    li.appendChild(mid);
    const tag = document.createElement('div'); tag.className = 'tag'; tag.textContent = e.type; li.appendChild(tag);
    li.addEventListener('click', () => select(e, true));
    li.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(e, true); } });
    list.appendChild(li);
  }
  if (!shown.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'No pairs match.'; list.appendChild(li); }
  $('#count').textContent = ATLAS.length;
}
$('#q').addEventListener('input', e => { query = e.target.value; renderList(); });

// ---------- morph computation (worker, with inline fallback) ----------
const cache = new Map();
let worker = null, pending = new Map();
try {
  worker = new Worker(new URL('./morph-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => { const p = pending.get(data.key); pending.delete(data.key); if (p) data.ok ? p.resolve(data) : p.reject(new Error(data.error)); };
  worker.onerror = () => { worker = null; for (const [, p] of pending) p.retry(); pending.clear(); };
} catch (e) { worker = null; }

function morphFor(e) {
  if (cache.has(e.id)) return cache.get(e.id);
  const job = { key: e.id, A: Float32Array.from(e.A), B: Float32Array.from(e.B), breaks: e.breaks };
  const inline = () => new Promise(r => setTimeout(r, 20)).then(() => computeMorph(job));
  const pr = worker
    ? new Promise((resolve, reject) => { pending.set(e.id, { resolve, reject, retry: () => inline().then(resolve, reject) }); worker.postMessage(job); })
    : inline();
  cache.set(e.id, pr);
  pr.catch(() => cache.delete(e.id));
  return pr;
}

// ---------- viewer and playback ----------
const viewer = new Viewer($('#view'));
viewer.target = null;
let playing = true, dir = 1, hold = 0, emphMode = 'region';
const DURATION = 3.6;

function setEmph() {
  const p = viewer.protein; if (!p) return;
  const e = current, n = p.morph.n;
  ['emRegion', 'emMove', 'emNone'].forEach(id => $('#' + id).classList.toggle('on', id === { region: 'emRegion', motion: 'emMove', none: 'emNone' }[emphMode]));
  if (emphMode === 'none') { viewer.emph = null; viewer.highlightMoving = false; return; }
  if (emphMode === 'motion' || !e.fsr) { viewer.emph = null; viewer.highlightMoving = true; return; }
  const w = new Float32Array(n);
  const [lo, hi] = e.fsr;
  for (let i = 0; i < n; i++) { const d = i < lo ? lo - i : i > hi ? i - hi : 0; w[i] = Math.max(0, 1 - d / 4); }
  viewer.emph = w; viewer.highlightMoving = false;
}
$('#emRegion').addEventListener('click', () => { emphMode = 'region'; setEmph(); });
$('#emMove').addEventListener('click', () => { emphMode = 'motion'; setEmph(); });
$('#emNone').addEventListener('click', () => { emphMode = 'none'; setEmph(); });

function setPlaying(on) { playing = on; $('#play').textContent = on ? '❚❚' : '▶'; $('#play').setAttribute('aria-label', on ? 'Pause' : 'Play'); }
$('#play').addEventListener('click', () => setPlaying(!playing));
$('#scrub').addEventListener('input', ev => { setPlaying(false); viewer.t = ev.target.value / 1000; });

// ---------- secondary-structure track ----------
let trackNow = [], lastFrame = -1;
function drawTrack(e, m) {
  const t = $('#track'); t.textContent = '';
  const n = e.seq.length, W = 600, w = W / n;
  if (e.fsr) svg('rect', { x: e.fsr[0] * w, y: 0, width: (e.fsr[1] - e.fsr[0] + 1) * w, height: 92, fill: 'rgba(231,227,218,0.07)', rx: 3 }, t);
  const row = (ss, y) => {
    let i = 0;
    while (i < n) {
      let j = i; while (j < n && ss[j] === ss[i]) j++;
      const thin = ss[i] === 0;
      svg('rect', { x: i * w, y: thin ? y + 7 : y, width: (j - i) * w + 0.2, height: thin ? 4 : 18, fill: SS_FILL[ss[i]] }, t);
      i = j;
    }
  };
  row(m.ss[0], 6);
  row(m.ss[m.ss.length - 1], 68);
  trackNow = [];
  for (let i = 0; i < n; i++) trackNow.push(svg('rect', { x: i * w, y: 37, width: w + 0.2, height: 18 }, t));
  lastFrame = -1;
  const num = (k) => `${e.numA[k]}`;
  $('#tStart').textContent = `res ${num(0)}`;
  $('#tEnd').textContent = `${num(n - 1)}`;
  $('#tRegion').textContent = e.fsr ? `fold-switching region ${num(e.fsr[0])}–${num(e.fsr[1])}` : 'region from residue motion';
}
function updateTrack(m, t) {
  const F = m.ss.length, fi = Math.round(t * (F - 1));
  if (fi === lastFrame) return;
  lastFrame = fi;
  const ss = m.ss[fi];
  for (let i = 0; i < trackNow.length; i++) {
    const r = trackNow[i], s = ss[i];
    if (r._s === s) continue;
    r._s = s;
    r.setAttribute('fill', SS_FILL[s]);
    r.setAttribute('y', s === 0 ? 44 : 37); r.setAttribute('height', s === 0 ? 4 : 18);
  }
}

function regionSeq(e, m) {
  const box = $('#regionSeq');
  const n = e.seq.length;
  const [lo, hi] = e.fsr || [0, Math.min(n - 1, 59)];
  const a = Math.max(0, lo - 3), b = Math.min(n - 1, hi + 3);
  const cell = (ch, s, inRegion) => `<span class="r ${s === 1 ? 'h' : s === 2 ? 'e' : ''}" style="${inRegion ? '' : 'opacity:.45'}">${ch}</span>`;
  const A = m.ss[0], B = m.ss[m.ss.length - 1];
  let seq = '', ra = '', rb = '';
  for (let i = a; i <= b; i++) {
    const inR = i >= lo && i <= hi;
    seq += `<span class="r" style="${inR ? 'color:var(--text)' : 'opacity:.45'}">${e.seq[i]}</span>`;
    ra += cell(SS_CH[A[i]], A[i], inR);
    rb += cell(SS_CH[B[i]], B[i], inR);
  }
  box.innerHTML = `<span class="row"><span class="lab">sequence</span>${seq}</span><span class="row"><span class="lab">fold A</span>${ra}</span><span class="row"><span class="lab">fold B</span>${rb}</span>`;
}

function facts(e, m) {
  const METHOD = { 'X-RAY DIFFRACTION': 'X-ray', 'ELECTRON MICROSCOPY': 'cryo-EM', 'SOLUTION NMR': 'NMR', 'SOLID-STATE NMR': 'ssNMR' };
  const meta = s => [s.method ? METHOD[s.method.toUpperCase()] || tidy(s.method) : '', s.resolution ? `${s.resolution.toFixed(1)} Å` : '', s.year].filter(Boolean).join(' · ');
  const link = (el, s) => { el.textContent = `${s.pdb} · chain ${s.chain}`; if (s.pdb.length === 4) el.href = `https://www.rcsb.org/structure/${s.pdb}`; else el.removeAttribute('href'); };
  link($('#fA'), e.a); link($('#fB'), e.b);
  $('#fAm').textContent = meta(e.a); $('#fBm').textContent = meta(e.b);
  $('#fType').textContent = e.type;
  $('#fRegion').textContent = e.fsr ? `${e.fsr[1] - e.fsr[0] + 1} residues` + (e.identity < 0.95 ? ` · ${Math.round(e.identity * 100)}% identical` : '') : 'whole chain';
  $('#fRmsd').textContent = `${m.rmsd.toFixed(1)} Å RMSD`;
  const q = $('#fQual');
  q.textContent = m.clean ? `clean path · ${e.seq.length} aa` : 'approximate path: chain crowds itself';
  q.className = m.clean ? '' : 'warn';
  q.title = m.clean ? `Closest Cα–Cα approach along the path ${m.closest.toFixed(2)} Å` : `Closest Cα–Cα approach ${m.closest.toFixed(2)} Å, below the ${m.ends.toFixed(2)} Å seen in the real structures. This coarse model could not route the chain without crowding.`;
}

let selectToken = 0;
async function select(e, user = false) {
  current = e;
  const token = ++selectToken;
  document.querySelectorAll('.item').forEach(li => li.classList.toggle('on', li.dataset.id === e.id));
  $('#dName').textContent = e.title;
  $('#dOrg').textContent = e.org;
  try { history.replaceState(null, '', '#' + e.id); } catch (err) { /* sandboxed */ }
  if (user && innerWidth <= 980) scrollTo({ top: 0, behavior: 'smooth' });
  const busy = !cache.has(e.id);
  $('#computing').hidden = !busy;
  $('#computingText').textContent = e.seq.length > 350 ? `Relaxing a ${e.seq.length}-residue path…` : 'Relaxing the path…';
  let m;
  try { m = await morphFor(e); } catch (err) {
    if (token !== selectToken) return;
    $('#computingText').textContent = `Could not build this morph: ${err.message}`;
    return;
  }
  e._m = m;
  if (token !== selectToken) return;
  $('#computing').hidden = true;
  if (!m.protein) {
    const morph = { frames: m.frames, disp: m.disp, dispA: m.dispA, n: e.seq.length };
    m.protein = { morph, ss: m.ss, breaks: breaksArr(e), maxR: m.maxR };
  }
  viewer.setProtein(m.protein);
  viewer.t = 0; dir = 1; hold = 0.6;
  setEmph();
  viewer.draw(0, true);
  drawTrack(e, m); regionSeq(e, m); facts(e, m);
  setPlaying(true);
  // warm the cache for the neighbours in the list while this one plays
  const i = entries.indexOf(e);
  for (const k of [i + 1, i - 1]) if (entries[k] && entries[k].seq.length < 400) setTimeout(() => morphFor(entries[k]), 400);
}

function stateLabel(e, t) {
  const el = $('#dState');
  if (t < 0.04) el.innerHTML = `<b class="t-helix">fold A</b>${e.a.pdb}`;
  else if (t > 0.96) el.innerHTML = `<b class="t-strand">fold B</b>${e.b.pdb}`;
  else el.innerHTML = `<b>switching</b>${Math.round(t * 100)}%`;
}

let last = performance.now();
function tick(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (viewer.protein && current) {
    if (playing) {
      if (hold > 0) hold -= dt;
      else {
        viewer.t += dir * dt / DURATION;
        if (viewer.t >= 1) { viewer.t = 1; dir = -1; hold = 1.2; }
        if (viewer.t <= 0) { viewer.t = 0; dir = 1; hold = 1.2; }
      }
      $('#scrub').value = Math.round(viewer.t * 1000);
    }
    viewer.frame(dt);
    if (current._m) updateTrack(current._m, viewer.t);
    stateLabel(current, viewer.t);
  }
  requestAnimationFrame(tick);
}

// ---------- compare any two PDB entries ----------
const AA = { ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H', ILE: 'I', LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P', SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V', MSE: 'M', SEC: 'U' };
async function fetchChain(pdb, chain) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const url = `https://models.rcsb.org/v1/${pdb.toLowerCase()}/atoms?label_atom_id=CA&auth_asym_id=${encodeURIComponent(chain)}&model_nums=1&encoding=cif`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`${pdb} chain ${chain}: not found (HTTP ${res.status})`);
    const cols = [], out = [], seen = new Set();
    for (const line of (await res.text()).split('\n')) {
      if (line.startsWith('_atom_site.')) { cols.push(line.slice(11).trim()); continue; }
      if (!cols.length || !(line.startsWith('ATOM') || line.startsWith('HETATM'))) continue;
      const f = line.trim().split(/\s+/), c = {}; cols.forEach((k, i) => { c[k] = f[i]; });
      if (c.label_atom_id !== 'CA' || c.auth_asym_id !== chain || !['.', '?', 'A'].includes(c.label_alt_id ?? '.')) continue;
      const key = c.auth_seq_id + (c.pdbx_PDB_ins_code || '');
      if (seen.has(key) || !AA[c.label_comp_id]) continue;
      seen.add(key);
      out.push({ n: +c.auth_seq_id, aa: AA[c.label_comp_id], x: +c.Cartn_x, y: +c.Cartn_y, z: +c.Cartn_z });
    }
    if (out.length < 12) throw new Error(`${pdb} chain ${chain}: only ${out.length} residues with Cα`);
    return out;
  } finally { clearTimeout(timer); }
}
// global alignment with free end gaps
function align(s, t) {
  const n = s.length, m = t.length, M = 2, X = -1, G = -3;
  const H = new Float32Array((n + 1) * (m + 1)), P = new Uint8Array((n + 1) * (m + 1));
  const W = m + 1;
  for (let i = 1; i <= n; i++) P[i * W] = 1;
  for (let j = 1; j <= m; j++) P[j] = 2;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const d = H[(i - 1) * W + j - 1] + (s[i - 1] === t[j - 1] ? M : X);
    const u = H[(i - 1) * W + j] + (j === m ? 0 : G);
    const l = H[i * W + j - 1] + (i === n ? 0 : G);
    if (d >= u && d >= l) { H[i * W + j] = d; P[i * W + j] = 0; }
    else if (u >= l) { H[i * W + j] = u; P[i * W + j] = 1; }
    else { H[i * W + j] = l; P[i * W + j] = 2; }
  }
  const pairs = []; let i = n, j = m;
  while (i > 0 && j > 0) { const p = P[i * W + j]; if (p === 0) { pairs.push([i - 1, j - 1]); i--; j--; } else if (p === 1) i--; else j--; }
  return pairs.reverse();
}
$('#compare').addEventListener('submit', async ev => {
  ev.preventDefault();
  const st = $('#cStatus'), go = $('#cGo');
  const pa = $('#cA').value.trim().toUpperCase(), pb = $('#cB').value.trim().toUpperCase();
  const ca = $('#cAc').value.trim() || 'A', cb = $('#cBc').value.trim() || 'A';
  st.className = 'status';
  if (![pa, pb].every(p => /^[0-9][A-Z0-9]{3}$/.test(p))) { st.className = 'status err'; st.textContent = 'PDB IDs are 4 characters and start with a digit.'; return; }
  go.disabled = true; st.textContent = 'fetching from RCSB…';
  try {
    const [A, B] = await Promise.all([fetchChain(pa, ca), fetchChain(pb, cb)]);
    let pairs = align(A.map(r => r.aa).join(''), B.map(r => r.aa).join(''));
    if (pairs.length < 12) throw new Error('The two chains share too few aligned residues.');
    if (pairs.length > 700) pairs = pairs.slice(0, 700);
    const ident = pairs.filter(([i, j]) => A[i].aa === B[j].aa).length / pairs.length;
    const gap = (R, i, j) => R[j].n - R[i].n !== 1 || Math.hypot(R[j].x - R[i].x, R[j].y - R[i].y, R[j].z - R[i].z) > 4.3;
    const breaks = []; for (let k = 0; k < pairs.length - 1; k++) if (gap(A, pairs[k][0], pairs[k + 1][0]) || gap(B, pairs[k][1], pairs[k + 1][1])) breaks.push(k);
    const e = {
      id: `${pa}_${ca}-${pb}_${cb}`, name: `${pa} → ${pb}`, organism: '', identity: ident, fsr: null,
      a: { pdb: pa, chain: ca }, b: { pdb: pb, chain: cb },
      seq: pairs.map(([i]) => A[i].aa).join(''), numA: pairs.map(([i]) => A[i].n), numB: pairs.map(([, j]) => B[j].n), breaks,
      A: pairs.flatMap(([i]) => [A[i].x, A[i].y, A[i].z]), B: pairs.flatMap(([, j]) => [B[j].x, B[j].y, B[j].z]),
    };
    summarise(e);
    e.title = `${pa}_${ca} → ${pb}_${cb}`; e.org = 'your comparison';
    const existing = entries.findIndex(x => x.id === e.id);
    if (existing >= 0) entries.splice(existing, 1);
    entries.unshift(e);
    cache.delete(e.id);
    st.className = 'status ok';
    st.textContent = `${pairs.length} aligned residues, ${Math.round(ident * 100)}% identical. Computing the path…`;
    renderChips(); renderList();
    await select(e, true);
    st.textContent = `${pairs.length} aligned residues, ${Math.round(ident * 100)}% identical.`;
  } catch (err) {
    st.className = 'status err';
    st.textContent = err.name === 'AbortError' ? 'RCSB took too long to answer. Try again.' : err.message;
  } finally { go.disabled = false; }
});

renderChips();
renderList();
const fromHash = decodeURIComponent(location.hash.slice(1));
const start = entries.find(e => e.id === fromHash) || entries.find(e => e.id.startsWith('2OUG')) || entries[0];
select(start);
requestAnimationFrame(tick);
