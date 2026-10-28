// Run state, physics, energy landscape and boss rules.
import { buildCourse, endlessGen, LEVELS, ENDLESS } from './levels.js';
import { COLORS } from './scene.js';

const G = 32;
const JUMP = [14.5, 7.6];             // Spring, Shell
const HIT = [{ w: 0.8, h: 1.6 }, { w: 1.0, h: 1.0 }];
const MORPH_TIME = 0.5;
const BEAT = 60 / 112;

const needs = it => it.type === 'wall' ? 0 : it.type === 'bar' || it.type === 'protease' ? 1 : it.type === 'gate' ? it.fold : -1;

export class Game {
  constructor(world, audio, ui) {
    this.world = world; this.audio = audio; this.ui = ui;
    this.running = false;
  }

  // level: entry from LEVELS (or ENDLESS); proteins: { id: data }
  start(level, proteins, mode = 'level', seed = 7) {
    this.level = level; this.mode = mode; this.proteins = proteins;
    this.t = 0; this.x = 0; this.y = 0; this.vy = 0; this.grounded = true;
    this.fold = 0; this.morphFrom = 0; this.morphTo = 0; this.morphP = 1; this.morphT = 0;
    this.energy = 70; this.hearts = 3; this.invuln = 0; this.score = 0; this.bonus = 0;
    this.roll = 0; this.hurt = 0; this.coyote = 0; this.jumpBuf = 0;
    this.locked = false; this.bossOn = false; this.bossCount = 0; this.ended = false;
    this.failMsgAt = -10; this.ballWobble = 0; this.zoneSeen = new Set(); this.switches = 0; this.perfects = 0;
    this.lastBeat = -1; this.beatPulse = 0;
    this.world.clearAll(this.items || [], this.zones || []);
    if (mode === 'endless') {
      this.speed = ENDLESS.speed; this.base = ENDLESS.base; this.regen = ENDLESS.regen;
      this.order = Object.keys(proteins);
      this.pIndex = 0; this.nextSwap = 40;
      this.curDef = LEVELS.find(l => l.id === this.order[0]);
      this.items = []; this.zones = []; this.gen = endlessGen(seed);
      this.gen.extend(80, this.items, this.zones, this.curDef.zones, 0, this.speed);
      this.length = Infinity; this.bossStart = Infinity;
      this.world.setProtein(proteins[this.order[0]]);
    } else {
      this.speed = level.speed; this.base = level.base; this.regen = level.regen;
      this.curDef = level;
      const c = buildCourse(level, seed);
      this.items = c.items.sort((a, b) => a.x - b.x);
      this.items.push({ type: 'finish', x: c.length });
      this.zones = c.zones.sort((a, b) => a.x0 - b.x0);
      this.length = c.length; this.bossStart = c.bossStart; this.flips = c.flips;
      this.world.setProtein(proteins[level.id]);
    }
    this.spawnI = 0; this.zoneI = 0; this.live = []; this.liveZones = [];
    this.world.camX = 0;
    this.audio.setFold(0); this.audio.intensity = 0;
    this.audio.startMusic(0);
    this.running = true;
  }

  // ---------- environment ----------
  env() {
    let tilt = 0, mul = 1, zone = null, day = 0;
    for (const z of this.liveZones) if (this.x >= z.x0 && this.x <= z.x1) { tilt += z.tilt * (z.toward ? 1 : -1); mul = Math.min(mul, z.mul); zone = z; }
    const L = this.level;
    if (L.dayNight) {
      let night;
      if (this.bossOn && this.flips) {
        const k = this.flips.filter(f => f <= this.t).length;
        night = k === 0 ? this.dayNightAt(this.bossStart) : k % 2 === 1;
        const next = this.flips.find(f => f > this.t);
        const prev = [...this.flips].reverse().find(f => f <= this.t);
        const near = Math.min(next !== undefined ? next - this.t : 9, prev !== undefined ? this.t - prev : 9);
        day = night ? 0 : 1;
        if (near < 0.35) day = 0.5 + (day - 0.5) * (near / 0.35);
      } else {
        const half = (L.dayNight.period * this.speed) / 2;
        const ph = this.x / half;
        night = Math.floor(ph) % 2 === 1;
        const frac = ph - Math.floor(ph);
        day = night ? 0 : 1;
        const edge = Math.min(frac, 1 - frac) * half / this.speed;   // seconds to boundary
        if (edge < 0.8) day = 0.5 + (day - 0.5) * (edge / 0.8);
      }
      tilt += night ? 18 : -18; mul *= 0.85;
      zone = zone || { label: night ? 'night' : 'day', sub: night ? 'fsKaiB favoured' : 'ground state favoured', toward: night ? 1 : 0, ambient: true };
    }
    if (this.bossOn && L.boss?.type === 'receptors') {
      const s = Math.sin((this.t * 2 * Math.PI) / 6);
      tilt += 22 * s; mul *= 0.8;
      zone = { label: s > 0 ? 'warming' : 'cooling', sub: s > 0 ? 'Ltn40 favoured' : 'Ltn10 favoured', toward: s > 0 ? 1 : 0, ambient: true };
    }
    if (this.locked) zone = { label: 'locked', sub: 'β-barrel bound to RNAP', toward: 1, ambient: true };
    return { tilt, mul, zone, day };
  }
  dayNightAt(x) { const half = (this.level.dayNight.period * this.speed) / 2; return Math.floor(x / half) % 2 === 1; }

