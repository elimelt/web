"""Checks the simulator against closed forms and invariants.

    python3 checks.py > checks.txt

Every check prints the simulated value and the reference value. A check
passes when they differ by at most 3.29 standard errors (a two-sided 99.9%
level, since there are about 50 checks), combining the simulated proportion's
error with the reference's own when the reference is itself a Monte Carlo
estimate; or, for an invariant, when it holds.
"""

from __future__ import annotations

from math import comb, exp

import numpy as np

import dynsim as d

N_TRIALS = 1_000_000
failed = 0


def report(name, k, n, ref, exact_ok=None, ref_n=None):
    """ref_n: trials behind a Monte Carlo reference (None for a closed form)."""
    global failed
    p = k / n
    var = p * (1 - p) / n + (ref * (1 - ref) / ref_n if ref_n else 0.0)
    tol = 3.29 * var**0.5
    ok = (abs(p - ref) <= tol) if exact_ok is None else exact_ok
    failed += not ok
    print(f"{'PASS' if ok else 'FAIL'}  {name}: simulated {p:.5f}, reference {ref:.5f}, |difference| {abs(p - ref):.5f} (allowed {tol:.5f})")


# 1. PBS k-staleness (Definition 1) for non-expanding quorums: only the W
#    replicas that acknowledge first ever hold a version.
print("PBS k-staleness, non-expanding quorums, LNKD-DISK delays")
for N, R, W in [(3, 1, 1), (3, 1, 2), (5, 1, 2), (5, 2, 2), (10, 1, 1)]:
    for k in [1, 2, 3]:
        rng = np.random.default_rng([10, N, R, W, k])
        miss = np.ones(N_TRIALS, dtype=bool)
        _, _, r, s = d.sample_wars(rng, "LNKD-DISK", N_TRIALS, N)
        read = np.argsort(r + s, axis=1)[:, :R]
        for _ in range(k):
            w, a, _, _ = d.sample_wars(rng, "LNKD-DISK", N_TRIALS, N)
            holders = np.argsort(w + a, axis=1)[:, :W]
            hit = (read[:, :, None] == holders[:, None, :]).any(axis=(1, 2))
            miss &= ~hit
        report(f"N={N} R={R} W={W} k={k}", int(miss.sum()), N_TRIALS, d.p_k_stale(N, R, W, k))

# 2. Exact t-visibility when write delays are exponential and A = R = S = 0.
print("\nExponential write delays (rate 0.1 per ms), A = R = S = 0")
d.PROFILES["EXP"] = (d.Mix(0.0, 1.0, 1.0, 0.1),) + (d.Mix(1.0, 0.0, 1.0, 1.0),) * 3
for N, R, W in [(3, 1, 1), (3, 1, 2), (5, 2, 1), (5, 1, 3)]:
    # Five independent runs of 1,000,000 trials, pooled.
    T = np.concatenate([d.stale_thresholds(np.random.default_rng([11, N, R, W, sd]), "EXP", N, R, W, N_TRIALS) for sd in range(5)])
    for t in [0.0, 5.0, 20.0]:
        report(f"N={N} R={R} W={W} t={t:g}", int((T > t).sum()), len(T), d.p_stale_exponential(N, R, W, 0.1, t))
# The N = 3, R = W = 1 case reduces to (2/3) exp(-lambda t).
assert abs(d.p_stale_exponential(3, 1, 1, 0.1, 7.0) - 2 / 3 * exp(-0.7)) < 1e-12

# 3. PBS Equation 4. It is exact when read requests arrive instantly (R = 0),
#    because the R fastest replies are then a uniformly random subset; with
#    real read delays it bounds P(stale) from above.
print("\nPBS Equation 4")
d.PROFILES["DISK-R0"] = d.PROFILES["LNKD-DISK"][:2] + (d.Mix(1.0, 0.0, 1.0, 1.0), d.LNKD_ARS)
for N, R, W in [(3, 1, 1), (3, 2, 1), (5, 1, 2)]:
    for t in [0.0, 2.0, 10.0]:
        T = d.stale_thresholds(np.random.default_rng([12, N, R, W, int(t)]), "DISK-R0", N, R, W, N_TRIALS)
        ref = d.p_stale_eq4(np.random.default_rng([13, N, R, W, int(t)]), "DISK-R0", N, R, W, t, N_TRIALS)
        report(f"exact, R delay 0, N={N} R={R} W={W} t={t:g}", int((T > t).sum()), N_TRIALS, ref, ref_n=N_TRIALS)
