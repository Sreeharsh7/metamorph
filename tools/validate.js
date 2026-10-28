// Checks every level's morph; open tools/validate.html via a local server.
import { FALLBACK } from '../data/fallback.js';
import { pairStates, buildMorph, validateMorph } from '../js/morph.js';
import { STATES as CFG } from '../js/states.js';
const fmt = r => `bondDev ${r.maxBondDev.toFixed(2)}Å  minSegSep ${r.minSegSep.toFixed(2)}Å @t=${r.worstT.toFixed(2)}  maxStep ${r.maxStep.toFixed(2)}Å`;
let ok = true;
for (const [lvl, s] of Object.entries(CFG)) {
  const p = pairStates(FALLBACK[lvl].a, FALLBACK[lvl].b, s.a, s.b);
  const t0 = Date.now();
  const relaxed = buildMorph(p.A, p.B, p.breaks);
  const ms = Date.now() - t0;
  const linear = buildMorph(p.A, p.B, p.breaks, { linear: true });
  const endA = validateMorph({ frames: [relaxed.frames[0], relaxed.frames[0]], n: relaxed.n }, p.breaks, 1);
  const endB = validateMorph({ frames: [relaxed.frames.at(-1), relaxed.frames.at(-1)], n: relaxed.n }, p.breaks, 1);
  const rl = validateMorph(linear, p.breaks), rr = validateMorph(relaxed, p.breaks);
  const rmsd = Math.sqrt(relaxed.dispA.reduce((a, d) => a + d * d, 0) / relaxed.n);
  console.log(`\n${lvl}: ${p.nums.length} res (${p.nums[0]}-${p.nums.at(-1)}), RMSD ${rmsd.toFixed(1)}Å, max disp ${Math.max(...relaxed.dispA).toFixed(1)}Å, build ${ms}ms, ${relaxed.strategy}${relaxed.stuck ? ' STUCK' : ''}`);
  console.log(`  endpoint A minSegSep ${endA.minSegSep.toFixed(2)} bondDev ${endA.maxBondDev.toFixed(2)} | endpoint B minSegSep ${endB.minSegSep.toFixed(2)} bondDev ${endB.maxBondDev.toFixed(2)}`);
  console.log('  linear :', fmt(rl));
  console.log('  relaxed:', fmt(rr));
  const floor = Math.min(2.5, endA.minSegSep, endB.minSegSep) - 0.05;
  if (rr.minSegSep < floor || rr.maxBondDev > Math.max(0.6, endA.maxBondDev, endB.maxBondDev) + 0.05 || rr.maxStep > 1.5) { ok = false; console.log('  FAIL'); }
}
console.log(ok ? '\nALL MORPHS PASS' : '\nSOME MORPHS FAIL'); 
