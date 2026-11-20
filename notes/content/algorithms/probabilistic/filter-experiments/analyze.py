# Summarizes the harness outputs (F, G, L, Q, R, X, J, speed2) into summary.json
# and prints the tables the note quotes.
import json, math, collections, statistics as st
def rows(fn):
    for line in open(fn):
        if line.startswith('#') or not line.strip(): continue
        yield line.split()
out = {}
# space and false-positive rate
fpr = collections.defaultdict(list); meta = {}
for fn in ('F.txt', 'G.txt'):
    for r in rows(fn):
        name, param, n, slots, bpk, fails, fp, neg = r
        key = f"{name} {param} n={n}"
        meta[key] = dict(filter=name, param=param, n=int(n), slots=int(slots), bits_per_key=float(bpk), failed=int(fails))
        if int(fails) == 0: fpr[key].append(int(fp) / int(neg))
out['fpr'] = []
for k, m in meta.items():
    v = fpr.get(k, [])
    f = int(m['param'].split('=')[1])
    entry = dict(m, trials=len(v))
    if v:
        mean = sum(v) / len(v)
        entry.update(fpr_mean=mean, fpr_min=min(v), fpr_max=max(v),
                     lower_bound_bits=math.log2(1 / mean), excess_over_bound=m['bits_per_key'] / math.log2(1 / mean))
    out['fpr'].append(entry)
print("filter param n bits/key fpr_mean (min..max) lg(1/eps) ratio")
for e in sorted(out['fpr'], key=lambda e: (e['filter'], e['n'], e['param'])):
    if 'fpr_mean' in e:
        print(f"{e['filter']:9s} {e['param']:5s} {e['n']:8d} {e['bits_per_key']:7.3f} {e['fpr_mean']:.4e} ({e['fpr_min']:.3e}..{e['fpr_max']:.3e}) {e['lower_bound_bits']:6.2f} {e['excess_over_bound']:.3f}")
    else:
        print(f"{e['filter']:9s} {e['param']:5s} {e['n']:8d} {e['bits_per_key']:7.3f} construction failed in {e['failed']} of 1 trials")
# cuckoo load at first failure
L = collections.defaultdict(list)
for r in rows('L.txt'):
    v, b, f, slots, t, load, kicks = r
    L[(v, int(b), int(f), int(slots))].append(float(load))
out['cuckoo_load'] = [dict(variant=k[0], b=k[1], f=k[2], slots=k[3], trials=len(v), mean=sum(v)/len(v), min=min(v), max=max(v)) for k, v in sorted(L.items())]
print("\ncuckoo variant b f slots mean min max")
for e in out['cuckoo_load']: print(e['variant'], e['b'], e['f'], e['slots'], f"{e['mean']:.4f} {e['min']:.4f} {e['max']:.4f}")
# quotient filter clusters
Q = collections.defaultdict(list)
for r in rows('Q.txt'): Q[float(r[1])].append([float(x) for x in r[2:]])
out['quotient'] = []
print("\nQF alpha probe_neg shift_per_insert mean_cluster p99 max sizebiased  bound(1/(1-a e^(1-a)))")
for a in sorted(Q):
    m = [sum(c) / len(c) for c in zip(*Q[a])]
    bound = 1 / (1 - a * math.exp(1 - a))
    out['quotient'].append(dict(alpha=a, trials=len(Q[a]), probe_neg=m[0], shift_per_insert=m[1], mean_cluster=m[2], p99_cluster=m[3], max_cluster=max(x[4] for x in Q[a]), sizebiased_cluster=m[5], bender_bound=bound))
    print(f"{a:.2f} {m[0]:7.2f} {m[1]:7.2f} {m[2]:6.2f} {m[3]:6.1f} {max(x[4] for x in Q[a]):6.0f} {m[5]:7.1f} {bound:7.1f}")
# ribbon success
R = collections.defaultdict(lambda: [0, 0])
for r in rows('R.txt'):
    w, n, eps, t, ok = r; R[(int(w), int(n), float(eps))][0] += int(ok); R[(int(w), int(n), float(eps))][1] += 1
out['ribbon_success'] = [dict(w=k[0], n=k[1], eps=k[2], ok=v[0], trials=v[1]) for k, v in sorted(R.items())]
print("\nribbon w n: eps ok/trials")
cur = None
for e in out['ribbon_success']:
    if (e['w'], e['n']) != cur: cur = (e['w'], e['n']); print(f"\n w={e['w']} n={e['n']}:", end='')
    print(f" {e['eps']:.3f}:{e['ok']}/{e['trials']}", end='')
print()
# xor / fuse success
X = collections.defaultdict(lambda: [0, 0])
for r in rows('X.txt'):
    kind, n, fac, t, ok = r[:5]; X[(kind, int(n), float(fac))][0] += int(ok); X[(kind, int(n), float(fac))][1] += 1
out['peel_success'] = [dict(kind=k[0], n=k[1], factor=k[2], ok=v[0], trials=v[1]) for k, v in sorted(X.items())]
print("\npeel kind n: factor ok/trials")
cur = None
for e in out['peel_success']:
    if (e['kind'], e['n']) != cur: cur = (e['kind'], e['n']); print(f"\n {e['kind']} n={e['n']}:", end='')
    print(f" {e['factor']:.3f}:{e['ok']}/{e['trials']}", end='')
print()
# figure layouts on pageview keys
J = [dict(kind=r[0], S=int(r[1]), load=float(r[2]), trials=int(r[3]), ok=int(r[4])) for r in rows('J.txt')]
out['figure_layouts'] = J
# timing
T = collections.defaultdict(list)
for r in rows('speed.txt'):
    T[r[1]].append((float(r[4]), float(r[5]), float(r[6]), int(r[2]), int(r[3])))
out['timing'] = []
print("\ntiming filter n bits/key build pos neg (median of reps; min..max)")
for k, v in T.items():
    med = [st.median(c) for c in list(zip(*v))[:3]]
    lo = [min(c) for c in list(zip(*v))[:3]]; hi = [max(c) for c in list(zip(*v))[:3]]
    n, by = v[0][3], v[0][4]
    out['timing'].append(dict(filter=k, n=n, bytes=by, reps=len(v), build_ns=med[0], pos_ns=med[1], neg_ns=med[2], build_range=[lo[0], hi[0]], pos_range=[lo[1], hi[1]], neg_range=[lo[2], hi[2]]))
    print(f"{k:28s} {n:8d} {8*by/n:6.2f} " + " ".join(f"{m:6.1f} ({a:.0f}..{b:.0f})" for m, a, b in zip(med, lo, hi)))
json.dump(out, open('summary.json', 'w'), indent=1)
