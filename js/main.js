// App shell: screens, storage, input, HUD and the main loop.
import { World, COLORS } from './scene.js';
import { Audio } from './audio.js';
import { Game } from './game.js';
import { LEVELS, ENDLESS } from './levels.js';
import { loadProtein } from './structures.js';
import { drawThumb, morphLoop, makeCard, HEX } from './share.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

// ---------- storage (always wrapped: private mode / blocked storage must not break the game) ----------
const KEY = 'metamorph.v1';
const store = (() => {
  let data = { unlocked: 1, best: {}, endlessBest: 0, muted: false };
  try { const raw = localStorage.getItem(KEY); if (raw) data = { ...data, ...JSON.parse(raw) }; } catch (e) { /* ignore */ }
  return {
    get: () => data,
    set(patch) { data = { ...data, ...patch }; try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* ignore */ } },
  };
})();

// ---------- globals ----------
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('is-touch');
const world = new World($('#gl'));
const audio = new Audio();
audio.muted = store.get().muted;
const proteins = {};
let state = 'loading';
let currentLevel = null, mode = 'level', lastResult = null, stopLoop = null, seed = 7;

const ui = {
  toast(text, color = '#fff') {
    const el = document.createElement('div'); el.className = 'toast'; el.textContent = text; el.style.color = color;
    const box = $('#toasts'); box.appendChild(el);
    while (box.children.length > 2) box.firstChild.remove();
    setTimeout(() => el.remove(), 2500);
  },
  pop(text, color) {
    const el = document.createElement('div'); el.className = 'pop'; el.textContent = text; el.style.color = color;
    el.style.top = (Math.random() * 30 - 15) + 'px';
    $('#pops').appendChild(el); setTimeout(() => el.remove(), 1150);
  },
  banner(title, desc) {
    const b = $('#banner'); b.classList.remove('hidden');
    b.querySelector('h3').textContent = title; b.querySelector('p').textContent = desc;
    b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
    clearTimeout(ui._bt); ui._bt = setTimeout(() => b.classList.add('hidden'), 5000);
  },
  hearts(n) { $('#hudHearts').innerHTML = [0, 1, 2].map(i => `<i class="${i < n ? 'on' : ''}"></i>`).join(''); },
  end(r) { setTimeout(() => showEnd(r), r.won ? 600 : 900); },
};
const game = new Game(world, audio, ui);
if (new URLSearchParams(location.search).has('debug')) window.__mm = { game, world, LEVELS, proteins: null };

// ---------- screens ----------
function show(id) {
  $$('.screen').forEach(s => s.classList.toggle('show', s.id === id));
  state = id;
  $('#hud').classList.toggle('hidden', !['play', 'pause', 'end'].includes(id));
}

function setMuteIcons() {
  const m = audio.muted;
  const svg = m
    ? '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2" fill="none"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12" stroke="currentColor" stroke-width="2" fill="none"/></svg>';
  ['#btnMuteHud', '#btnMuteMenu'].forEach(s => { $(s).innerHTML = svg; $(s).setAttribute('aria-label', m ? 'Unmute' : 'Mute'); });
}
function toggleMute() { audio.unlock(); audio.setMuted(!audio.muted); store.set({ muted: audio.muted }); setMuteIcons(); }

function renderLevels() {
  const grid = $('#levelGrid'); grid.innerHTML = '';
  const s = store.get();
  LEVELS.forEach((L, i) => {
    const locked = i >= s.unlocked && !window.__mm;
    const b = document.createElement('button');
    b.className = 'level-card' + (locked ? ' locked' : '');
    b.innerHTML = `<canvas width="360" height="180"></canvas><div class="num">LEVEL ${i + 1}</div><div class="name">${L.name}</div><div class="best">${locked ? 'locked: finish level ' + i : s.best[L.id] ? 'best ' + s.best[L.id].toLocaleString() : L.folds[0].short + ' ⇄ ' + L.folds[1].short}</div>`;
    grid.appendChild(b);
    drawThumb(b.querySelector('canvas'), proteins[L.id]);
    b.addEventListener('click', () => { if (!locked) openIntro(L); });
  });
}

