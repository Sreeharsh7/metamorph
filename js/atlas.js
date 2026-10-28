// Fold-switching protein atlas: a sortable table of known fold-switching pairs,
// a viewer that animates the selected pair, a secondary-structure track for
// fold A / current frame / fold B, and a form to compare any two PDB entries.
import { ATLAS } from '../data/atlas.js';
import { Viewer } from './viewer.js';
import { assignSS } from './ss.js';
import { computeMorph } from './atlas-morph.js';

const $ = s => document.querySelector(s);
const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SS_FILL = ['var(--coil)', 'var(--helix)', 'var(--strand)'];
const SS_CH = ['–', 'H', 'E'];

// ---------- tidy RCSB annotations ----------
const SMALL = new Set(['of', 'and', 'the', 'in', 'for', 'to', 'a', 'by', 'with', 'from']);
function tidy(s) {
  if (!s) return '';
  if (s !== s.toUpperCase()) return s;          // already mixed case
  return s.toLowerCase().replace(/\b([a-z])([a-z]*)/g, (m, a, b, i) => (i > 0 && SMALL.has(m) ? m : a.toUpperCase() + b))
    .replace(/\b(Dna|Rna|Atp|Gtp|Nadh?|Ii|Iii|Iv|Hiv|Sars|Cov|Mhc|Lps|Abc)\b/g, m => m.toUpperCase());
}
const organism = s => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '');
const METHOD = { 'X-RAY DIFFRACTION': 'X-ray', 'ELECTRON MICROSCOPY': 'Cryo-EM', 'SOLUTION NMR': 'NMR', 'SOLID-STATE NMR': 'Solid-state NMR' };

// ---------- per-pair summary (endpoint secondary structure only) ----------
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
  e.title = e.title || tidy(e.name) || `${e.a.pdb} / ${e.b.pdb}`;
  e.org = e.org ?? organism(e.organism);
  e.hay = `${e.title} ${e.org} ${e.a.pdb} ${e.b.pdb} ${e.a.title || ''} ${e.b.title || ''}`.toLowerCase();
}
ATLAS.forEach(summarise);

// ---------- table ----------
const entries = [...ATLAS];
let typeFilter = 'all', query = '', current = null;
let sortKey = 'title', sortDir = 1;
const sortVal = {
  title: e => e.title.toLowerCase(), pdbA: e => e.a.pdb, pdbB: e => e.b.pdb, len: e => e.seq.length, type: e => e.type,
};

function glyph(e) {
  // the fold-switching region in fold A (top bar) and fold B (bottom bar)
  const [lo, hi] = e.fsr || [0, e.seq.length - 1];
  const s = svg('svg', { class: 'glyph', viewBox: '0 0 44 20', 'aria-hidden': 'true' });
  const w = 44 / (hi - lo + 1);
  for (const [ss, y] of [[e.ssA, 2], [e.ssB, 12]]) {
    let i = lo;
    while (i <= hi) {
      let j = i; while (j <= hi && ss[j] === ss[i]) j++;
      const thin = ss[i] === 0;
      svg('rect', { x: ((i - lo) * w).toFixed(2), y: thin ? y + 2.5 : y, width: ((j - i) * w + 0.3).toFixed(2), height: thin ? 1.5 : 6, rx: 1, fill: SS_FILL[ss[i]] }, s);
      i = j;
    }
  }
  return s;
}

function renderTypes() {
  const counts = {};
  for (const e of ATLAS) counts[e.type] = (counts[e.type] || 0) + 1;
  const sel = $('#type');
  for (const [t, c] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    const o = document.createElement('option'); o.value = t; o.textContent = `${t} (${c})`; sel.appendChild(o);
  }
  sel.addEventListener('change', () => { typeFilter = sel.value; renderRows(); });
}

