// Level definitions and the course generator.
// Fold 0 = "Spring" form (high jump, tall), fold 1 = "Shell" form (rolls under bars, armoured).

export const LEVELS = [
  {
    id: 'rfah',
    name: 'RfaH',
    full: 'RfaH C-terminal domain',
    organism: 'Escherichia coli',
    folds: [
      { name: 'α-helical hairpin', short: 'α', pdb: '2OUG' },
      { name: 'β-barrel', short: 'β', pdb: '2LCL' },
    ],
    intro: [
      'RfaH is a bacterial transcription factor whose C-terminal domain hides as an α-helical hairpin, packed against its own N-terminal domain.',
      'When RfaH meets RNA polymerase paused at an ops DNA site, that domain is released and refolds into a β-barrel that recruits the ribosome.',
    ],
    trigger: 'Trigger: ops DNA site + RNA polymerase',
    speed: 7.2, duration: 60, base: 40, regen: 5,
    zones: {
      toB: { label: 'ops site', sub: 'β-barrel favoured', mul: 0.35, tilt: 24 },
      toA: { label: 'NTD contact', sub: 'α-hairpin favoured', mul: 0.5, tilt: 18 },
    },
    zoneChance: 0.75,
    boss: { type: 'lock', title: 'Point of no return', desc: 'Past the final ops site the β-barrel locks in: you cannot switch back. Roll the gauntlet and dock ribosomes.', duration: 18 },
  },
  {
    id: 'kaib',
    name: 'KaiB',
    full: 'KaiB circadian clock protein',
    organism: 'Thermosynechococcus elongatus',
    folds: [
      { name: 'ground state', short: 'gs', pdb: '2QKE' },
      { name: 'fold-switched (thioredoxin-like)', short: 'fs', pdb: '5JYT' },
    ],
    intro: [
      'KaiB, KaiA and KaiC form the cyanobacterial circadian clock, a 24-hour oscillator you can rebuild in a test tube.',
      'KaiB flips slowly from its ground-state fold into a thioredoxin-like fold that binds phosphorylated KaiC at night, so the timing of its switch helps set the rhythm.',
    ],
    trigger: 'Trigger: the day/night cycle (via KaiC phosphorylation)',
    speed: 7.5, duration: 56, base: 38, regen: 5,
    zones: null, dayNight: { period: 17 },
    boss: { type: 'beat', title: 'Clockwork', desc: 'Day and night now flip every two bars. Switch on the beat as the sky turns and it costs nothing; switch off the beat and it costs a lot.', duration: 22 },
  },
  {
    id: 'ltn',
    name: 'Lymphotactin',
    full: 'Lymphotactin (XCL1)',
    organism: 'Homo sapiens',
    folds: [
      { name: 'Ltn10 chemokine fold', short: 'Ltn10', pdb: '1J9O' },
      { name: 'Ltn40 all-β dimer fold', short: 'Ltn40', pdb: '2JP1' },
    ],
    intro: [
      'Lymphotactin is a chemokine that interconverts between two unrelated folds, populated about equally under physiological conditions.',
      'The chemokine fold (Ltn10, favoured by cold and salt) activates the XCR1 receptor, while the all-β fold (Ltn40, favoured by warmth and low salt) binds heparin.',
    ],
    trigger: 'Triggers: temperature and salt',
    speed: 7.8, duration: 56, base: 30, regen: 5.5,
    zones: {
      toB: { label: 'warm, low salt', sub: 'Ltn40 favoured', mul: 0.5, tilt: 20, kind: 'heat' },
      toA: { label: 'cold, salty', sub: 'Ltn10 favoured', mul: 0.5, tilt: 20, kind: 'cold' },
    },
    zoneChance: 0.55,
    boss: { type: 'receptors', title: 'Two partners', desc: 'The temperature swings back and forth. Grab XCR1 receptors as Ltn10 and heparin chains as Ltn40.', duration: 22 },
  },
  {
    id: 'mad2',
    name: 'Mad2',
    full: 'Mad2 spindle checkpoint protein',
    organism: 'Homo sapiens',
    folds: [
      { name: 'open (O-Mad2)', short: 'O', pdb: '1DUJ' },
      { name: 'closed (C-Mad2)', short: 'C', pdb: '1S2H' },
    ],
    intro: [
      'Mad2 guards chromosome segregation: in the spindle checkpoint it switches from an open fold to a closed fold whose "safety belt" locks around Cdc20.',
      'On its own the switch takes hours, so unattached kinetochores display Mad1-bound closed Mad2 as a template that catalyses it, and TRIP13 with p31comet uses ATP to pry it back open.',
    ],
    trigger: 'Triggers: Mad1:C-Mad2 template (closing), TRIP13 + p31comet (opening)',
    speed: 8.0, duration: 56, base: 82, regen: 6,
    zones: {
      toB: { label: 'Mad1:C-Mad2 template', sub: 'closing catalysed', mul: 0.12, tilt: 14 },
      toA: { label: 'TRIP13 · p31comet', sub: 'opening catalysed', mul: 0.18, tilt: 12 },
    },
    zoneChance: 0.85, atpEvery: 9,
    boss: { type: 'checkpoint', title: 'Spindle checkpoint', desc: 'Capture 5 Cdc20 with the safety belt, so only in the closed fold, before anaphase. Use the templates.', duration: 22, target: 5 },
  },
];