function openIntro(L) {
  currentLevel = L; mode = 'level';
  const i = LEVELS.indexOf(L);
  $('#introNum').textContent = `Level ${i + 1} of ${LEVELS.length}`;
  $('#introName').textContent = L.full;
  $('#introOrg').innerHTML = `<i>${L.organism}</i> · PDB ${L.folds[0].pdb} ⇄ ${L.folds[1].pdb}`;
  $('#introText').textContent = L.intro.join(' ');
  $('#introTrigger').textContent = L.trigger;
  $('#introFoldA').textContent = L.folds[0].name;
  $('#introFoldB').textContent = L.folds[1].name;
  $('#introBoss').innerHTML = `<b>Final stretch: ${L.boss.title}.</b> ${L.boss.desc}`;
  drawThumb($('#introThumb'), proteins[L.id]);
  show('intro');
}

function startRun() {
  audio.unlock();
  if (stopLoop) { stopLoop(); stopLoop = null; }
  $('#hudLevel').textContent = mode === 'endless' ? 'Endless' : currentLevel.name;
  $('#hudBoss').classList.add('hidden');
  ui.hearts(3);
  $('#toasts').innerHTML = ''; $('#pops').innerHTML = ''; $('#banner').classList.add('hidden');
  if (mode === 'endless') game.start(ENDLESS, proteins, 'endless', (Math.random() * 1e9) | 0);
  else game.start(currentLevel, proteins, 'level', seed);
  show('play');
  ui.toast(mode === 'endless' ? 'Proteins rotate every 40 s. How far can you get?' : `${currentLevel.folds[0].name}: Spring form`, HEX.a);
}

function showEnd(r) {
  lastResult = r;
  // trust the run that just ended, not whatever screen state led to it
  mode = game.mode;
  if (mode !== 'endless') currentLevel = game.level;
  const s = store.get();
  let best, isNew = false;
  if (mode === 'endless') {
    best = Math.max(s.endlessBest || 0, r.score); isNew = r.score > (s.endlessBest || 0);
    store.set({ endlessBest: best });
    $('#endEyebrow').textContent = 'Endless';
    $('#endTitle').textContent = 'Denatured';
    $('#endNote').textContent = `${game.switches} fold switches · ${game.perfects} just-in-time`;
    $('#btnNext').classList.add('hidden');
  } else {
    const prev = s.best[currentLevel.id] || 0;
    best = Math.max(prev, r.won ? r.score : prev); isNew = r.won && r.score > prev;
    const i = LEVELS.indexOf(currentLevel);
    store.set({ best: { ...s.best, [currentLevel.id]: best }, unlocked: r.won ? Math.max(s.unlocked, Math.min(LEVELS.length, i + 2)) : s.unlocked });
    $('#endEyebrow').textContent = currentLevel.full;
    $('#endTitle').textContent = r.won ? 'Level complete' : 'Denatured';
    const extra = currentLevel.boss.type === 'checkpoint' ? ` · Cdc20 captured ${r.checkpoint}/${currentLevel.boss.target}` :
      currentLevel.boss.type === 'receptors' ? ` · partners bound ${r.checkpoint}` :
      currentLevel.boss.type === 'lock' ? ` · ribosomes docked ${r.checkpoint}` : '';
    $('#endNote').textContent = r.won ? `${game.switches} fold switches · ${game.perfects} just-in-time${extra}` : 'Out of integrity. Switch earlier, and use the trigger zones.';
    const hasNext = r.won && i < LEVELS.length - 1;
    $('#btnNext').classList.toggle('hidden', !hasNext);
    $('#btnNext').textContent = hasNext ? `Next: ${LEVELS[i + 1].name}` : '';
  }
  $('#endScore').textContent = r.score.toLocaleString();
  $('#endBest').textContent = isNew ? 'new best!' : `best ${best.toLocaleString()}`;
  lastResult.best = best;
  show('end');
  if (stopLoop) stopLoop();
  stopLoop = morphLoop($('#endLoop'), world.protein);
}

