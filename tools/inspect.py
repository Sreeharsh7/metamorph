import sys
def parse(fn):
    cols=[];rows=[]
    for l in open(fn):
        if l.startswith('_atom_site.'): cols.append(l.strip().split('.')[1])
        elif l.startswith('ATOM') or l.startswith('HETATM'): rows.append(dict(zip(cols,l.split())))
    return rows
pairs=[('2oug','2lcl'),('2qke','5jyt'),('1j9o','2jp1'),('1duj','1s2h')]
for a,b in pairs:
    R={}
    for k in (a,b):
        rows=[r for r in parse(k+'.cif') if r['group_PDB']=='ATOM']
        ch={}
        for r in rows: ch.setdefault(r['auth_asym_id'],[]).append((int(r['auth_seq_id']),r['auth_comp_id']))
        for c,v in ch.items():
            nums=[x[0] for x in v]; gaps=[(nums[i],nums[i+1]) for i in range(len(nums)-1) if nums[i+1]-nums[i]!=1]
            print(k,c,len(v),nums[0],nums[-1],'gaps',gaps[:6])
        R[k]=dict(ch[sorted(ch)[0]])
    common=sorted(set(R[a])&set(R[b])); mism=[(n,R[a][n],R[b][n]) for n in common if R[a][n]!=R[b][n]]
    print(' common',len(common),common[0],common[-1],'mismatch',mism[:10]); print()