function renderRows() {
  const tb = $('#rows'); tb.textContent = '';
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = entries.filter(e => (typeFilter === 'all' || e.type === typeFilter || e.custom) && words.every(w => e.hay.includes(w)));
  const f = sortVal[sortKey];
  shown.sort((a, b) => (b.custom ? 1 : 0) - (a.custom ? 1 : 0) || (f(a) < f(b) ? -sortDir : f(a) > f(b) ? sortDir : 0));
  for (const e of shown) {
    const tr = document.createElement('tr');
    tr.dataset.id = e.id; tr.tabIndex = 0;
    if (e === current) tr.className = 'on';
    if (e.custom) tr.classList.add('custom');
    const g = document.createElement('td'); g.className = 'c-glyph'; g.appendChild(glyph(e)); tr.appendChild(g);
    tr.insertAdjacentHTML('beforeend',
      `<td class="c-name"><div class="nm">${esc(e.title)}</div>${e.org ? `<div class="org">${esc(e.org)}</div>` : ''}</td>` +
      `<td class="c-pdb">${e.a.pdb} <small>${esc(e.a.chain)}</small></td>` +
      `<td class="c-pdb c-b">${e.b.pdb} <small>${esc(e.b.chain)}</small></td>` +
      `<td class="c-num">${e.seq.length}</td>` +
      `<td class="c-type">${e.type}</td>`);
    tr.addEventListener('click', () => select(e, true));
    tr.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(e, true); }
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); const n = ev.key === 'ArrowDown' ? tr.nextElementSibling : tr.previousElementSibling; if (n && n.dataset.id) n.focus(); }
    });
    tb.appendChild(tr);
  }
  if (!shown.length) tb.innerHTML = '<tr class="empty"><td colspan="6">No pairs match your search.</td></tr>';
  $('#resultCount').textContent = shown.length === entries.length ? `${shown.length} pairs` : `${shown.length} of ${entries.length} pairs`;
  document.querySelectorAll('.pairs thead button').forEach(b => {
    if (b.dataset.sort === sortKey) b.setAttribute('aria-sort', sortDir > 0 ? 'ascending' : 'descending'); else b.removeAttribute('aria-sort');
  });
}
document.querySelectorAll('.pairs thead button').forEach(b => b.addEventListener('click', () => {
  if (sortKey === b.dataset.sort) sortDir = -sortDir; else { sortKey = b.dataset.sort; sortDir = 1; }
  renderRows();
}));
$('#q').addEventListener('input', e => { query = e.target.value; renderRows(); });

// ---------- morph computation (worker, with inline fallback) ----------
const cache = new Map();
let worker = null;
const pending = new Map();
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
viewer.auto = 0.08;
viewer.zoomK = 1.15;
let playing = true, dir = 1, hold = 0, emphMode = 'region';
const DURATION = 3.6;

function setEmph() {
  const p = viewer.protein; if (!p || !current) return;
  if (emphMode === 'none') { viewer.emph = null; viewer.highlightMoving = false; return; }
  if (emphMode === 'motion' || !current.fsr) { viewer.emph = null; viewer.highlightMoving = true; return; }
  const n = p.morph.n, w = new Float32Array(n), [lo, hi] = current.fsr;
  for (let i = 0; i < n; i++) { const d = i < lo ? lo - i : i > hi ? i - hi : 0; w[i] = Math.max(0, 1 - d / 4); }
  viewer.emph = w; viewer.highlightMoving = false;
}

const PAUSE = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="3" width="3" height="10"/><rect x="9" y="3" width="3" height="10"/></svg>';
const PLAY = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3l8 5-8 5z"/></svg>';
function setPlaying(on) { playing = on; $('#play').innerHTML = on ? PAUSE : PLAY; $('#play').setAttribute('aria-label', on ? 'Pause' : 'Play'); }
$('#play').addEventListener('click', () => setPlaying(!playing));
$('#scrub').addEventListener('input', ev => { setPlaying(false); viewer.t = ev.target.value / 1000; });

// ---------- secondary-structure track ----------
let trackNow = [], lastFrame = -1;
function drawTrack(e, m) {
  const t = $('#track'); t.textContent = '';
  const n = e.seq.length, W = 600, w = W / n;
  if (e.fsr) svg('rect', { x: e.fsr[0] * w, y: 0, width: (e.fsr[1] - e.fsr[0] + 1) * w, height: 92, fill: 'var(--accent-weak)' }, t);
  const row = (ss, y) => {
    let i = 0;
    while (i < n) {
      let j = i; while (j < n && ss[j] === ss[i]) j++;
      const thin = ss[i] === 0;
      svg('rect', { x: i * w, y: thin ? y + 8 : y, width: (j - i) * w + 0.2, height: thin ? 2 : 18, fill: SS_FILL[ss[i]] }, t);
      i = j;
    }
  };
  row(m.ss[0], 6);
  row(m.ss[m.ss.length - 1], 68);
  trackNow = [];
  for (let i = 0; i < n; i++) trackNow.push(svg('rect', { x: i * w, y: 37, width: w + 0.2, height: 18 }, t));
  lastFrame = -1;
  $('#tStart').textContent = e.numA[0];
  $('#tEnd').textContent = e.numA[n - 1];
  $('#tRegion').textContent = e.fsr ? `Fold-switching region ${e.numA[e.fsr[0]]}–${e.numA[e.fsr[1]]}` : '';
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
    r.setAttribute('y', s === 0 ? 45 : 37); r.setAttribute('height', s === 0 ? 2 : 18);
  }
}

