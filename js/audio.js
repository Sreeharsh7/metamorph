// Web Audio sound: generated SFX and a small generative soundtrack whose key
// follows the current fold. Nothing is created until the first user gesture.
const BPM = 112;
const STEP = 60 / BPM / 4;            // 16th note
const PROG = [[0, 'm'], [8, 'M'], [3, 'M'], [10, 'M']];   // i – VI – III – VII
const ROOTS = [57, 62];               // fold A in A minor, fold B in D minor (MIDI)
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

export class Audio {
  constructor() {
    this.ctx = null; this.muted = false; this.playing = false;
    this.fold = 0; this.intensity = 0; this.t0 = 0; this.step = 0; this.nextTime = 0;
  }

  // call from a user gesture
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.7;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(c.destination);
    this.music = c.createGain(); this.music.gain.value = 0.42; this.music.connect(this.master);
    this.sfx = c.createGain(); this.sfx.gain.value = 0.8; this.sfx.connect(this.master);
    // echo for the arpeggio
    this.delay = c.createDelay(1); this.delay.delayTime.value = STEP * 3;
    const fb = c.createGain(); fb.gain.value = 0.33;
    const dl = c.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2400;
    this.delay.connect(dl).connect(fb).connect(this.delay); dl.connect(this.music);
    const len = c.sampleRate;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.03);
  }
  pause() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  startMusic(songTime = 0) {
    this.playing = true;
    if (!this.ctx) return;
    this.sync(songTime, true);
  }
  stopMusic() { this.playing = false; }
  setFold(f) { this.fold = f; }

  // keep the music's beat locked to game time (used by the KaiB beat boss)
  sync(songTime, force = false) {
    if (!this.ctx || !this.playing) return;
    const now = this.ctx.currentTime;
    const cur = now - this.t0;
    if (!force && Math.abs(cur - songTime) < 0.04) return;
    this.t0 = now - songTime;
    this.step = Math.ceil((now + 0.03 - this.t0) / STEP);
    this.nextTime = this.t0 + this.step * STEP;
  }

  schedule() {
    if (!this.ctx || !this.playing || this.ctx.state !== 'running') return;
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime);
      this.step++; this.nextTime = this.t0 + this.step * STEP;
    }
  }

  playStep(s, t) {
    const bar = Math.floor(s / 16) % 4, i = s % 16;
    const [deg, q] = PROG[bar];
    const root = ROOTS[this.fold] + deg;
    const chord = q === 'm' ? [0, 3, 7, 12] : [0, 4, 7, 12];
    if (i % 4 === 0) this.kick(t);
    if (i % 4 === 2) this.hat(t, 0.5);
    if (this.intensity > 0 && i % 2 === 1) this.hat(t, 0.18);
    if (i === 4 || i === 12) this.snare(t);
    if (i % 2 === 0) this.tone(mtof(root - 24 + (i === 6 || i === 14 ? 12 : 0)), t, STEP * 1.8, 'sawtooth', 0.16, 500, this.music);
    const arp = [0, 1, 2, 3, 2, 1, 2, 3];
    this.tone(mtof(root + 12 + chord[arp[i % 8]]), t, STEP * 0.9, this.fold ? 'triangle' : 'square', this.fold ? 0.07 : 0.035, 3000, this.music, true);
    if (i === 0) chord.slice(0, 3).forEach(c => this.tone(mtof(root + c), t, STEP * 15, 'triangle', 0.035, 1200, this.music));
  }

  tone(freq, t, dur, type, vol, cutoff, dest, echo = false) {
    const c = this.ctx;
    const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
    o.type = type; o.frequency.value = freq;
    f.type = 'lowpass'; f.frequency.value = cutoff;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(f).connect(g).connect(dest);
    if (echo) g.connect(this.delay);
    o.start(t); o.stop(t + dur + 0.05);
  }
  kick(t) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.55, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(g).connect(this.music); o.start(t); o.stop(t + 0.3);
  }
  noiseHit(t, dur, vol, type, freq, dest) {
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; f.type = type; f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(dest); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  hat(t, v) { this.noiseHit(t, 0.04, 0.12 * v, 'highpass', 7500, this.music); }
  snare(t) { this.noiseHit(t, 0.14, 0.12, 'bandpass', 1800, this.music); }

  // ---------- SFX ----------
  play(name) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime, S = this.sfx;
    const sweep = (f0, f1, dur, type, vol) => {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(S); o.start(t); o.stop(t + dur + 0.02);
    };
    const root = ROOTS[this.fold];
    switch (name) {
      case 'jump': sweep(260, 620, 0.16, 'sine', 0.25); break;
      case 'hop': sweep(200, 360, 0.12, 'triangle', 0.22); break;
      case 'switch': {
        this.noiseHit(t, 0.45, 0.22, 'bandpass', 900, S);
        [0, 4, 7, 12, 16].forEach((n, k) => this.tone(mtof(root + 12 + n), t + k * 0.045, 0.35, 'triangle', 0.12, 4000, S, true));
        break;
      }
      case 'fail': sweep(140, 60, 0.3, 'square', 0.18); break;
      case 'hit': this.noiseHit(t, 0.35, 0.45, 'lowpass', 900, S); sweep(300, 70, 0.35, 'sawtooth', 0.18); break;
      case 'pickup': [0, 7].forEach((n, k) => this.tone(mtof(root + 24 + n), t + k * 0.06, 0.25, 'sine', 0.18, 6000, S)); break;
      case 'smash': this.noiseHit(t, 0.2, 0.35, 'highpass', 2500, S); sweep(900, 200, 0.18, 'square', 0.08); break;
      case 'perfect': [0, 4, 7, 12, 16, 19].forEach((n, k) => this.tone(mtof(root + 12 + n), t + k * 0.05, 0.3, 'square', 0.06, 5000, S, true)); break;
      case 'win': [0, 4, 7, 12, 7, 12, 16, 19, 24].forEach((n, k) => this.tone(mtof(root + 12 + n), t + k * 0.09, 0.5, 'triangle', 0.14, 5000, S, true)); break;
      case 'lose': [12, 7, 3, 0].forEach((n, k) => this.tone(mtof(root + n), t + k * 0.16, 0.5, 'sawtooth', 0.1, 1200, S)); break;
      case 'tick': this.tone(1760, t, 0.05, 'sine', 0.08, 8000, S); break;
    }
  }
}