  cost(to, env = this.env()) {
    if (this.locked) return Infinity;
    return Math.max(3, this.base * env.mul - env.tilt * (to ? 1 : -1));
  }

  // ---------- input ----------
  jump() {
    if (!this.running) return;
    this.jumpBuf = 0.12;
  }
  jumpRelease() { if (this.running && this.vy > 0 && this.fold === 0) this.vy *= 0.55; }
  drop() { if (this.running && !this.grounded) this.vy = Math.min(this.vy, -18); }

  switchFold() {
    if (!this.running || this.ended) return;
    if (this.morphP < 0.7) return;
    const to = 1 - this.fold;
    const env = this.env();
    if (this.locked) { this.failSwitch('Locked: bound to RNA polymerase'); return; }
    let c = this.cost(to, env), onBeat = false;
    if (this.bossOn && this.flips) {
      const near = this.flips.reduce((b, f) => Math.abs(f - this.t) < Math.abs(b - this.t) ? f : b, -99);
      const k = this.flips.indexOf(near);
      const phaseFold = k % 2 === 0 ? 1 : 0;
      if (Math.abs(near - this.t) < 0.26 && to === phaseFold) { c = 0; onBeat = true; }
      else c = Math.max(c, 55);
    }
    if (this.energy < c) {
      this.failSwitch(env.zone && !env.zone.ambient ? 'Not enough energy: grab ATP' : 'Barrier too high: find a trigger zone or ATP');
      return;
    }
    this.energy -= c;
    this.doSwitch(to);
    if (onBeat) { this.addBonus(200, 'On the beat!', COLORS.b); this.audio.play('perfect'); return; }
    // just-in-time: the next obstacle needs exactly this fold and is close
    const nxt = this.live.find(it => it.x > this.x + 0.3 && needs(it) >= 0 && !it.done);
    if (nxt && needs(nxt) === to && nxt.x - this.x < 4.5) { this.perfects++; this.addBonus(150, 'Just in time!', to ? COLORS.b : COLORS.a); this.audio.play('perfect'); }
  }

  doSwitch(to, free = false) {
    this.fold = to; this.switches++;
    this.morphFrom = this.morphT; this.morphTo = to; this.morphP = 0;
    this.audio.setFold(to);
    this.audio.play('switch');
    const col = to ? COLORS.b : COLORS.a;
    this.world.emit(this.x, this.y + 0.8, 0, col, free ? 50 : 90, 6, 0.9, 3);
    this.world.shake = Math.max(this.world.shake, 0.12);
    // landing in Shell form: if you were mid-air you keep momentum
  }

  failSwitch(msg) {
    this.ballWobble = 1;
    this.audio.play('fail');
    if (this.t - this.failMsgAt > 1.6) { this.ui.toast(msg, '#ff8aa0'); this.failMsgAt = this.t; }
  }

  addBonus(pts, label, color) {
    this.bonus += pts;
    if (label) this.ui.pop(label + ' +' + pts, color ? '#' + color.getHexString() : '#fff');
  }

  damage() {
    if (this.invuln > 0 || this.ended) return;
    this.hearts--; this.invuln = 1.4; this.hurt = 1;
    this.world.shake = 0.5;
    this.audio.play('hit');
    this.world.emit(this.x, this.y + 0.7, 0, COLORS.hazard, 40, 5, 0.6, 2);
    this.ui.hearts(this.hearts);
    if (this.hearts <= 0) this.finish(false);
  }