function regionSeq(e, m) {
  const box = $('#regionSeq');
  if (!e.fsr) { box.hidden = true; return; }
  box.hidden = false;
  const n = e.seq.length, [lo, hi] = e.fsr;
  const a = Math.max(0, lo - 3), b = Math.min(n - 1, hi + 3);
  const A = m.ss[0], B = m.ss[m.ss.length - 1];
  let seq = '', ra = '', rb = '';
  for (let i = a; i <= b; i++) {
    const io = i >= lo && i <= hi ? 'in' : 'out';
    const k = s => (s === 1 ? 'h' : s === 2 ? 'e' : '');
    seq += `<span class="r ${io}">${e.seq[i]}</span>`;
    ra += `<span class="r ${io} ${k(A[i])}">${SS_CH[A[i]]}</span>`;
    rb += `<span class="r ${io} ${k(B[i])}">${SS_CH[B[i]]}</span>`;
  }
  box.innerHTML = `<span class="row"><span class="lab">Sequence</span>${seq}</span><span class="row"><span class="lab">Fold A</span>${ra}</span><span class="row"><span class="lab">Fold B</span>${rb}</span>`;
}

function metaTable(e, m) {
  const meta = s => [METHOD[(s.method || '').toUpperCase()] || tidy(s.method), s.resolution ? `${s.resolution.toFixed(1)} Å` : '', s.year].filter(Boolean).join(' · ');
  const pdb = s => `<a class="mono" href="https://www.rcsb.org/structure/${s.pdb}" target="_blank" rel="noopener">${s.pdb}</a> <span class="mono sub">chain ${esc(s.chain)}</span>${meta(s) ? ` <span class="sub">· ${esc(meta(s))}</span>` : ''}`;
  const rows = [
    ['Fold A', pdb(e.a)],
    ['Fold B', pdb(e.b)],
    ['Switch type', e.type],
    ['Region', e.fsr ? `<span class="mono">${e.numA[e.fsr[0]]}–${e.numA[e.fsr[1]]}</span> <span class="sub">(${e.fsr[1] - e.fsr[0] + 1} residues)</span>` : '<span class="sub">Not defined; highlighting by motion</span>'],
    ['Aligned residues', `<span class="mono">${e.seq.length}</span> <span class="sub">· ${(e.identity * 100).toFixed(0)}% identical</span>`],
    ['Cα RMSD', `<span class="mono">${m.rmsd.toFixed(1)} Å</span> <span class="sub">core-weighted fit</span>`],
    ['Morph path', m.clean ? `Clean <span class="sub">· closest Cα–Cα ${m.closest.toFixed(1)} Å</span>` : `<span class="warn">Approximate</span> <span class="sub">· chain comes within ${m.closest.toFixed(1)} Å of itself</span>`],
  ];
  $('#meta tbody').innerHTML = rows.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join('');
}

// ---------- export the morph as a multi-model Cα PDB ----------
const THREE_LETTER = { A: 'ALA', R: 'ARG', N: 'ASN', D: 'ASP', C: 'CYS', Q: 'GLN', E: 'GLU', G: 'GLY', H: 'HIS', I: 'ILE', L: 'LEU', K: 'LYS', M: 'MET', F: 'PHE', P: 'PRO', S: 'SER', T: 'THR', W: 'TRP', Y: 'TYR', V: 'VAL', U: 'SEC' };
function exportPdb() {
  const e = current, m = e && e._m; if (!m) return;
  const f = (v, w, d) => v.toFixed(d).padStart(w);
  const lines = [`REMARK   1 METAMORPH CA-ONLY MORPH ${e.a.pdb}_${e.a.chain} -> ${e.b.pdb}_${e.b.chain}`, 'REMARK   2 ILLUSTRATIVE INTERPOLATED PATH, NOT A SIMULATION'];
  // about 60 evenly spaced models, always including both real structures
  const F = m.frames.length, step = Math.max(1, Math.round(F / 60));
  const picks = []; for (let k = 0; k < F; k += step) picks.push(k);
  if (picks[picks.length - 1] !== F - 1) picks.push(F - 1);
  let model = 0;
  for (const k of picks) {
    const P = m.frames[k];
    lines.push(`MODEL     ${String(++model).padStart(4)}`);
    for (let i = 0; i < e.seq.length; i++) {
      lines.push(`ATOM  ${String(i + 1).padStart(5)}  CA  ${THREE_LETTER[e.seq[i]] || 'UNK'} A${String(e.numA[i]).padStart(4)}    ${f(P[i * 3], 8, 3)}${f(P[i * 3 + 1], 8, 3)}${f(P[i * 3 + 2], 8, 3)}  1.00  0.00           C`);
    }
    lines.push('ENDMDL');
  }
  lines.push('END');
  const url = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'chemical/x-pdb' }));
  const a = document.createElement('a'); a.href = url; a.download = `metamorph_${e.id}.pdb`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
