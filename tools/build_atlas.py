#!/usr/bin/env python3
"""Build data/atlas.js: every pair in tools/fold_switch_pairs.csv with
Cα coordinates (RCSB ModelServer), a sequence alignment that pairs the two
chains residue by residue, the fold-switching region, and RCSB annotations.

The pair list and fold-switching regions come from Chakravarty & Porter (2022),
"AlphaFold2 fails to predict protein fold switching", Protein Science 31:e4353
(github.com/ncbi/AF2_benchmark).

Run from the project root:  python3 tools/build_atlas.py
"""
import csv, json, math, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'tools', 'raw', 'atlas')
os.makedirs(CACHE, exist_ok=True)
MAX_RES = 700

AA = dict(ALA='A', ARG='R', ASN='N', ASP='D', CYS='C', GLN='Q', GLU='E', GLY='G', HIS='H', ILE='I',
          LEU='L', LYS='K', MET='M', PHE='F', PRO='P', SER='S', THR='T', TRP='W', TYR='Y', VAL='V',
          MSE='M', SEC='U', PYL='O', HYP='P', SEP='S', TPO='T', PTR='Y', CSO='C', MLY='K')


def get(url, path=None, tries=4):
    if path and os.path.exists(path):
        return open(path, encoding='utf-8').read()
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'metamorph-atlas'}), timeout=30) as r:
                text = r.read().decode('utf-8')
            if path:
                open(path, 'w', encoding='utf-8').write(text)
            return text
        except Exception as e:
            if k == tries - 1:
                raise RuntimeError(f'{url}: {e}')
            time.sleep(1.5 * (k + 1))


def ca_atoms(pdb, chain):
    """[(auth_seq_id, one-letter, x, y, z)] for chain, first model, first altloc,
    plus the chain's polymer entity id."""
    url = (f'https://models.rcsb.org/v1/{pdb.lower()}/atoms?label_atom_id=CA'
           f'&auth_asym_id={chain}&model_nums=1&encoding=cif')
    text = get(url, os.path.join(CACHE, f'{pdb}_{chain}.cif'))
    cols, rows, seen, entity = [], [], set(), None
    for line in text.splitlines():
        if line.startswith('_atom_site.'):
            cols.append(line.split('.', 1)[1].strip())
        elif cols and (line.startswith('ATOM') or line.startswith('HETATM')):
            f = line.split()
            c = dict(zip(cols, f))
            if c.get('label_atom_id') != 'CA' or c.get('auth_asym_id') != chain:
                continue
            if c.get('label_alt_id', '.') not in ('.', '?', 'A'):
                continue
            n = int(c['auth_seq_id'])
            ins = c.get('pdbx_PDB_ins_code', '?')
            key = (n, ins)
            if key in seen:
                continue
            seen.add(key)
            aa = AA.get(c['label_comp_id'])
            if not aa:
                continue
            entity = entity or c.get('label_entity_id')
            rows.append((n, aa, float(c['Cartn_x']), float(c['Cartn_y']), float(c['Cartn_z'])))
    return rows, entity


def align(s, t, match=2, mismatch=-1, gap=-3):
    """Global alignment (Needleman–Wunsch, linear gaps). Returns index pairs."""
    n, m = len(s), len(t)
    H = [[0] * (m + 1) for _ in range(n + 1)]
    P = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        H[i][0] = i * gap * 0   # free end gaps
        P[i][0] = 1
    for j in range(1, m + 1):
        H[0][j] = 0
        P[0][j] = 2
    for i in range(1, n + 1):
        si = s[i - 1]; Hi = H[i]; Hp = H[i - 1]; Pi = P[i]
        for j in range(1, m + 1):
            d = Hp[j - 1] + (match if si == t[j - 1] else mismatch)
            u = Hp[j] + (0 if j == m else gap)
            l = Hi[j - 1] + (0 if i == n else gap)
            if d >= u and d >= l:
                Hi[j] = d; Pi[j] = 0
            elif u >= l:
                Hi[j] = u; Pi[j] = 1
            else:
                Hi[j] = l; Pi[j] = 2
    i, j, pairs = n, m, []
    while i > 0 and j > 0:
        p = P[i][j]
        if p == 0:
            pairs.append((i - 1, j - 1)); i -= 1; j -= 1
        elif p == 1:
            i -= 1
        else:
            j -= 1
    return pairs[::-1]


