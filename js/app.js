// Essay controller: works out which section is being read, points the sticky
// viewer at the right protein, and drives each section's two-well widget.
import { Viewer } from './viewer.js';
import { Landscape } from './landscape.js';
import { loadProtein } from './structures.js';

const $ = s => document.querySelector(s);
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

const INFO = {
  rfah: { name: 'RfaH C-terminal domain', a: 'α-helical hairpin', b: 'β-barrel' },
  kaib: { name: 'KaiB', a: 'ground-state fold', b: 'fold-switched (thioredoxin-like)' },
  ltn: { name: 'Lymphotactin (XCL1)', a: 'Ltn10, chemokine fold', b: 'Ltn40, all-β fold' },
  mad2: { name: 'Mad2', a: 'open (O-Mad2)', b: 'closed (C-Mad2)' },
};

const viewer = new Viewer($('#view'));
const proteins = {};
const steps = [...document.querySelectorAll('.step')];
let active = null, activeEl = null;

// ---------- two-well model shared by the widgets ----------
// Barrier out of the left well is B − T, out of the right well B + T. The
// protein hops once the barrier out of its current well drops below ~kT, so
// switching shows hysteresis: it stays put in the middle of a trigger range.
const HOP = 0.15;
class Well {
  constructor(host, left, right) { this.ls = new Landscape(host, { left, right }); this.side = -1; this.B = 1; this.T = 0; }
  update(B, T) {
    this.B = B; this.T = T;
    if (this.side < 0 && B - T < HOP) this.side = 1;
    else if (this.side > 0 && B + T < HOP) this.side = -1;
    return this.side;
  }
  barrier() { return Math.max(0, this.side < 0 ? this.B - this.T : this.B + this.T); }
  draw(x) { this.ls.set(this.B, this.T, x ?? this.side); this.ls.note(`barrier ${this.barrier().toFixed(2)}`); }
}

const wells = {
  landscape: new Well($('#lsGeneric'), 'fold A', 'fold B'),
  rfah: new Well($('#lsRfah'), 'α-hairpin', 'β-barrel'),
  kaib: new Well($('#lsKaib'), 'ground', 'fold-switched'),
  ltn: new Well($('#lsLtn'), 'Ltn10', 'Ltn40'),
  mad2: new Well($('#lsMad2'), 'O-Mad2', 'C-Mad2'),
};

// --- generic trigger: tilt and barrier from one slider
function genericModel() {
  const s = $('#trigGeneric').value / 100;
  const T = 2.4 * (s - 0.5), B = 0.9 - 0.25 * Math.abs(T);
  const side = wells.landscape.update(B, T);
  const where = side < 0 ? 'left' : 'right';
  $('#noteGeneric').textContent = s < 0.25 ? `Weak trigger: the ${where} fold holds.`
    : s > 0.75 ? `Strong trigger: the ${where} fold holds.`
      : `Middle range: both folds are stable, so it stays ${where}.`;
  return side;
}

// --- RfaH: binding to paused RNAP releases the CTD
function rfahModel() {
  const on = $('#trigRfah').checked;
  const side = wells.rfah.update(on ? 0.35 : 0.9, on ? 1.0 : -0.8);
  $('#noteRfah').textContent = on
    ? (side > 0 ? 'Released: the CTD refolds into a β-barrel that binds S10.' : 'Releasing…')
    : (side > 0 ? 'Released from RNAP: refolding to α…' : 'Autoinhibited: the CTD stays helical.');
  return side;
}

// --- KaiB: night (KaiC phosphorylated) favours the fold-switched form, with a lag
let clockAuto = true;
function kaibModel() {
  const h = $('#trigKaib').value / 10;
  const T = 0.9 * Math.cos((2 * Math.PI * (h - 2)) / 24);
  const side = wells.kaib.update(0.75, T);
  const hh = Math.floor(h) % 24, mm = Math.floor((h % 1) * 60);
  $('#clockLabel').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  const night = h >= 18 || h < 6;
  $('#noteKaib').textContent = `${night ? 'Night' : 'Day'}: ${side > 0 ? 'fold-switched KaiB binds KaiC.' : 'ground state.'}`;
  return side;
}

