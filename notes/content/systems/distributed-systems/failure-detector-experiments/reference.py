"""Independent reference implementation of the three heartbeat failure
detectors and Chen-Toueg-Aguilera QoS metrics, used to check the figure's
TypeScript model (plugins/mdx/src/components/phi-detector/model.ts).

Written directly from the definitions with the standard library only:
phi(t) = -log10 P(next interval > t), normal tail via math.erfc (and an
asymptotic series when erfc underflows), windows recomputed from scratch.
"""
import math


def log10_q(x):
    """log10 of P(Z > x) for standard normal Z."""
    if x < 30:
        q = 0.5 * math.erfc(x / math.sqrt(2))
        if q > 0:
            return math.log10(q)
    # Mills-ratio asymptotic series for large x
    s = 1 - 1 / x**2 + 3 / x**4 - 15 / x**6 + 105 / x**8
    lnq = -x * x / 2 - math.log(x * math.sqrt(2 * math.pi)) + math.log(s)
    return lnq / math.log(10)


def phi_normal(t, mean, sd):
    return -log10_q((t - mean) / sd)


def phi_exp(t, mean):
    return t / mean * math.log10(math.e)


def stats_at(arrivals, k, window):
    lo = max(1, k - window + 1)
    d = [arrivals[i] - arrivals[i - 1] for i in range(lo, k + 1)]
    m = sum(d) / len(d)
    var = sum((x - m) ** 2 for x in d) / len(d)
    return m, math.sqrt(var)


def tau(kind, thr, arrivals, k, window, min_std=0.0):
    """Timeout after heartbeat k: smallest t with phi(t) >= thr (bisection on phi)."""
    if kind == "timeout":
        return thr
    m, s = stats_at(arrivals, k, window)
    s = max(s, min_std)
    f = (lambda t: phi_exp(t, m)) if kind == "phiExp" else (lambda t: phi_normal(t, m, s))
    lo, hi = 0.0, m * 1000 + 1e6
    for _ in range(200):
        mid = (lo + hi) / 2
        if f(mid) < thr:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def quality(kind, thr, arrivals, window, start, min_std=0.0):
    n = len(arrivals)
    mistakes = 0
    wrong = 0.0
    taus = []
    for k in range(start, n - 1):
        t = tau(kind, thr, arrivals, k, window, min_std)
        taus.append(t)
        d = arrivals[k + 1] - arrivals[k]
        if d > t:
            mistakes += 1
            wrong += d - t
    span = arrivals[-1] - arrivals[start]
    return {
        "detection": sum(taus) / len(taus),
        "mistakes": mistakes,
        "accuracy": 1 - wrong / span,
        "taus": taus,
    }