$('#exportPdb').addEventListener('click', exportPdb);

// ---------- selection ----------
let selectToken = 0;
async function select(e, user = false) {
  current = e;
  const token = ++selectToken;
  document.querySelectorAll('#rows tr').forEach(tr => tr.classList.toggle('on', tr.dataset.id === e.id));
  $('#dName').textContent = e.title;
  $('#dOrg').textContent = e.org;
  $('#dPair').textContent = `${e.a.pdb}_${e.a.chain} → ${e.b.pdb}_${e.b.chain}`;
  $('#exportPdb').disabled = true;
  try { history.replaceState(null, '', '#' + e.id); } catch (err) { /* sandboxed */ }
  if (user && innerWidth <= 1080) $('.detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  const busy = !cache.has(e.id);
  $('#computing').hidden = !busy;
  $('#computingText').textContent = e.seq.length > 350 ? `Computing a ${e.seq.length}-residue path…` : 'Computing path…';
  let m;
  try { m = await morphFor(e); } catch (err) {
    if (token !== selectToken) return;
    $('#computingText').textContent = `Could not compute this path: ${err.message}`;
    return;
  }
  e._m = m;
  if (token !== selectToken) return;
  $('#computing').hidden = true;
  if (!m.protein) m.protein = { morph: { frames: m.frames, disp: m.disp, dispA: m.dispA, n: e.seq.length }, ss: m.ss, breaks: breaksArr(e), maxR: m.maxR };
  viewer.setProtein(m.protein);
  viewer.t = 0; dir = 1; hold = 0.6;
  setEmph();
  viewer.draw(0, true);
  drawTrack(e, m); regionSeq(e, m); metaTable(e, m);
  $('#exportPdb').disabled = false;
  setPlaying(true);
  // warm the cache for the next row while this one plays
  const next = document.querySelector(`#rows tr[data-id="${CSS.escape(e.id)}"]`)?.nextElementSibling?.dataset.id;
  const ne = next && entries.find(x => x.id === next);
  if (ne && ne.seq.length < 400) setTimeout(() => morphFor(ne), 400);
}

function stateLabel(e, t) {
  const el = $('#dState');
  const html = t < 0.03 ? `<b class="t-helix">Fold A</b> · ${e.a.pdb}` : t > 0.97 ? `<b class="t-strand">Fold B</b> · ${e.b.pdb}` : '<b>Switching</b>';
  if (el._h !== html) { el.innerHTML = html; el._h = html; }
  $('#pct').textContent = `${Math.round(t * 100)}%`;
}

let last = performance.now();
function tick(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (viewer.protein && current && current._m) {
    if (playing) {
      if (hold > 0) hold -= dt;
      else {
        viewer.t += dir * dt / DURATION;
        if (viewer.t >= 1) { viewer.t = 1; dir = -1; hold = 1.2; }
        if (viewer.t <= 0) { viewer.t = 0; dir = 1; hold = 1.2; }
      }
      $('#scrub').value = Math.round(viewer.t * 1000);
    }
    updateTrack(current._m, viewer.t);
    stateLabel(current, viewer.t);
  }
  viewer.frame(dt);
  requestAnimationFrame(tick);
}

// ---------- citations ----------
{
  const base = location.protocol.startsWith('http') && !/localhost|127\.0\.0\.1/.test(location.host) ? location.origin + location.pathname : null;
  if (base) $('#siteUrl').textContent = base;
  $('#copyCite').addEventListener('click', async () => {
    const text = [...document.querySelectorAll('.refs li')].map((li, i) => `${i + 1}. ${li.textContent.trim()}`).join('\n');
    try { await navigator.clipboard.writeText(text); $('#copyCite').textContent = 'Copied'; }
    catch (err) { $('#copyCite').textContent = 'Select and copy the list above'; }
    setTimeout(() => { $('#copyCite').textContent = 'Copy citations'; }, 2000);
  });
}

renderTypes();
renderRows();
const fromHash = decodeURIComponent(location.hash.slice(1));
const start = entries.find(e => e.id === fromHash) || entries.find(e => e.id.startsWith('2OUG')) || entries[0];
select(start);
requestAnimationFrame(tick);