function cardCanvas() {
  const p = world.protein;
  const def = LEVELS.find(l => l.id === p.id);
  const url = (location.host ? location.host + location.pathname.replace(/index\.html$/, '') : 'metamorph').replace(/\/$/, '');
  return makeCard({ level: def, protein: p, score: lastResult.score, best: lastResult.best, mode, result: lastResult.won ? 'complete' : 'denatured', url });
}
function saveCard() {
  cardCanvas().toBlob(b => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'metamorph-card.png';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
}
function shareCard() {
  cardCanvas().toBlob(async b => {
    const file = new File([b], 'metamorph-card.png', { type: 'image/png' });
    const text = `I scored ${lastResult.score.toLocaleString()} as a fold-switching protein in Metamorph.`;
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Metamorph', text, url: location.href }); return; }
      if (navigator.share) { await navigator.share({ title: 'Metamorph', text, url: location.href }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    saveCard();
  });
}

function pause() { if (state !== 'play') return; game.running = false; audio.pause(); show('pause'); }
function resume() { if (state !== 'pause') return; audio.unlock(); audio.resume(); game.running = true; show('play'); }

// ---------- energy landscape meter ----------
const lc = $('#landscape'), lx = lc.getContext('2d');
function sizeLandscape() {
  const r = lc.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
  lc.width = Math.round(r.width * d) || 240; lc.height = Math.round(r.height * d) || 110;
}
let ballX = -1;
function drawLandscape(dt) {
  const W = lc.width, H = lc.height, k = W / 240;
  lx.clearRect(0, 0, W, H);
  const env = game.env_ || { tilt: 0, mul: 1 };
  const def = game.curDef;
  const barrier = game.locked ? 160 : game.base * env.mul;
  const tilt = env.tilt;
  const G = x => barrier * (x * x - 1) ** 2 - tilt * x;
  const yMin = -45, yMax = 115;
  const top = 14 * k, bot = H - 16 * k;
  const X = x => W / 2 + x * (W * 0.36);
  const Y = g => bot - ((Math.min(yMax, g) - yMin) / (yMax - yMin)) * (bot - top);
  // curve
  const grad = lx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, HEX.a); grad.addColorStop(1, HEX.b);
  lx.beginPath();
  for (let i = 0; i <= 80; i++) { const x = -1.45 + (2.9 * i) / 80; const px = X(x), py = Y(G(x)); i ? lx.lineTo(px, py) : lx.moveTo(px, py); }
  lx.strokeStyle = grad; lx.lineWidth = 2.5 * k; lx.shadowColor = '#fff'; lx.shadowBlur = 6 * k; lx.stroke(); lx.shadowBlur = 0;
  // ball position: follows the morph over the hump
  const target = game.morphT * 2 - 1;
  ballX = target;
  const wob = game.ballWobble * Math.sin(performance.now() / 25) * 0.18;
  const bx = ballX + wob * (game.fold ? -1 : 1);
  const bxClamped = Math.max(-1.4, Math.min(1.4, bx));
  // energy line above the current well
  const wellG = G(game.fold ? 1 : -1);
  const eY = Y(wellG + game.energy);
  const hump = G(0.0) + Math.max(0, -tilt * 0);
  const canSwitch = game.energy >= game.cost(1 - game.fold, env);
  lx.setLineDash([4 * k, 4 * k]);
  lx.strokeStyle = canSwitch ? 'rgba(184,255,207,0.9)' : 'rgba(255,138,160,0.9)';
  lx.lineWidth = 1.5 * k;
  lx.beginPath(); lx.moveTo(X(game.fold ? 0.25 : -1.45), eY); lx.lineTo(X(game.fold ? 1.45 : -0.25), eY); lx.stroke();
  lx.setLineDash([]);
  // ball
  const by = Y(G(bxClamped)) - 7 * k;
  const col = game.morphT > 0.5 ? HEX.b : HEX.a;
  lx.beginPath(); lx.arc(X(bxClamped), by, 6 * k, 0, Math.PI * 2);
  lx.fillStyle = col; lx.shadowColor = col; lx.shadowBlur = 12 * k; lx.fill(); lx.shadowBlur = 0;
  // labels
  lx.font = `600 ${10 * k}px "JetBrains Mono", monospace`; lx.textAlign = 'center';
  lx.fillStyle = HEX.a; lx.fillText(def.folds ? def.folds[0].short : 'A', X(-1), H - 3 * k);
  lx.fillStyle = HEX.b; lx.fillText(def.folds ? def.folds[1].short : 'B', X(1), H - 3 * k);
  lx.fillStyle = 'rgba(220,228,255,0.6)'; lx.textAlign = 'left';
  lx.fillText('ΔG', 4 * k, 11 * k);
  lx.textAlign = 'right';
  const c = game.cost(1 - game.fold, env);
  lx.fillStyle = canSwitch ? '#b8ffcf' : '#ff8aa0';
  lx.fillText(game.locked ? 'locked' : `switch ${Math.round(c)} · E ${Math.round(game.energy)}`, W - 4 * k, 11 * k);
  // beat ring for the KaiB boss
  if (game.bossOn && game.flips) {
    lx.strokeStyle = `rgba(255,255,255,${0.15 + game.beatPulse * 0.6})`; lx.lineWidth = 2 * k;
    lx.beginPath(); lx.arc(X(0), Y(hump) - 12 * k, (5 + game.beatPulse * 6) * k, 0, Math.PI * 2); lx.stroke();
  }
  const tag = $('#foldTag');
  const name = def.folds ? def.folds[game.fold].name : '';
  const zl = env.zone ? ` · ${env.zone.label}` : '';
  const txt = name + zl;
  if (tag.textContent !== txt) { tag.textContent = txt; tag.style.color = game.fold ? HEX.b : HEX.a; }
}

// ---------- HUD ----------
let lastScore = -1;
function updateHud() {
  const sc = game.totalScore();
  if (sc !== lastScore) { $('#hudScore').textContent = sc.toLocaleString(); lastScore = sc; }
  $('#hudProgress').style.width = (mode === 'endless' ? (game.t % 40) / 40 * 100 : Math.min(100, (game.x / game.length) * 100)) + '%';
  const L = game.level, hb = $('#hudBoss');
  if (game.bossOn && L.boss) {
    hb.classList.remove('hidden');
    const t = L.boss.type;
    hb.textContent = t === 'checkpoint' ? `Cdc20 ${game.bossCount}/${L.boss.target}` : t === 'receptors' ? `Partners bound ${game.bossCount}` :
      t === 'lock' ? `Ribosomes docked ${game.bossCount}` : `Switch on the beat · ${game.env_ && game.env_.day > 0.5 ? 'day' : 'night'}`;
  }
}

// ---------- input ----------
addEventListener('keydown', e => {
  audio.unlock();
  if (e.repeat && (e.code === 'Space' || e.code === 'ArrowUp')) { e.preventDefault(); return; }
  if (state === 'play') {
    if (['ArrowUp', 'KeyW'].includes(e.code)) { game.jump(); e.preventDefault(); }
    else if (['ArrowDown', 'KeyS'].includes(e.code)) { game.drop(); e.preventDefault(); }
    else if (['Space', 'ShiftLeft', 'ShiftRight', 'KeyX'].includes(e.code)) { game.switchFold(); e.preventDefault(); }
    else if (['Escape', 'KeyP'].includes(e.code)) pause();
  } else if (state === 'pause' && ['Escape', 'KeyP', 'Space'].includes(e.code)) { resume(); e.preventDefault(); }
  if (e.code === 'KeyM') toggleMute();
});
addEventListener('keyup', e => { if (state === 'play' && ['ArrowUp', 'KeyW'].includes(e.code)) game.jumpRelease(); });
addEventListener('pointerdown', () => audio.unlock(), { capture: true });

const touch = $('#touch');
let tStart = null;
touch.addEventListener('pointerdown', e => {
  if (state !== 'play') return;
  e.preventDefault();
  const left = e.clientX < innerWidth * 0.4;
  tStart = { x: e.clientX, y: e.clientY, id: e.pointerId, left };
  if (left) game.switchFold(); else game.jump();
});
touch.addEventListener('pointermove', e => {
  if (!tStart || e.pointerId !== tStart.id) return;
  const dx = e.clientX - tStart.x, dy = e.clientY - tStart.y;
  if (dy > 40 && dy > Math.abs(dx)) { game.drop(); tStart.id = -1; }
  else if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) && !tStart.left) { game.switchFold(); tStart.id = -1; }
});
const endTouch = () => { if (tStart && !tStart.left) game.jumpRelease(); tStart = null; };
touch.addEventListener('pointerup', endTouch);
touch.addEventListener('pointercancel', endTouch);