export const ENDLESS = {
  id: 'endless', name: 'Endless', speed: 7, base: 36, regen: 5.5, zoneChance: 0.6,
};

// mulberry32
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- obstacle chunks ----------
// Item shapes (world units, ground at y=0):
//   wall      x, w, h        - Spring jumps it, Shell can't
//   bar       x, w, y0       - low ceiling: Shell rolls under, Spring can't
//   protease  x, w           - full-height hazard: only the armoured Shell survives (and smashes it)
//   gate      x, fold        - membrane that only lets one fold through
//   pickup    x, y, kind     - atp | ribosome | salt | xcr1 | heparin | cdc20
export const WALL_H = 1.8, BAR_Y = 1.25;

export function chunk(fold, x, r, diff = 0, speed = 7.5) {
  // a Spring jump is airborne ~0.9 s, so wall spacing must scale with speed
  const wallGap = () => speed * 0.95 + 2.2 + r() * 2;
  const items = [];
  const pick = arr => arr[Math.floor(r() * arr.length)];
  if (fold === 0) {
    const type = pick(['walls', 'walls', 'walls', 'gate']);
    if (type === 'gate') {
      items.push({ type: 'gate', x: x + 1, fold: 0 });
      items.push({ type: 'wall', x: x + 6.5, w: 0.5, h: WALL_H });
      x += 6.5 + wallGap() * 0.6;
    } else {
      const k = 1 + Math.floor(r() * (2 + diff));
      for (let i = 0; i < k; i++) {
        items.push({ type: 'wall', x, w: 0.5, h: WALL_H - (r() < 0.3 ? 0.35 : 0) });
        if (r() < 0.5) items.push({ type: 'pickup', kind: 'atp', x: x, y: WALL_H + 1.2 });
        x += wallGap();
      }
    }
  } else {
    const type = pick(['bars', 'proteases', 'proteases', 'mix', 'gate']);
    if (type === 'bars') {
      const w = 3 + r() * (3 + diff * 2);
      items.push({ type: 'bar', x: x + w / 2, w, y0: BAR_Y });
      items.push({ type: 'pickup', kind: 'atp', x: x + w / 2, y: 0.5 });
      x += w + 3;
    } else if (type === 'proteases') {
      const k = 1 + Math.floor(r() * (2 + diff));
      for (let i = 0; i < k; i++) { items.push({ type: 'protease', x, w: 0.8 }); x += 2.6 + r() * 1.6; }
      x += 1.5;
    } else if (type === 'mix') {
      items.push({ type: 'protease', x, w: 0.8 });
      const w = 3.5 + r() * 2;
      items.push({ type: 'bar', x: x + 3 + w / 2, w, y0: BAR_Y });
      x += 3 + w + 3;
    } else {
      items.push({ type: 'gate', x: x + 1, fold: 1 });
      items.push({ type: 'protease', x: x + 4.5, w: 0.8 });
      x += 7.5;
    }
  }
  return { items, x };
}

// ---------- course generation ----------
// Returns { items, zones, length, bossStart, flips? } in world units.
export function buildCourse(level, seed = 1) {
  const r = rng(seed);
  const items = [], zones = [];
  const v = level.speed;
  let x = 24;
  let fold = 0;
  const mainEnd = v * level.duration;
  const atpEvery = level.atpEvery || 13;
  let nextAtp = 18;
  const addAtp = upTo => {
    while (nextAtp < upTo) {
      items.push({ type: 'pickup', kind: 'atp', x: nextAtp, y: r() < 0.6 ? 0.6 : 2.9 });
      nextAtp += atpEvery * (0.7 + r() * 0.6);
    }
  };

  if (level.dayNight) {
    // Obstacles follow the sky: day half-periods need the ground state (Spring), night ones fsKaiB (Shell).
    const half = (level.dayNight.period * v) / 2;
    for (let k = 0; ; k++) {
      const x0 = k * half, x1 = x0 + half;
      if (x0 >= mainEnd) break;
      const f = k % 2;
      x = Math.max(x, x0 + 6);
      while (x < x1 - 7) {
        const c = chunk(f, x, r, Math.min(1, k / 6), v);
        if (c.x > x1 - 1) break;
        items.push(...c.items);
        x = c.x + 1.5;
      }
      x = x1;
    }
    addAtp(mainEnd);
  } else {
    while (x < mainEnd) {
      const prog = x / mainEnd;
      const next = r() < 0.7 ? 1 - fold : fold;
      if (next !== fold) {
        // room to switch; often a zone that favours the fold you need next
        const gap = 7.5;
        if (level.zones && r() < level.zoneChance) {
          const z = next === 1 ? level.zones.toB : level.zones.toA;
          zones.push({ x0: x - 2, x1: x + gap + 3, toward: next, ...z });
        }
        x += gap;
        fold = next;
      }
      const c = chunk(fold, x, r, prog > 0.5 ? 1 : 0, v);
      items.push(...c.items);
      x = c.x + 2;
    }
    addAtp(x);
  }

  const bossStart = Math.max(x, mainEnd) + 10;
  const boss = buildBoss(level, bossStart, r, items, zones);
  return { items, zones, bossStart, length: boss.end, flips: boss.flips || null, startFold: 0 };
}