// --- Lymphotactin: Boltzmann populations; near 50:50 it hops back and forth
let ltnClock = 0, ltnSide = -1;
function ltnModel(dt) {
  const temp = +$('#trigTemp').value, salt = +$('#trigSalt').value;
  const z = 0.15 * (temp - 37) - 0.015 * (salt - 150);
  const pB = 1 / (1 + Math.exp(-z));
  $('#tempLabel').textContent = `${temp} °C`;
  $('#saltLabel').textContent = `${salt} mM`;
  $('#popA').style.width = `${(1 - pB) * 100}%`; $('#popB').style.width = `${pB * 100}%`;
  $('#popAl').textContent = `Ltn10 ${Math.round((1 - pB) * 100)}%`;
  $('#popBl').textContent = `Ltn40 ${Math.round(pB * 100)}%`;
  const w = wells.ltn;
  w.B = 0.45; w.T = clamp(z * 0.3, -1.2, 1.2);
  // sample the equilibrium every ~2 s: a population, not a single switch
  ltnClock += dt;
  if (ltnClock > 2.2) { ltnClock = 0; ltnSide = Math.random() < pB ? 1 : -1; }
  w.side = ltnSide;
  return ltnSide;
}

// --- Mad2: spontaneous closing takes hours; the Mad1:C-Mad2 template makes it seconds
const mad2 = { side: -1, waiting: false, progress: 0, duration: 0 };
function mad2Model(dt) {
  const tmpl = $('#trigMad2').checked;
  const w = wells.mad2;
  w.B = tmpl ? 0.4 : 1.15; w.T = 0.25;
  if (mad2.waiting) {
    mad2.progress += dt / mad2.duration;
    const hours = tmpl ? null : mad2.progress * 6;
    $('#waitFill').style.width = `${clamp(mad2.progress) * 100}%`;
    $('#waitLabel').textContent = tmpl ? `templated: ${(mad2.progress * 3).toFixed(1)} s` : `spontaneous: ${hours.toFixed(1)} h`;
    if (mad2.progress >= 1) { mad2.waiting = false; mad2.side = 1; $('#goMad2').textContent = 'Let it switch'; $('#goMad2').disabled = true; }
  }
  w.side = mad2.side;
  return mad2.side;
}
$('#goMad2').addEventListener('click', () => {
  if (mad2.side > 0) return;
  if (mad2.waiting) { mad2.progress = 1; return; }    // fast-forward
  mad2.waiting = true; mad2.progress = 0;
  mad2.duration = $('#trigMad2').checked ? 1.2 : 9;
  $('#goMad2').textContent = 'Fast-forward';
});
$('#resetMad2').addEventListener('click', () => {
  mad2.side = -1; mad2.waiting = false; mad2.progress = 0;
  $('#waitFill').style.width = '0'; $('#waitLabel').textContent = '';
  $('#goMad2').textContent = 'Let it switch'; $('#goMad2').disabled = false;
});
$('#trigKaib').addEventListener('input', () => { clockAuto = false; });

// ---------- linear vs relaxed ----------
let drawLinear = false;
function setLinear(on) {
  drawLinear = on;
  $('#mLinear').classList.toggle('on', on); $('#mRelaxed').classList.toggle('on', !on);
}
$('#mLinear').addEventListener('click', () => setLinear(true));
$('#mRelaxed').addEventListener('click', () => setLinear(false));
let drawTouched = false;
$('#scrubDraw').addEventListener('input', () => { drawTouched = true; });

// ---------- sections ----------
// Each section names a protein and how the morph target is chosen.
let pingTimer = 0;
function pingPong(dt) {
  if (Math.abs(viewer.t - viewer.target) < 1e-3) { pingTimer += dt; if (pingTimer > 1.6) { pingTimer = 0; viewer.target = viewer.target > 0.5 ? 0 : 1; } }
  return viewer.target ?? 0;
}
const SECTIONS = {
  hero: { protein: 'rfah', seconds: 3, target: pingPong },
  rule: { protein: 'rfah', seconds: 1.5, target: () => 0 },
  exception: { protein: 'rfah', seconds: 0.25, highlight: true, target: (dt, p) => clamp((p - 0.18) / 0.55) },
  landscape: { protein: 'rfah', seconds: 1.4, target: () => (genericModel() > 0 ? 1 : 0), well: 'landscape' },
  rfah: { protein: 'rfah', seconds: () => ($('#trigRfah').checked ? 1.6 : 4), target: () => (rfahModel() > 0 ? 1 : 0), well: 'rfah' },
  kaib: { protein: 'kaib', seconds: 3, target: () => (kaibModel() > 0 ? 1 : 0), well: 'kaib' },
  ltn: { protein: 'ltn', seconds: 0.9, target: dt => (ltnModel(dt) > 0 ? 1 : 0), well: 'ltn' },
  mad2: { protein: 'mad2', seconds: 2.5, target: dt => (mad2Model(dt) > 0 ? 1 : 0), well: 'mad2' },
  drawing: { protein: 'ltn', seconds: 0.2, linear: true, clashes: true, target: () => $('#scrubDraw').value / 1000 },
  why: { protein: 'rfah', seconds: 3, target: pingPong },
  credits: { protein: 'rfah', seconds: 3, target: pingPong },
};
const val = (v, ...a) => (typeof v === 'function' ? v(...a) : v);

