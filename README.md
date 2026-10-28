# Metamorph

A side-scrolling runner where you play a real fold-switching protein. Each level is one protein with two experimentally determined folds; press **Switch** and the character morphs between them. Each fold has its own abilities, and environmental triggers reshape a live two-well free-energy landscape.

| Level | Protein | Fold A (Spring) | Fold B (Shell) | Trigger | Final stretch |
|---|---|---|---|---|---|
| 1 | RfaH C-terminal domain | 2OUG α-hairpin | 2LCL β-barrel | ops DNA + RNAP | barrel locks in; dock ribosomes |
| 2 | KaiB | 2QKE ground state | 5JYT fold-switched | day/night | switch on the beat |
| 3 | Lymphotactin (XCL1) | 1J9O Ltn10 | 2JP1 Ltn40 | temperature, salt | XCR1 vs heparin targets |
| 4 | Mad2 | 1DUJ open | 1S2H closed | Mad1:C-Mad2 template, TRIP13/p31comet | capture 5 Cdc20 |

Plus an endless mode that rotates through all four proteins.

**Controls:** ↑ / W jump, ↓ / S drop, Space switch fold, P / Esc pause, M mute. On touch screens: tap the right side to jump, the left side to switch, swipe down to drop.

## Run locally

It's a static site, but ES modules need a web server (opening `index.html` as a file won't work):

```bash
cd ~/Downloads/Metamorph && python3 -m http.server 8000
```

Then open http://localhost:8000.

## Deploy to GitHub Pages

Push this folder to a repository, then in **Settings → Pages** choose *Deploy from a branch*, branch `main`, folder `/ (root)`. Every path is relative, three.js is vendored in `vendor/`, and `.nojekyll` is included, so nothing needs building.

## How the structures and morphs work

- `js/states.js` lists the PDB entry, chain and residue range for each state. At load the game fetches only Cα atoms from the RCSB ModelServer (a few KB each). If that fails or takes more than 4.5 s, it uses `data/fallback.js`, which `tools/bundle.py` generates from the same entries.
- `js/morph.js` pairs residues by sequence number (1DUJ is numbered +2 relative to the native sequence, corrected with an offset) and superposes them with an iterative Gaussian-weighted fit, so the conserved core aligns and the residues that switch stand out.
- Linear interpolation of Cα coordinates passes the chain through itself in all four proteins (minimum segment–segment distance 0.00 Å). The game uses targeted relaxation instead: each Cα steps toward its target at no more than 0.35 Å per step, while virtual bonds, i/i+2 distances and excluded volume are enforced. If that gets stuck (as Mad2 does, because its β1 strand and C-terminal safety belt change sides), the moving segments are routed on great-circle arcs around the core. Frames are resampled evenly along the path.
- Check the morphs with `tools/validate.html` (numbers) and `tools/morphs.html` (filmstrips). Current results:

| Protein | Path | Min segment separation | Max bond deviation | Max step |
|---|---|---|---|---|
| RfaH | direct | 3.15 Å | 0.14 Å | 0.20 Å |
| KaiB | direct | 2.93 Å | 0.95 Å* | 0.25 Å |
| Lymphotactin | direct | 3.00 Å | 0.20 Å | 0.25 Å |
| Mad2 | orbit | 2.90 Å | 0.21 Å | 0.35 Å |

\*Inherited from the deposited 5JYT model, not introduced by the morph.

## Playtest bot

Open `index.html?debug` (this unlocks every level and disables auto-pause), then in the console:

```js
const { runAll } = await import('./tools/bot.js'); console.log(runAll());
```

It plays every level headless at 60 Hz and reports whether each course can be finished on the energy budget.

## Files

```
index.html          screens and HUD
css/style.css       styles
js/main.js          app shell, input, HUD, energy meter, storage
js/game.js          physics, energy landscape, boss rules
js/levels.js        level text and course generator
js/scene.js         three.js renderer: Cα tube, obstacles, particles, bloom
js/morph.js         parsing, superposition, morph path, validation
js/structures.js    RCSB fetch + fallback
js/audio.js         Web Audio SFX and generative music (key follows fold)
js/share.js         2D traces, end-screen loop, PNG share card
data/fallback.js    bundled Cα coordinates
vendor/three/       three.js r160 (MIT)
tools/              bundler, validators, playtest bot, raw mmCIF
```

## Credits

Structures from the RCSB Protein Data Bank (Berman et al., 2000) and the authors of each entry. Rendering by three.js. Learn more: [preprint](https://www.biorxiv.org/content/10.64898/2026.08.16.745091v1) · [sreeharsh7.github.io](https://sreeharsh7.github.io)
