// Headless playtest bot. Open index.html?debug, then in the console:
//   const { runAll } = await import('./tools/bot.js'); console.log(runAll());
// It plays every level at a fixed 60 Hz step without rendering and reports
// whether the course is beatable on the energy budget.
const needs = it => it.type === 'wall' ? 0 : it.type === 'bar' || it.type === 'protease' ? 1 : it.type === 'gate' ? it.fold : -1;

export function runBot(L, mode = 'level', maxSeconds = 200, seed = 7) {
  const { game, proteins } = window.__mm;
  game.start(L, proteins, mode, seed);
  let steps = 0, fails = 0, minE = 100;
  const hitBy = {};
  const origFail = game.failSwitch.bind(game), origDmg = game.damage.bind(game);
  game.failSwitch = () => { fails++; };
  game.damage = () => {
    if (game.invuln <= 0) {
      const it = game.live.filter(i => i.done && Math.abs(i.x - game.x) < 1.5)[0];
      const k = it ? it.type : '?';
      hitBy[k] = (hitBy[k] || 0) + 1;
    }
    origDmg();
  };
  while (game.running && steps < 60 * maxSeconds) {
    const ahead = game.live.filter(it => !it.done && needs(it) >= 0 && it.x + (it.w || 0.3) / 2 > game.x - 0.5).sort((a, b) => a.x - b.x);
    const nxt = ahead[0];
    if (game.bossOn && game.flips) {
      const f = game.flips.find(t => Math.abs(t - game.t) < 0.02);
      if (f !== undefined && game.fold !== (game.flips.indexOf(f) % 2 === 0 ? 1 : 0)) game.switchFold();
    } else if (nxt && needs(nxt) !== game.fold && nxt.x - game.x < 10) game.switchFold();
    if (nxt && nxt.type === 'wall' && game.fold === 0 && nxt.x - game.x < 2.9 && nxt.x - game.x > 2.2) game.jump();
    game.update(1 / 60); steps++;
    minE = Math.min(minE, game.energy);
  }
  game.failSwitch = origFail; game.damage = origDmg;
  const won = game.x >= game.length;
  game.running = false;
  return `${L.id || mode}: won=${won} hearts=${game.hearts} t=${game.t.toFixed(1)}s hitBy=${JSON.stringify(hitBy)} switches=${game.switches} failFrames=${fails} minE=${minE.toFixed(0)} score=${game.totalScore()} boss=${game.bossCount}`;
}

export function runAll() {
  const out = window.__mm.LEVELS.map(L => runBot(L));
  out.push(runBot({ id: 'endless' }, 'endless', 120));
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('show'));
  return out.join('\n');
}

// Real-time autopilot for visual checks: starts level i (or endless when i < 0)
// through the UI and freezes the game when stopWhen(game) is true.
export async function demo(i, stopWhen, ms = 30000) {
  await new Promise(res => { const chk = () => (window.__mm && window.__mm.proteins && document.querySelector('#menu.show')) ? res() : setTimeout(chk, 100); chk(); });
  const { game } = window.__mm;
  if (i < 0) document.querySelector('#btnEndless').click();
  else {
    document.querySelector('[data-go=levels]').click();
    document.querySelectorAll('.level-card')[i].classList.remove('locked');
    document.querySelectorAll('.level-card')[i].click();
    document.querySelector('#btnStart').click();
  }
  const t0 = performance.now();
  await new Promise(res => {
    const step = () => {
      if (game.running) {
        const nxt = game.live.filter(it => !it.done && needs(it) >= 0 && it.x + (it.w || 0.3) / 2 > game.x - 0.5).sort((a, b) => a.x - b.x)[0];
        if (game.bossOn && game.flips) {
          const f = game.flips.find(t => Math.abs(t - game.t) < 0.03);
          if (f !== undefined && game.fold !== (game.flips.indexOf(f) % 2 === 0 ? 1 : 0)) game.switchFold();
        } else if (nxt && needs(nxt) !== game.fold && nxt.x - game.x < 6) game.switchFold();
        if (nxt && nxt.type === 'wall' && game.fold === 0 && nxt.x - game.x < 2.9 && nxt.x - game.x > 2.2) game.jump();
      }
      if (stopWhen(game) || performance.now() - t0 > ms) { game.running = false; res(); } else requestAnimationFrame(step);
    };
    step();
  });
  return `x=${game.x.toFixed(1)} t=${game.t.toFixed(1)} fold=${game.fold} morphP=${game.morphP.toFixed(2)}`;
}

// Deterministic visual check: step the simulation (bot driving) until
// stopWhen(game), then render one frame. Works even when the page is throttled.
export function stepTo(stopWhen, maxSeconds = 120) {
  const { game, world } = window.__mm;
  let steps = 0;
  while (game.running && !stopWhen(game) && steps < maxSeconds * 60) {
    const nxt = game.live.filter(it => !it.done && needs(it) >= 0 && it.x + (it.w || 0.3) / 2 > game.x - 0.5).sort((a, b) => a.x - b.x)[0];
    if (game.bossOn && game.flips) {
      const f = game.flips.find(t => Math.abs(t - game.t) < 0.02);
      if (f !== undefined && game.fold !== (game.flips.indexOf(f) % 2 === 0 ? 1 : 0)) game.switchFold();
    } else if (nxt && needs(nxt) !== game.fold && nxt.x - game.x < 6) game.switchFold();
    if (nxt && nxt.type === 'wall' && game.fold === 0 && nxt.x - game.x < 2.9 && nxt.x - game.x > 2.2) game.jump();
    game.update(1 / 60);
    if (steps % 2 === 0) world.frame(1 / 30, game.t, game.view());   // keep camera/particles moving
    steps++;
  }
  const wasRunning = game.running;
  game.running = false;
  world.frame(1 / 60, game.t, game.view());
  if (window.__mm.hud) window.__mm.hud();
  return `x=${game.x.toFixed(1)} t=${game.t.toFixed(1)} fold=${game.fold} morphP=${game.morphP.toFixed(2)} hearts=${game.hearts} running=${wasRunning}`;
}