function readingLine() { return innerWidth <= 860 ? innerHeight * 0.72 : innerHeight * 0.5; }

function findActive() {
  const y = readingLine();
  let best = steps[0];
  for (const el of steps) { const r = el.getBoundingClientRect(); if (r.top <= y) best = el; }
  const r = best.getBoundingClientRect();
  return { el: best, key: best.dataset.step, progress: clamp((y - r.top) / r.height) };
}

function caption(key, t) {
  const p = proteins[key]; const info = INFO[key];
  $('#capName').textContent = info.name;
  const b = t > 0.5;
  const st = $('#capState');
  st.textContent = t > 0.08 && t < 0.92 ? 'switching…' : b ? info.b : info.a;
  st.style.color = t > 0.08 && t < 0.92 ? 'var(--text)' : b ? 'var(--strand)' : 'var(--helix)';
  $('#capPdb').textContent = `PDB ${b ? p.pdbB : p.pdbA}`;
}

// ---------- main loop ----------
let last = performance.now(), shown = null;
function tick(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const { el, key, progress } = findActive();
  const sec = SECTIONS[key] || SECTIONS.hero;
  if (el !== activeEl) { activeEl = el; active = key; pingTimer = 0; }

  // the KaiB clock runs by itself until the reader grabs it
  if (key === 'kaib' && clockAuto) { const s = $('#trigKaib'); s.value = (+s.value + dt * 25) % 240; }

  let pid = val(sec.protein);
  if (!proteins[pid]) pid = shown && proteins[shown] ? shown : null;
  if (pid) {
    const p = proteins[pid];
    viewer.useLinear = sec.linear ? drawLinear : false;
    viewer.showClashes = !!sec.clashes;
    viewer.highlightMoving = !!sec.highlight;
    viewer.morphSeconds = val(sec.seconds);
    const target = sec.target(dt, progress);
    if (shown !== pid) {
      viewer.setProtein(p); shown = pid;
      viewer.t = target; viewer.target = target; viewer.draw(0, true);
    } else viewer.target = target;
    viewer.frame(dt);
    caption(pid, viewer.t);
  }

  // landscapes: the active one follows the 3D morph; the rest show their well
  for (const k in wells) {
    const w = wells[k];
    if (SECTIONS[key].well === k && pid) w.draw(-1 + 2 * viewer.t);
    else if (k === 'landscape') { genericModel(); w.draw(); }
    else w.draw();
  }
  if (key === 'exception') {
    $('#scrubFill').style.width = `${viewer.t * 100}%`;
    $('#scrubLabel').textContent = viewer.t < 0.08 ? 'α-hairpin' : viewer.t > 0.92 ? 'β-barrel' : 'unwinding…';
  }
  if (key === 'drawing' && viewer.minDist != null) {
    const d = viewer.minDist;
    $('#drawReadout').innerHTML = `closest Cα–Cα approach: <b style="color:${d < 3 ? 'var(--clash)' : 'var(--text)'}">${d.toFixed(2)} Å</b>${d < 3 ? ' — chain passes through itself' : ''}`;
    // a gentle automatic sweep until the reader takes the slider
    if (!drawTouched) { const s = $('#scrubDraw'); s.value = 500 + 480 * Math.sin(now / 2600); }
  }
  requestAnimationFrame(tick);
}

// ---------- loading ----------
async function boot() {
  try {
    proteins.rfah = await loadProtein('rfah');
  } catch (e) {
    $('#stageLoading').textContent = `Could not load structures: ${e.message}`;
    return;
  }
  $('#stageLoading').classList.add('done');
  requestAnimationFrame(tick);
  // the rest load one by one, yielding so scrolling stays smooth
  for (const id of ['ltn', 'kaib', 'mad2']) {
    await new Promise(r => setTimeout(r, 30));
    try { proteins[id] = await loadProtein(id); } catch (e) { console.warn(id, e); }
  }
}

boot();