document.addEventListener('visibilitychange', () => { if (document.hidden && !window.__mm) pause(); });
addEventListener('blur', () => { if (!window.__mm) pause(); });
addEventListener('resize', sizeLandscape);

// buttons
$$('[data-go]').forEach(b => b.addEventListener('click', () => { const id = b.dataset.go; if (id === 'levels') renderLevels(); show(id); }));
$$('[data-modal]').forEach(b => b.addEventListener('click', () => $('#' + b.dataset.modal).classList.add('show')));
$$('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-close]')) m.classList.remove('show'); }));
$('#btnStart').addEventListener('click', startRun);
$('#btnEndless').addEventListener('click', () => { mode = 'endless'; currentLevel = null; startRun(); });
$('#btnPause').addEventListener('click', pause);
$('#btnResume').addEventListener('click', resume);
$('#btnRestart').addEventListener('click', () => { audio.resume(); startRun(); });
$('#btnQuit').addEventListener('click', () => { audio.resume(); toMenu(); });
$('#btnRetry').addEventListener('click', startRun);
$('#btnNext').addEventListener('click', () => { const i = LEVELS.indexOf(currentLevel); openIntro(LEVELS[i + 1]); });
$('#btnEndMenu').addEventListener('click', toMenu);
$('#btnShare').addEventListener('click', shareCard);
$('#btnSave').addEventListener('click', saveCard);
$('#btnMuteHud').addEventListener('click', toggleMute);
$('#btnMuteMenu').addEventListener('click', toggleMute);