  finish(won) {
    if (this.ended) return;
    this.ended = true; this.running = false;
    this.audio.stopMusic();
    this.audio.play(won ? 'win' : 'lose');
    this.ui.end({ won, score: this.totalScore(), checkpoint: this.bossCount });
  }

  totalScore() { return Math.floor(this.x * 2) + this.bonus; }

  // ---------- update ----------
  update(dt) {
    if (!this.running) return;
    this.t += dt;
    this.audio.sync(this.t);
    if (this.mode === 'endless') {
      this.speed = Math.min(13, ENDLESS.speed + this.t * 0.06);
      if (this.t > this.nextSwap) this.swapProtein();
      this.gen.extend(this.x + 80, this.items, this.zones, this.curDef.zones, Math.min(1.2, this.t / 120), this.speed);
    }
    const prevX = this.x;
    this.x += this.speed * dt;

    // boss
    if (!this.bossOn && this.x >= this.bossStart) this.startBoss();
    if (this.locked && this.x > this.length - 12) {
      this.locked = false;
      this.doSwitch(0, true);
      this.ui.toast('Released: the domain refolds back to α', '#38e8ff');
    }

    // physics
    this.jumpBuf -= dt; this.coyote = this.grounded ? 0.09 : this.coyote - dt;
    if (this.jumpBuf > 0 && this.coyote > 0) {
      this.vy = JUMP[this.fold]; this.grounded = false; this.coyote = 0; this.jumpBuf = 0;
      this.audio.play(this.fold ? 'hop' : 'jump');
    }
    this.vy -= G * dt;
    this.y += this.vy * dt;
    if (this.y <= 0) {
      if (!this.grounded && this.vy < -8) this.world.emit(this.x, 0.05, 0, this.fold ? COLORS.b : COLORS.a, 8, 2.5, 0.4);
      this.y = 0; this.vy = 0; this.grounded = true;
    }
    if (this.fold === 1) this.roll += (this.speed * dt) / 0.55;

    // morph animation
    if (this.morphP < 1) {
      this.morphP = Math.min(1, this.morphP + dt / MORPH_TIME);
      const e = this.morphP * this.morphP * (3 - 2 * this.morphP);
      this.morphT = this.morphFrom + (this.morphTo - this.morphFrom) * e;
    }

    // energy
    const env = this.env();
    let regen = this.regen;
    if (env.zone && !env.zone.ambient && env.zone.toward === this.fold) regen += 3;
    this.energy = Math.min(100, this.energy + regen * dt);
    this.env_ = env;
    if (env.zone && !env.zone.ambient && !this.zoneSeen.has(env.zone)) {
      this.zoneSeen.add(env.zone);
      this.ui.toast(`${env.zone.label}: ${env.zone.sub}`, env.zone.toward ? '#ffae3b' : '#38e8ff');
    }

    // beat pulse (visual metronome in the KaiB boss)
    const beat = Math.floor(this.t / BEAT);
    if (beat !== this.lastBeat) { this.lastBeat = beat; this.beatPulse = 1; if (this.bossOn && this.flips) this.audio.play('tick'); }
    this.beatPulse = Math.max(0, this.beatPulse - dt * 3);

    this.invuln = Math.max(0, this.invuln - dt);
    this.hurt = Math.max(0, this.hurt - dt * 2.5);
    this.ballWobble = Math.max(0, this.ballWobble - dt * 2.5);

    this.streamItems();
    this.collide();

    // trail
    if (Math.random() < 0.6) this.world.emit(this.x - 0.4, this.y + (this.fold ? 0.3 : 0.8), 0, this.fold ? COLORS.b : COLORS.a, 1, 0.6, 0.5, 2);

    if (this.x >= this.length) this.finish(true);
  }

  startBoss() {
    this.bossOn = true;
    const b = this.level.boss;
    this.audio.intensity = 1;
    this.ui.banner(b.title, b.desc);
    if (b.type === 'lock') {
      if (this.fold !== 1) { this.doSwitch(1, true); this.ui.toast('RNA polymerase at ops triggers the switch', '#ffae3b'); }
      this.locked = true;
    }
  }

  swapProtein() {
    this.pIndex = (this.pIndex + 1) % this.order.length;
    const id = this.order[this.pIndex];
    this.curDef = LEVELS.find(l => l.id === id);
    this.world.setProtein(this.proteins[id]);
    this.nextSwap = this.t + 40;
    this.world.emit(this.x, this.y + 0.8, 0, COLORS.atp, 80, 7, 1, 3);
    this.ui.toast(`Now playing as ${this.curDef.name}`, '#b8ffcf');
  }

