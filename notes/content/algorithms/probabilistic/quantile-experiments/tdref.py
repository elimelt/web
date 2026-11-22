"""An independent merging t-digest (Dunning 2019, k1 scale function), to check
that the datasketches t-digest's errors on this data are the method's and not
the library's.

Usage: python3 -I tdref.py VALUES.i32 DELTA Q...
"""
import sys
import numpy as np

x = np.fromfile(sys.argv[1], dtype=np.int32).astype(np.float64)
delta = float(sys.argv[2])
qs = [float(a) for a in sys.argv[3:]]


def k1(q):
    return delta / (2 * np.pi) * np.arcsin(2 * q - 1)


def k1inv(k):
    if k >= delta / 4:
        return 1.0
    return (np.sin(k * 2 * np.pi / delta) + 1) / 2


def merge(means, weights):
    o = np.argsort(means, kind="stable")
    means, weights = means[o], weights[o]
    n = weights.sum()
    out_m, out_w = [], []
    cm, cw = means[0], weights[0]
    so_far = 0.0
    qlim = k1inv(k1(0.0) + 1) * n
    for m, w in zip(means[1:], weights[1:]):
        if so_far + cw + w <= qlim:
            cm = (cm * cw + m * w) / (cw + w); cw += w
        else:
            so_far += cw
            out_m.append(cm); out_w.append(cw)
            qlim = k1inv(k1(so_far / n) + 1) * n
            cm, cw = m, w
    out_m.append(cm); out_w.append(cw)
    return np.array(out_m), np.array(out_w)


BUF = int(10 * delta)
cm, cw = np.array([]), np.array([])
for s in range(0, len(x), BUF):
    b = x[s:s + BUF]
    cm, cw = merge(np.concatenate([cm, b]), np.concatenate([cw, np.ones(len(b))]))
n = cw.sum()
lo, hi = x.min(), x.max()
cum = np.cumsum(cw) - cw / 2  # rank at each centroid's center
for q in qs:
    r = q * n
    if r <= cum[0]:
        est = lo + (cm[0] - lo) * r / cum[0]
    elif r >= cum[-1]:
        est = cm[-1] + (hi - cm[-1]) * (r - cum[-1]) / (n - cum[-1])
    else:
        i = np.searchsorted(cum, r) - 1
        est = cm[i] + (cm[i + 1] - cm[i]) * (r - cum[i]) / (cum[i + 1] - cum[i])
    print(q, est)
print("centroids", len(cm))
