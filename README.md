# Metamorph

**Live site:** [Atlas](https://sreeharsh7.github.io/metamorph/atlas.html) · [Guide](https://sreeharsh7.github.io/metamorph/)

Two things about fold-switching proteins:

- **Atlas** (`atlas.html`): a public, downloadable dataset of 92 experimentally determined fold-switching structure pairs with an interactive viewer.
- **Guide** (`index.html`): a scroll-driven introduction to fold switching.

## Guide

An interactive, scroll-driven guide to fold-switching proteins. As you read, a pinned 3D viewer morphs real PDB structures between their two folds, drawn as cartoon ribbons whose helices and strands are re-assigned on every frame.

| Section | Protein | Fold A | Fold B | What you control |
|---|---|---|---|---|
| The exception | RfaH C-terminal domain | 2OUG α-hairpin | 2LCL β-barrel | scroll scrubs the morph |
| Two wells | RfaH | | | trigger slider tilts a two-well landscape (with hysteresis) |
| RfaH | RfaH | 2OUG | 2LCL | RNA polymerase paused at *ops* |
| KaiB | KaiB | 2QKE ground state | 5JYT fold-switched | time of day |
| Lymphotactin | XCL1 | 1J9O Ltn10 | 2JP1 Ltn40 | temperature and NaCl, with live populations |
| Mad2 | Mad2 | 1DUJ open | 1S2H closed | Mad1:C-Mad2 template; TRIP13 + p31comet reset |
| How the morph is drawn | Lymphotactin | | | straight-line vs relaxed path, clashes in red |
| Morph your own | any | PDB ID + chain or file | PDB ID + chain or file | scrub slider |

The landscapes and populations are illustrative: they follow the published trends but are not fitted to data.

## Atlas (`atlas.html`)

A searchable, sortable table of **92 experimentally known fold-switching pairs**, each animated from one PDB structure to the other.

- **Download:** `data/fold_switch_atlas.csv` and `data/fold_switch_atlas.json`, one row per pair: PDB IDs and chains, method, resolution and year, aligned length, sequence identity, switch type, fold-switching region (numbering, sequence, per-residue secondary structure in each fold) and global Cα RMSD. The page documents every column and lists how to cite the sources.
- **Export:** any morph can be saved as a multi-model Cα PDB file (about 60 models) for PyMOL, ChimeraX or VMD.

- **Source list:** the pairs and their fold-switching regions come from Chakravarty & Porter (2022), *AlphaFold2 fails to predict protein fold switching*, Protein Science 31:e4353 ([github.com/ncbi/AF2_benchmark](https://github.com/ncbi/AF2_benchmark)), saved as `tools/fold_switch_pairs.csv`. One of their 93 pairs (SarA, 1FZP) has since been removed from the PDB.
- **Build:** `python3 tools/build_atlas.py` fetches Cα coordinates and annotations from RCSB, pairs the two chains by global sequence alignment, maps the published region onto the alignment and writes `data/atlas.js` (~1 MB) plus the CSV and JSON downloads. Downloads are cached in `tools/raw/atlas/`.
- **In the page:** filter by switch type (α → β, β → α, …) or search by protein, organism or PDB ID. The viewer plays the morph back and forth and fades everything outside the fold-switching region (or by residue motion). A track shows secondary structure along the chain for fold A, the current frame and fold B. Links go to both RCSB entries. Deep links work: `atlas.html#2OUG_C-6C6S_D`.
- **Compare any two entries:** type two PDB IDs and chains; they are aligned and morphed in the browser.
- **Morphs** are built on demand in a Web Worker (`js/morph-worker.js`), usually in well under a second; large rearrangements of 400–700 residues take a few seconds. `tools/atlas_check.html` builds all 92 and reports the closest Cα–Cα approach along each path. 90 route without the chain crowding itself. Two (3JV6/1ZK9 and 3O44/1XEZ) cannot be routed cleanly by this coarse model and are labelled "approximate path" in the page.

## Run locally

It's a static site, but ES modules need a web server (opening `index.html` as a file won't work):

```bash
cd ~/Downloads/Metamorph && python3 -m http.server 8000
```

Then open http://localhost:8000.

## Deploy to GitHub Pages

Push this folder to a repository, then in **Settings → Pages** choose *Deploy from a branch*, branch `main`, folder `/ (root)`. Every path is relative, three.js is vendored in `vendor/`, and `.nojekyll` is included, so nothing needs building.

## How the structures and morphs work

- `js/states.js` lists the PDB entry, chain and residue range for each state. At load the page fetches only Cα atoms from the RCSB ModelServer (a few KB each). If that fails or takes more than 4.5 s, it uses `data/fallback.js`, which `tools/bundle.py` generates from the same entries.
- `js/morph.js` pairs residues by sequence number (1DUJ is numbered +2 relative to the native sequence, corrected with an offset) and superposes them with an iterative Gaussian-weighted fit, so the conserved core aligns and the residues that switch stand out.
- Linear interpolation of Cα coordinates passes the chain through itself in all four proteins. Metamorph uses targeted relaxation instead: each Cα steps toward its target at no more than 0.35 Å per step, while virtual bonds, i/i+2 distances and excluded volume are enforced. If that gets stuck (as Mad2 does, because its β1 strand and C-terminal safety belt change sides), the moving segments are routed on great-circle arcs around the core. Frames are resampled evenly along the path.
- `js/cartoon.js` builds ribbons from Cα only: secondary structure from Cα distance windows plus a strand-pairing check (P-SEA style), and ribbon orientation from the Cα curvature.
- Check the morphs with `tools/validate.html` (numbers) and `tools/morphs.html` (filmstrips). Current results:

| Protein | Path | Min segment separation | Max bond deviation | Max step |
|---|---|---|---|---|
| RfaH | direct | 3.15 Å | 0.14 Å | 0.20 Å |
| KaiB | direct | 2.93 Å | 0.95 Å* | 0.25 Å |
| Lymphotactin | direct | 3.00 Å | 0.20 Å | 0.25 Å |
| Mad2 | orbit | 2.90 Å | 0.21 Å | 0.35 Å |

\*Inherited from the deposited 5JYT model, not introduced by the morph.

## Files

```
index.html          the essay
atlas.html          Fold-Switch Atlas
css/base.css        shared tokens, header, buttons, inputs
css/style.css       guide styles
css/atlas.css       atlas styles
js/app.js           scroll tracking, section widgets, your-own form
js/atlas.js         atlas list, filters, playback, SS track, compare form
js/atlas-morph.js   one atlas morph (superpose, relax, SS per frame, quality)
js/morph-worker.js  runs atlas morphs off the main thread
js/ss.js            secondary structure from Cα
js/viewer.js        sticky three.js viewer (drag to rotate)
js/cartoon.js       Cα-only secondary structure and ribbon mesh
js/landscape.js     SVG two-well free-energy figure
js/morph.js         parsing, superposition, morph path, validation
js/structures.js    RCSB fetch, fallback, PDB/mmCIF parsing
data/fallback.js    bundled Cα coordinates for the essay
data/atlas.js       92 fold-switching pairs with coordinates (generated)
data/fold_switch_atlas.csv / .json   public dataset (generated)
vendor/three/       three.js r160 (MIT)
tools/              bundler, validators, 2D filmstrips, raw mmCIF
```

## Credits

Structures from the RCSB Protein Data Bank (Berman et al., 2000) and the authors of each entry. Rendering by three.js. Inspired by Protein Fighter (Ovchinnikov lab) and Fold Spacer (Steinegger lab). Learn more: [preprint](https://www.biorxiv.org/content/10.64898/2026.08.16.745091v1) · [sreeharsh7.github.io](https://sreeharsh7.github.io)
