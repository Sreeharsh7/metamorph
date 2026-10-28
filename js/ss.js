// Secondary structure from Cα-only coordinates (P-SEA-style distance windows
// plus a strand-pairing check). No three.js, so it also runs in the morph worker.
const d = (P, i, j) => Math.hypot(P[i * 3] - P[j * 3], P[i * 3 + 1] - P[j * 3 + 1], P[i * 3 + 2] - P[j * 3 + 2]);

// Returns Uint8Array: 0 coil, 1 helix, 2 strand.
export function assignSS(P, breaks) {
  const n = P.length / 3;
  const ss = new Uint8Array(n);
  const ok = (i, k) => { for (let j = i; j < i + k; j++) if (j >= n - 1 || breaks[j]) return false; return true; };
  const helixWin = new Uint8Array(n), strandWin = new Uint8Array(n);
  for (let i = 0; i < n - 4; i++) {
    if (!ok(i, 4)) continue;
    const d2 = d(P, i, i + 2), d3 = d(P, i, i + 3), d4 = d(P, i, i + 4);
    if (Math.abs(d2 - 5.45) < 0.65 && Math.abs(d3 - 5.25) < 0.75 && Math.abs(d4 - 6.3) < 0.9) helixWin[i] = 1;
    if (Math.abs(d2 - 6.6) < 0.75 && d3 > 8.7 && d4 > 10.8) strandWin[i] = 1;
  }
  // helix: two consecutive windows -> residues i..i+4
  for (let i = 0; i < n - 5; i++) if (helixWin[i] && helixWin[i + 1]) for (let j = i; j <= i + 5; j++) ss[j] = 1;
  // strand: extended stretch of >=3 that has a partner strand nearby (a real sheet)
  for (let i = 0; i < n - 3; i++) {
    if (!strandWin[i] || ss[i] === 1) continue;
    let paired = false;
    for (let j = 0; j < n && !paired; j++) if (Math.abs(i + 1 - j) > 3 && d(P, i + 1, j) < 5.3) paired = true;
    if (paired) for (let j = i; j <= i + 2; j++) if (!ss[j]) ss[j] = 2;
  }
  // clean up: drop helices < 4 and strands < 3
  let i = 0;
  while (i < n) {
    let j = i; while (j < n && ss[j] === ss[i]) j++;
    if ((ss[i] === 1 && j - i < 4) || (ss[i] === 2 && j - i < 3)) for (let k = i; k < j; k++) ss[k] = 0;
    i = j;
  }
  return ss;
}

