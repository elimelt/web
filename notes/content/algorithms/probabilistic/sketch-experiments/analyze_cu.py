# Summarizes cu_out.bin: Count-Min with and without conservative update,
# depth 4, fed the 161M hourly records in stream order.
import numpy as np, json
h = open('cu_meta.txt').read().split(); d = dict(zip(h[0::2], map(int, h[1::2])))
T, NW, NB, NF, n, N = d['T'], d['NW'], d['NB'], d['NF'], d['n'], d['N']
per = NB + 3 + NF
r = np.fromfile('cu_out.bin').reshape(T, 2, NW, per)
widths = [2 ** (10 + 2 * w) for w in range(NW)]
def q(hist, f):
    c = np.cumsum(hist) / hist.sum(); b = np.searchsorted(c, f)
    return 0.0 if b == 0 else 10 ** ((b - 1) / 50.0)
out = {'widths': widths, 'N': N, 'n': n, 'T': T, 'rows': []}
for wi, w in enumerate(widths):
    row = {'w': w}
    for s, nm in enumerate(['cm', 'cu']):
        x = r[:, s, wi]
        row[nm] = dict(mean_err=float((x[:, NB] / n).mean()), mean_err_sd=float((x[:, NB] / n).std(ddof=1)) if T > 1 else 0.0,
                       exceed=float((x[:, NB + 1] / n).mean()), exact=float((x[:, NB + 2] / n).mean()),
                       q50=float(np.mean([q(x[t, :NB], 0.5) for t in range(T)])), q99=float(np.mean([q(x[t, :NB], 0.99) for t in range(T)])))
    out['rows'].append(row)
    print(f"w={w:>8} eps*N={np.e / w * N:>10.0f} | CM mean {row['cm']['mean_err']:10.2f} q50 {row['cm']['q50']:9.1f} exact {row['cm']['exact']:.3f}"
          f" | CU mean {row['cu']['mean_err']:10.2f} q50 {row['cu']['q50']:9.1f} exact {row['cu']['exact']:.3f} | ratio {row['cm']['mean_err'] / max(row['cu']['mean_err'], 1e-9):.2f}")
json.dump(out, open('cu_summary.json', 'w'))