for prof in ["LNKD-DISK", "YMMR"]:
    for t in [0.0, 5.0, 50.0]:
        T = d.stale_thresholds(np.random.default_rng([14, int(t)]), prof, 3, 1, 1, N_TRIALS)
        ub = d.p_stale_eq4(np.random.default_rng([15, int(t)]), prof, 3, 1, 1, t, N_TRIALS)
        k = int((T > t).sum())
        p = k / N_TRIALS
        slack = 3.29 * (p * (1 - p) / N_TRIALS + ub * (1 - ub) / N_TRIALS) ** 0.5
        report(f"bound, {prof} N=3 R=W=1 t={t:g}: simulated at most the bound", k, N_TRIALS, ub, exact_ok=p <= ub + slack)

# 4. The full store with no failures is the WARS model.
print("\nFull store without failures against the WARS fast path")
for prof, (N, R, W), t in [("LNKD-DISK", (3, 1, 1), 5.0), ("YMMR", (3, 2, 1), 50.0), ("WAN", (3, 1, 1), 50.0)]:
    res = d.simulate(np.random.default_rng([16, N]), prof, N, R, W, t, N_TRIALS)
    T = d.stale_thresholds(np.random.default_rng([17, N]), prof, N, R, W, N_TRIALS)
    report(f"{prof} N={N} R={R} W={W} t={t:g}", int(res["stale"].sum()), N_TRIALS, float((T > t).mean()), ref_n=N_TRIALS)

# 5. The failure process: a node down at time 0 is down at tau with
#    probability f + (1 - f) exp(-kappa tau); stationary fraction down is f.
print("\nTwo-state failure process")
fl = d.Failures(0.1, 1000.0, 1000.0)
kappa = 1 / (fl.outage * (1 - fl.f))
rng = np.random.default_rng(18)
for tau in [100.0, 1000.0, 5000.0]:
    down0 = rng.random(N_TRIALS) < fl.f
    rec = np.where(down0, rng.exponential(fl.outage, N_TRIALS), 0.0)
    later = d._down_later(rng, down0, rec, np.full(N_TRIALS, tau), fl)
    k = int(later[down0].sum())
    report(f"P(down at {tau:g} | down at 0)", k, int(down0.sum()), fl.f + (1 - fl.f) * exp(-kappa * tau))
    report(f"P(down at {tau:g})", int(later.sum()), N_TRIALS, fl.f)

# 6. Strict quorums with R + W > N never return a stale value, whatever fails.
print("\nStrict quorum intersection")
for N, R, W in [(3, 2, 2), (3, 1, 3), (5, 3, 3)]:
    res = d.simulate(np.random.default_rng([19, N, R]), "LNKD-DISK", N, R, W, 1000.0, N_TRIALS, d.Failures(0.2, 1000.0, 1000.0), sloppy=False)
    ok = res["write_ok"] & res["read_ok"]
    k = int(res["stale"][ok].sum())
    report(f"N={N} R={R} W={W}, f=0.2: stale reads", k, int(ok.sum()), 0.0, exact_ok=k == 0)

# 7. Preference lists: distinct physical nodes, in ring order.
print("\nPreference lists")
ring = d.Ring(30, 8, seed=0)
rng = np.random.default_rng(20)
bad = 0
for key in rng.integers(0, 2**63, 2000, dtype=np.int64):
    pos = int(key) * 2
    pl = ring.preference_list(pos)
    # Brute force: owners of tokens sorted by clockwise distance from the key.
    dist = (ring.pos.astype(object) - pos) % 2**64
    order = sorted(range(len(dist)), key=lambda i: dist[i])
    brute = []
    for i in order:
        if int(ring.owner[i]) not in brute:
            brute.append(int(ring.owner[i]))
    bad += pl != brute or len(set(pl)) != 30
print(f"{'PASS' if bad == 0 else 'FAIL'}  2,000 keys: preference lists match a brute-force walk ({bad} mismatches)")
failed += bad > 0

print(f"\n{failed} failed")
assert comb(3, 1) == 3
