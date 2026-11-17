import numpy as np
def corrupt(ids, rng, density=0.15, mean_span=3.0):
    n = len(ids); n_noise = int(round(n * density)); n_spans = max(1, int(round(n_noise / mean_span)))
    noise = np.zeros(n, bool)
    starts = np.sort(rng.choice(np.arange(1, n - 4), n_spans, replace=False))
    for s in starts: noise[s:s + int(mean_span)] = True
    inp, tgt, sid, prev = [], [], 32099, False
    for t, z in zip(ids, noise):
        if z and not prev: inp.append(sid); tgt.append(sid); sid -= 1
        (tgt if z else inp).append(t); prev = z
    return inp + [1], tgt + [1]