function buildBoss(level, x0, r, items, zones) {
  const v = level.speed, L = level.boss.duration * v;
  const end = x0 + L + 12;
  const b = level.boss;
  if (b.type === 'lock') {
    zones.push({ x0: x0 - 10, x1: x0 + 2, toward: 1, ...level.zones.toB, label: 'final ops site', sub: 'switch now: the barrel will lock' });
    let x = x0 + 8;
    while (x < x0 + L - 6) {
      const c = chunk(1, x, r, 1, v);
      items.push(...c.items);
      items.push({ type: 'pickup', kind: 'ribosome', x: x - 2.5, y: 0.7 });
      x = c.x + 2.5;
    }
  } else if (b.type === 'beat') {
    // flips every 2 bars at 112 BPM; the world is placed so flips land on bar lines
    const bar = (60 / 112) * 4, flipT = 2 * bar;
    const t0 = Math.ceil(x0 / v / bar) * bar;
    const flips = [];
    for (let t = t0; t * v < x0 + L; t += flipT) flips.push(t);
    flips.forEach((t, k) => {
      const fx = t * v, f = k % 2 === 0 ? 1 : 0;   // first flip -> night
      items.push({ type: 'gate', x: fx + 5, fold: f });
      const c = chunk(f, fx + 9, r, 1, v);
      items.push(...c.items.filter(it => it.x < fx + flipT * v - 3));
    });
    return { end: flips[flips.length - 1] * v + flipT * v + 8, flips };
  } else if (b.type === 'receptors') {
    let x = x0 + 6, f = 0;
    while (x < x0 + L - 4) {
      items.push({ type: 'pickup', kind: f === 0 ? 'xcr1' : 'heparin', x, y: f === 0 ? 2.6 : 0.6, fold: f });
      if (r() < 0.6) items.push(f === 0 ? { type: 'wall', x: x + 4.5, w: 0.5, h: WALL_H } : { type: 'protease', x: x + 4, w: 0.8 });
      x += v * 0.95 + 4 + r() * 3; if (r() < 0.7) f = 1 - f;
    }
  } else if (b.type === 'checkpoint') {
    let x = x0 + 4;
    for (let k = 0; x < x0 + L - 6; k++) {
      zones.push({ x0: x - 3, x1: x + 6, toward: 1, ...level.zones.toB });
      items.push({ type: 'pickup', kind: 'cdc20', x: x + 8, y: 0.7, fold: 1 });
      items.push({ type: 'protease', x: x + 11, w: 0.8 });
      zones.push({ x0: x + 13, x1: x + 20, toward: 0, ...level.zones.toA });
      items.push({ type: 'pickup', kind: 'atp', x: x + 16, y: 0.6 });
      items.push({ type: 'wall', x: x + 22, w: 0.5, h: WALL_H });
      x += 27;
    }
  }
  return { end };
}

// Endless: chunks forever, appended on demand.
export function endlessGen(seed) {
  const r = rng(seed);
  let x = 24, fold = 0, nextAtp = 18;
  return {
    get x() { return x; },
    extend(upTo, out, zonesOut, zoneSet, diff, speed) {
      while (x < upTo) {
        const next = r() < 0.65 ? 1 - fold : fold;
        if (next !== fold) {
          if (zoneSet && r() < ENDLESS.zoneChance) zonesOut.push({ x0: x - 2, x1: x + 10, toward: next, ...(next ? zoneSet.toB : zoneSet.toA) });
          x += Math.max(5.5, 7.5 - diff * 1.5); fold = next;
        }
        const c = chunk(fold, x, r, Math.min(1, diff), speed + 1.5);
        out.push(...c.items);
        x = c.x + 2;
        while (nextAtp < x) { out.push({ type: 'pickup', kind: 'atp', x: nextAtp, y: r() < 0.6 ? 0.6 : 2.9 }); nextAtp += 11 + r() * 6; }
      }
    },
  };
}