def entity_info(pdb, ent_id):
    entry = json.loads(get(f'https://data.rcsb.org/rest/v1/core/entry/{pdb}', os.path.join(CACHE, f'{pdb}_entry.json')))
    ent = json.loads(get(f'https://data.rcsb.org/rest/v1/core/polymer_entity/{pdb}/{ent_id}',
                         os.path.join(CACHE, f'{pdb}_e{ent_id}.json')))
    res = (entry.get('rcsb_entry_info') or {}).get('resolution_combined') or [None]
    orgs = ent.get('rcsb_entity_source_organism') or []
    return {
        'title': (entry.get('struct') or {}).get('title', ''),
        'method': (entry.get('exptl') or [{}])[0].get('method', ''),
        'resolution': res[0],
        'year': ((entry.get('rcsb_accession_info') or {}).get('initial_release_date') or '')[:4],
        'name': (ent.get('rcsb_polymer_entity') or {}).get('pdbx_description', ''),
        'organism': orgs[0].get('scientific_name', '') if orgs else '',
    }


def span(rng):
    a, b = rng.split('-') if '-' in rng[1:] else (rng, rng)
    return int(a), int(b)


def build(row):
    p1, c1, p2, c2 = row['pdb1'], row['chain1'], row['pdb2'], row['chain2']
    (A, ea), (B, eb) = ca_atoms(p1, c1), ca_atoms(p2, c2)
    if len(A) < 12 or len(B) < 12:
        raise RuntimeError(f'too few Cα ({len(A)}, {len(B)})')
    sa = ''.join(r[1] for r in A); sb = ''.join(r[1] for r in B)
    pairs = align(sa, sb)
    ident = sum(1 for i, j in pairs if sa[i] == sb[j]) / max(1, len(pairs))
    # fold-switching region: locate the published FSR sequence, else use the residue ranges
    fsr = None
    q = (row['fsr_seq'] or '').strip()
    if q:
        for seq, side in ((sa, 0), (sb, 1)):
            k = seq.find(q)
            if k >= 0:
                lo, hi = k, k + len(q) - 1
                idx = [n for n, (i, j) in enumerate(pairs) if lo <= (i if side == 0 else j) <= hi]
                if idx:
                    fsr = [idx[0], idx[-1]]
                break
    if fsr is None:
        lo, hi = span(row['fsr1'])
        idx = [n for n, (i, j) in enumerate(pairs) if lo <= A[i][0] <= hi]
        if idx:
            fsr = [idx[0], idx[-1]]
    # keep at most MAX_RES paired residues, centred on the fold-switching region
    if len(pairs) > MAX_RES:
        mid = (fsr[0] + fsr[1]) // 2 if fsr else len(pairs) // 2
        s0 = max(0, min(len(pairs) - MAX_RES, mid - MAX_RES // 2))
        pairs = pairs[s0:s0 + MAX_RES]
        if fsr:
            fsr = [max(0, fsr[0] - s0), min(MAX_RES - 1, fsr[1] - s0)]
    # chain breaks: a gap in either structure's numbering, or a Cα–Cα jump > 4.3 Å
    def gap(R, i, j):
        return R[j][0] - R[i][0] != 1 or sum((R[j][k] - R[i][k]) ** 2 for k in (2, 3, 4)) > 4.3 ** 2
    breaks = [n for n in range(len(pairs) - 1)
              if gap(A, pairs[n][0], pairs[n + 1][0]) or gap(B, pairs[n][1], pairs[n + 1][1])]
    ia, ib = entity_info(p1, ea), entity_info(p2, eb)
    r2 = lambda v: round(v, 2)
    return {
        'id': f'{p1}_{c1}-{p2}_{c2}',
        'name': ia['name'] or ib['name'],
        'organism': ia['organism'] or ib['organism'],
        'a': {'pdb': p1, 'chain': c1, **{k: ia[k] for k in ('title', 'method', 'resolution', 'year')}},
        'b': {'pdb': p2, 'chain': c2, **{k: ib[k] for k in ('title', 'method', 'resolution', 'year')}},
        'identity': round(ident, 3),
        'fsr': fsr,
        'seq': ''.join(sa[i] for i, _ in pairs),
        'seqB': ''.join(sb[j] for _, j in pairs),
        'numA': [A[i][0] for i, _ in pairs],
        'numB': [B[j][0] for _, j in pairs],
        'breaks': breaks,
        'A': [r2(A[i][k]) for i, _ in pairs for k in (2, 3, 4)],
        'B': [r2(B[j][k]) for _, j in pairs for k in (2, 3, 4)],
    }


# ---------- dataset export ----------
def assign_ss(P, breaks):
    """Cα-only secondary structure, same rules as js/ss.js: 0 coil, 1 helix, 2 strand."""
    n = len(P)
    brk = set(breaks)
    d = lambda i, j: math.dist(P[i], P[j])
    ok = lambda i, k: all(j < n - 1 and j not in brk for j in range(i, i + k))
    ss = [0] * n
    hw, sw = [0] * n, [0] * n
    for i in range(n - 4):
        if not ok(i, 4):
            continue
        d2, d3, d4 = d(i, i + 2), d(i, i + 3), d(i, i + 4)
        if abs(d2 - 5.45) < 0.65 and abs(d3 - 5.25) < 0.75 and abs(d4 - 6.3) < 0.9:
            hw[i] = 1
        if abs(d2 - 6.6) < 0.75 and d3 > 8.7 and d4 > 10.8:
            sw[i] = 1
    for i in range(n - 5):
        if hw[i] and hw[i + 1]:
            for j in range(i, i + 6):
                ss[j] = 1
    for i in range(n - 3):
        if not sw[i] or ss[i] == 1:
            continue
        if any(abs(i + 1 - j) > 3 and d(i + 1, j) < 5.3 for j in range(n)):
            for j in range(i, i + 3):
                if not ss[j]:
                    ss[j] = 2
    i = 0
    while i < n:
        j = i
        while j < n and ss[j] == ss[i]:
            j += 1
        if (ss[i] == 1 and j - i < 4) or (ss[i] == 2 and j - i < 3):
            for k in range(i, j):
                ss[k] = 0
        i = j
    return ss


def classify(ss, lo, hi):
    """Same rule as js/atlas.js."""
    L = hi - lo + 1
    h = sum(1 for i in range(lo, hi + 1) if ss[i] == 1)
    e = sum(1 for i in range(lo, hi + 1) if ss[i] == 2)
    if h / L >= 0.3 and h >= e:
        return 'alpha'
    if e / L >= 0.25:
        return 'beta'
    if h / L >= 0.2:
        return 'alpha'
    return 'coil'


def kabsch_rmsd(A, B):
    import numpy as np
    A = np.asarray(A, float); B = np.asarray(B, float)
    A = A - A.mean(0); B = B - B.mean(0)
    U, S, Vt = np.linalg.svd(B.T @ A)
    D = np.diag([1, 1, np.sign(np.linalg.det(U @ Vt))])
    R = U @ D @ Vt
    return float(np.sqrt(((B @ R - A) ** 2).sum(1).mean()))


def export_dataset(out):
    rows = []
    for e in out:
        A = [e['A'][k:k + 3] for k in range(0, len(e['A']), 3)]
        B = [e['B'][k:k + 3] for k in range(0, len(e['B']), 3)]
        lo, hi = e['fsr'] or (0, len(A) - 1)
        sa, sb = assign_ss(A, e['breaks']), assign_ss(B, e['breaks'])
        ca, cb = classify(sa, lo, hi), classify(sb, lo, hi)
        ch = lambda ss: ''.join('-HE'[x] for x in ss[lo:hi + 1])
        rows.append({
            'pair_id': e['id'], 'protein': e['name'], 'organism': e['organism'],
            'fold_a_pdb': e['a']['pdb'], 'fold_a_chain': e['a']['chain'], 'fold_a_method': e['a']['method'],
            'fold_a_resolution': e['a']['resolution'], 'fold_a_year': e['a']['year'],
            'fold_b_pdb': e['b']['pdb'], 'fold_b_chain': e['b']['chain'], 'fold_b_method': e['b']['method'],
            'fold_b_resolution': e['b']['resolution'], 'fold_b_year': e['b']['year'],
            'aligned_residues': len(A), 'sequence_identity': e['identity'],
            'switch_type': f'{ca} to {cb}' if ca != cb else f'{ca} rearranged',
            'region_start_a': e['numA'][lo], 'region_end_a': e['numA'][hi],
            'region_start_b': e['numB'][lo], 'region_end_b': e['numB'][hi],
            'region_length': hi - lo + 1, 'region_sequence': e['seq'][lo:hi + 1],
            'region_ss_a': ch(sa), 'region_ss_b': ch(sb),
            'ca_rmsd_global': round(kabsch_rmsd(A, B), 2),
        })
    rows.sort(key=lambda r: (r['protein'] or '').lower())
    with open(os.path.join(ROOT, 'data', 'fold_switch_atlas.csv'), 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader(); w.writerows(rows)
    meta = {
        'name': 'Fold-switching protein atlas',
        'description': 'Experimentally determined pairs of protein structures in which one sequence (or a close homologue) adopts two different folds.',
        'source': 'Pair list and fold-switching regions: Chakravarty D, Porter LL (2022) AlphaFold2 fails to predict protein fold switching. Protein Sci 31:e4353. Structures and annotations: RCSB Protein Data Bank.',
        'secondary_structure': 'Assigned from C-alpha geometry (P-SEA-style), not DSSP. H helix, E strand, - other.',
        'rmsd': 'C-alpha RMSD after a single global Kabsch superposition of all aligned residues.',
        'pairs': rows,
    }
    with open(os.path.join(ROOT, 'data', 'fold_switch_atlas.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    print(f'{len(rows)} rows -> data/fold_switch_atlas.csv, data/fold_switch_atlas.json')


def main():
    rows = list(csv.DictReader(open(os.path.join(ROOT, 'tools', 'fold_switch_pairs.csv'))))
    out, failed = [None] * len(rows), []
    def job(k):
        try:
            out[k] = build(rows[k])
        except Exception as e:
            failed.append((rows[k]['pdb1'], rows[k]['pdb2'], str(e)))
    with ThreadPoolExecutor(8) as ex:
        list(ex.map(job, range(len(rows))))
    out = [o for o in out if o]
    for f in failed:
        print('FAILED', *f, file=sys.stderr)
    path = os.path.join(ROOT, 'data', 'atlas.js')
    with open(path, 'w') as f:
        f.write('// Generated by tools/build_atlas.py. Pairs and fold-switching regions from\n'
                '// Chakravarty & Porter (2022) Protein Sci 31:e4353; coordinates from the RCSB PDB.\n')
        f.write('export const ATLAS = ' + json.dumps(out, separators=(',', ':')) + ';\n')
    print(f'{len(out)} pairs -> {path} ({os.path.getsize(path) // 1024} KB)')
    export_dataset(out)


if __name__ == '__main__':
    main()