function toMenu() {
  game.running = false; audio.stopMusic();
  if (stopLoop) { stopLoop(); stopLoop = null; }
  world.clearAll(game.items || [], game.zones || []);
  game.items = []; game.zones = [];
  showcase.start();
  show('menu');
}

// ---------- menu showcase: the protein slowly morphing back and forth ----------
const showcase = {
  i: 0, t: 0, p: 0, dir: 1, hold: 2.2,
  start() { this.t = 0; this.p = 0; this.dir = 1; this.hold = 1.6; world.setProtein(proteins[LEVELS[this.i].id]); },
  update(dt) {
    if (this.hold > 0) { this.hold -= dt; if (this.hold <= 0 && this.dir === -1 && this.p <= 0) { this.i = (this.i + 1) % LEVELS.length; world.setProtein(proteins[LEVELS[this.i].id]); this.hold = 1.2; this.dir = 1; } return; }
    this.p += this.dir * dt / 0.9;
    if (this.p >= 1) { this.p = 1; this.dir = -1; this.hold = 2.4; }
    if (this.p <= 0) { this.p = 0; this.hold = 0.8; }
  },
  view(time) {
    const e = this.p * this.p * (3 - 2 * this.p);
    return { px: 0, py: 0.3, form: 0, morphT: e, glow: this.hold > 0 ? 0 : Math.sin(Math.PI * this.p), hurt: 0, roll: 0, menu: true, lookAhead: 0, day: 0 };
  },
};

// ---------- loop ----------
let last = performance.now(), time = 0, slowFrames = 0, frameCount = 0;
function loop(now) {
  const raw = (now - last) / 1000; last = now;
  const dt = Math.min(1 / 30, raw);
  time += dt;
  if (state === 'play' && game.running) {
    game.update(dt);
    world.frame(dt, time, game.view());
    drawLandscape(dt);
    updateHud();
    // drop bloom if the device is struggling
    frameCount++;
    if (raw > 0.026) slowFrames++;
    if (frameCount === 150) { if (slowFrames > 60 && world.quality > 0) world.setQuality(0); frameCount = 0; slowFrames = 0; }
  } else if (state === 'play' || state === 'pause' || state === 'end') {
    world.frame(0, time, { ...game.view(), glow: 0 });
  } else if (world.protein) {
    showcase.update(dt);
    world.frame(dt, time, showcase.view(time));
  }
  requestAnimationFrame(loop);
}

// ---------- boot ----------
async function boot() {
  setMuteIcons();
  sizeLandscape();
  const results = await Promise.all(LEVELS.map(L => loadProtein(L.id)));
  results.forEach(p => (proteins[p.id] = p));
  if (window.__mm) Object.assign(window.__mm, { proteins, hud: () => { drawLandscape(0); updateHud(); } });
  const live = results.filter(p => p.source.startsWith('RCSB')).length;
  $('#menuSource').textContent = live === results.length ? 'Structures loaded live from RCSB PDB' : live ? `Structures: ${live}/4 live from RCSB PDB, rest bundled` : 'Structures: bundled copies (RCSB unreachable)';
  $('#pdbList').innerHTML = LEVELS.map(L => `<li><b>${L.name}</b>: ${L.folds.map(f => `<a href="https://www.rcsb.org/structure/${f.pdb}" target="_blank" rel="noopener">${f.pdb}</a> ${f.name}`).join(' ⇄ ')}</li>`).join('');
  const eb = store.get().endlessBest; $('#endlessBest').textContent = eb ? 'best ' + eb.toLocaleString() : '';
  showcase.start();
  show('menu');
  requestAnimationFrame(loop);
}
boot().catch(err => { console.error(err); $('#loadMsg').textContent = 'Something went wrong loading the game. Try reloading.'; });