  streamItems() {
    const ahead = this.x + 36;
    while (this.spawnI < this.items.length && this.items[this.spawnI].x < ahead) {
      const it = this.items[this.spawnI++];
      this.world.spawn(it); this.live.push(it);
    }
    while (this.zoneI < this.zones.length && this.zones[this.zoneI].x0 < ahead) {
      const z = this.zones[this.zoneI++];
      this.world.spawnZone(z, z.toward ? '#ffae3b' : '#38e8ff'); this.liveZones.push(z);
    }
    const behind = this.x - 18;
    this.live = this.live.filter(it => { const end = it.x + (it.w || 0) / 2; if (end < behind) { this.world.despawn(it); return false; } return true; });
    this.liveZones = this.liveZones.filter(z => { if (z.x1 < behind) { this.world.despawnZone(z); return false; } return true; });
    if (this.mode === 'endless' && this.spawnI > 200) {   // keep arrays short
      this.items.splice(0, this.spawnI); this.spawnI = 0;
      const zi = this.zoneI; this.zones.splice(0, zi); this.zoneI = 0;
    }
  }

  collide() {
    const hb = HIT[this.fold];
    const px0 = this.x - hb.w / 2, px1 = this.x + hb.w / 2, py0 = this.y, py1 = this.y + hb.h;
    const cy = this.y + hb.h / 2;
    for (const it of this.live) {
      if (it.done) continue;
      const hw = (it.w || 0.3) / 2;
      const overlapX = px1 > it.x - hw && px0 < it.x + hw;
      switch (it.type) {
        case 'wall':
          if (overlapX && py0 < it.h) { it.done = true; this.damage(); }
          break;
        case 'bar':
          if (overlapX && py1 > it.y0) { it.done = true; this.damage(); }
          break;
        case 'protease':
          if (overlapX) {
            it.done = true;
            if (this.fold === 1) {
              this.addBonus(100, 'Protease bounced', null);
              this.audio.play('smash');
              this.world.emit(it.x, cy, 0, COLORS.hazard, 30, 6, 0.6, 2);
              this.world.despawn(it);
            } else this.damage();
          }
          break;
        case 'gate':
          if (overlapX) {
            it.done = true;
            if (this.fold === it.fold) { this.addBonus(50, null); this.world.emit(it.x, cy, 0, it.fold ? COLORS.b : COLORS.a, 24, 4, 0.5, 2); }
            else this.damage();
          }
          break;
        case 'pickup': {
          const d = Math.hypot(it.x - this.x, it.y - cy);
          if (d > 0.95) break;
          if (it.kind === 'atp') {
            it.done = true; this.energy = Math.min(100, this.energy + 22); this.bonus += 25;
            this.audio.play('pickup'); this.world.emit(it.x, it.y, 0, COLORS.atp, 18, 3, 0.5); this.world.despawn(it);
          } else {
            const want = it.kind === 'xcr1' ? 0 : 1;
            if (this.fold === want) {
              it.done = true; this.bossCount++;
              const label = { ribosome: 'Ribosome docked', xcr1: 'XCR1 bound', heparin: 'Heparin bound', cdc20: 'Cdc20 captured' }[it.kind];
              this.addBonus(150, label, want ? COLORS.b : COLORS.a);
              this.audio.play('perfect'); this.world.emit(it.x, it.y, 0, want ? COLORS.b : COLORS.a, 40, 5, 0.8, 2); this.world.despawn(it);
              if (it.kind === 'cdc20' && this.bossCount === this.level.boss.target) { this.addBonus(500, 'Checkpoint satisfied', COLORS.b); }
            } else if (!it.warned) {
              it.warned = true;
              this.ui.toast(`Wrong fold to bind ${it.kind === 'xcr1' ? 'XCR1 (needs Ltn10)' : it.kind === 'heparin' ? 'heparin (needs Ltn40)' : it.kind === 'cdc20' ? 'Cdc20 (needs closed Mad2)' : 'the ribosome'}`, '#ff8aa0');
            }
          }
          break;
        }
      }
    }
  }

  // state the renderer needs
  view() {
    return {
      px: this.x, py: this.y, form: this.morphT, morphT: this.morphT,
      glow: this.morphP < 1 ? Math.sin(Math.PI * this.morphP) : 0,
      hurt: this.hurt + (this.invuln > 0 && Math.floor(this.invuln * 10) % 2 ? 0.3 : 0),
      roll: this.roll, menu: false, lookAhead: 4.2, day: this.env_ ? this.env_.day : 0,
    };
  }
}
