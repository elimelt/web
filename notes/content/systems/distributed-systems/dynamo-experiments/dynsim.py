"""A Monte Carlo simulator of a Dynamo-style replicated key-value store.

The store is the one DeCandia et al. (SOSP 2007) describe: an MD5 consistent
hashing ring with virtual nodes, preference lists of distinct physical nodes,
sloppy quorums over the first N reachable nodes, hinted handoff to the home
node after it recovers, and read repair. Message delays follow the WARS model
and the production latency fits of Bailis et al., "Probabilistically Bounded
Staleness for Practical Partial Quorums" (VLDB 2012), Table 3.

Each trial writes one new version of one key and reads the key t ms after the
write commits. The read is stale if none of the first R replies carries the new
version. Everything is vectorized over trials with NumPy; times are in ms.

Coordinator placement follows WARS (and Dynamo's client-driven coordination,
section 6.4 of the paper): the coordinator is not one of the replicas, so every
replica is reached over the network.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from math import comb

import numpy as np

# ---------------------------------------------------------------------------
# Latency profiles: Bailis et al. (2012), Table 3. Each one-way delay is a
# mixture of a Pareto body (weight, x_m, alpha) and an exponential tail
# (rate lambda per ms).


@dataclass(frozen=True)
class Mix:
    w_pareto: float
    xm: float
    alpha: float
    lam: float

    def sample(self, rng: np.random.Generator, shape) -> np.ndarray:
        u = rng.random(shape)
        pareto = self.xm * (1.0 - rng.random(shape)) ** (-1.0 / self.alpha)
        expo = rng.exponential(1.0 / self.lam, shape)
        return np.where(u < self.w_pareto, pareto, expo)


LNKD_ARS = Mix(0.9122, 0.235, 10.0, 1.66)
PROFILES = {
    # W, A, R, S
    "LNKD-SSD": (LNKD_ARS, LNKD_ARS, LNKD_ARS, LNKD_ARS),
    "LNKD-DISK": (Mix(0.38, 1.05, 1.51, 0.183), LNKD_ARS, LNKD_ARS, LNKD_ARS),
    "YMMR": (Mix(0.939, 3.0, 3.35, 0.0028),) + (Mix(0.982, 1.5, 3.8, 0.0217),) * 3,
}
# WAN (section 5.5 of the PBS paper): LNKD-DISK delays inside the datacenter
# that holds the replica, plus 75 ms on every message to or from a replica in
# another datacenter. Replica j sits in datacenter j mod 3; the write and the
# read each originate in a datacenter chosen uniformly at random.
WAN_DELAY = 75.0
WAN_DCS = 3


def sample_wars(rng, profile: str, n: int, width: int, same_dc: bool = False):
    """Delays W, A, R, S, each shaped (n, width), for replicas 0..width-1."""
    base = "LNKD-DISK" if profile == "WAN" else profile
    dw, da, dr, ds = PROFILES[base]
    w, a, r, s = (d.sample(rng, (n, width)) for d in (dw, da, dr, ds))
    if profile == "WAN":
        dc = np.arange(width) % WAN_DCS
        wdc = rng.integers(0, WAN_DCS, n)[:, None]
        rdc = wdc if same_dc else rng.integers(0, WAN_DCS, n)[:, None]
        wr = (dc[None, :] != wdc) * WAN_DELAY
        rr = (dc[None, :] != rdc) * WAN_DELAY
        w, a, r, s = w + wr, a + wr, r + rr, s + rr
    return w, a, r, s


# ---------------------------------------------------------------------------
# Failure-free t-visibility: the WARS model exactly.


def stale_thresholds(rng, profile: str, N: int, R: int, W: int, n: int) -> np.ndarray:
    """For each trial, the largest t (ms after commit) at which the read is stale.

    A read issued t ms after commit reaches replica i at wt + t + r_i, where wt
    is the W-th smallest w_i + a_i, and finds the new version if w_i is no later
    than that. The R replies used are the R smallest r_i + s_i, which do not
    depend on t, so the read is stale exactly when t < min over those R
    replicas of (w_i - wt - r_i). P(stale at t) = P(threshold > t).
    """
    w, a, r, s = sample_wars(rng, profile, n, N)
    wt = np.partition(w + a, W - 1, axis=1)[:, W - 1]
    first = np.argsort(r + s, axis=1)[:, :R]
    slack = w - wt[:, None] - r
    return np.take_along_axis(slack, first, axis=1).min(axis=1)


# ---------------------------------------------------------------------------
# The ring.


def md5_int(text: str) -> int:
    return int.from_bytes(hashlib.md5(text.encode()).digest(), "big")


class Ring:
    """Strategy 1 of the Dynamo paper: T random tokens per node, MD5 positions."""

    def __init__(self, nodes: int, tokens: int, seed: int = 0):
        pts = sorted((md5_int(f"s{seed}-node{n}#tok{t}"), n) for n in range(nodes) for t in range(tokens))
        self.pos = np.array([p >> 64 for p, _ in pts], dtype=np.uint64)  # top 64 bits suffice
        self.owner = np.array([o for _, o in pts], dtype=np.int64)
        self.nodes = nodes

    def preference_list(self, key_pos: int) -> list[int]:
        """Distinct physical nodes met walking clockwise from the key, all of them."""
        i = int(np.searchsorted(self.pos, np.uint64(key_pos), side="left")) % len(self.pos)
        seen: list[int] = []
        for j in range(len(self.pos)):
            o = int(self.owner[(i + j) % len(self.pos)])
            if o not in seen:
                seen.append(o)
                if len(seen) == self.nodes:
                    break
        return seen


# ---------------------------------------------------------------------------
# The full store: failures, sloppy or strict quorums, hinted handoff.


@dataclass
class Failures:
    """Each node alternates between up and down as a two-state Markov chain.

    f is the long-run fraction of time a node is down, outage the mean length
    of a down period (ms) and hint_delay the mean time (ms) from a home node's
    recovery to the delivery of a hinted replica, exponentially distributed.
    """

    f: float = 0.0
    outage: float = 1000.0
    hint_delay: float = 1000.0


def _down_later(rng, down0: np.ndarray, rec: np.ndarray, tau: np.ndarray, fl: Failures) -> np.ndarray:
    """Whether each node is down at time tau, given its state at 0 and, for nodes
    down at 0, its first recovery time rec. Exact for the Markov chain."""
    f = fl.f
    if f <= 0:
        return np.zeros_like(down0)
    kappa = 1.0 / (fl.outage * (1.0 - f))  # sum of the two transition rates
    u = rng.random(down0.shape)
    # Up at a time s: down at s + d with probability f (1 - exp(-kappa d)).
    d_up = np.maximum(tau - np.where(down0, rec, 0.0), 0.0)
    fails = u < f * (1.0 - np.exp(-kappa * d_up))
    return np.where(down0 & (rec > tau), True, fails)


def simulate(
    rng,
    profile: str,
    N: int,
    R: int,
    W: int,
    t: float,
    n: int,
    fl: Failures | None = None,
    sloppy: bool = True,
    width: int | None = None,
    ring: Ring | None = None,
):
    """One write, then one read t ms after commit, in n independent trials.

    Returns a dict with boolean arrays: write_ok, read_ok and stale (stale is
    meaningful where both succeeded).
    """
    fl = fl or Failures()
    L = width or min(N + 8, ring.nodes if ring else N + 8)
    w, a, r, s = sample_wars(rng, profile, n, L)
    # Which physical node sits at each preference-list position only matters
    # through its up/down state, and node states are independent, so a trial
    # can draw states per position. With a ring we still build the real list
    # for a random key and draw states per physical node, as a check.
    if ring is not None:
        keys = rng.integers(0, 2**63, n, dtype=np.int64).astype(np.uint64) * np.uint64(2)
        lists = np.array([ring.preference_list(int(k))[:L] for k in keys])
        down0_node = rng.random((n, ring.nodes)) < fl.f
        down0 = np.take_along_axis(down0_node, lists, axis=1)
    else:
        down0 = rng.random((n, L)) < fl.f
    rec = np.where(down0, rng.exponential(fl.outage, (n, L)), 0.0)

    # Write at time 0 to the first N reachable positions (sloppy) or to the
    # reachable ones among the top N (strict).
    up0 = ~down0
    rank0 = np.cumsum(up0, axis=1)
    if sloppy:
        target = up0 & (rank0 <= N)
    else:
        target = up0 & (np.arange(L) < N)[None, :]
    n_targets = target.sum(axis=1)
    write_ok = n_targets >= W
    acks = np.where(target, w + a, np.inf)
    wt = np.partition(acks, W - 1, axis=1)[:, W - 1]
    wt = np.where(write_ok, wt, 0.0)

    # Hints: the k-th down node among the top N is replaced by the k-th
    # reachable node past position N-1 that received the write.
    has_from = np.where(target, w, np.inf)  # when each position first holds the version
    gone_at = np.full((n, L), np.inf)  # when a hint holder deletes its copy
    if sloppy and fl.f > 0:
        top = np.arange(L) < N
        homes = down0 & top[None, :]
        subs = target & ~top[None, :]
        hk = np.cumsum(homes, axis=1)
        sk = np.cumsum(subs, axis=1)
        for k in range(1, min(N, L - N) + 1):
            hi = np.argmax(homes & (hk == k), axis=1)
            si = np.argmax(subs & (sk == k), axis=1)
            ok = homes[np.arange(n), hi] & (hk[np.arange(n), hi] == k) & subs[np.arange(n), si] & (sk[np.arange(n), si] == k)
            idx = np.nonzero(ok)[0]
            if not len(idx):
                continue
            arrive = w[idx, si[idx]]
            deliver = np.maximum(rec[idx, hi[idx]], arrive) + rng.exponential(fl.hint_delay, len(idx))
            has_from[idx, hi[idx]] = np.minimum(has_from[idx, hi[idx]], deliver)
            gone_at[idx, si[idx]] = deliver

    # Read at tau = wt + t to the first N reachable positions (sloppy) or the
    # reachable ones among the top N (strict). Fresh R and S delays.
    tau = wt + t
    downr = _down_later(rng, down0, rec, tau[:, None], fl)
    upr = ~downr
    rankr = np.cumsum(upr, axis=1)
    if sloppy:
        rtarget = upr & (rankr <= N)
    else:
        rtarget = upr & (np.arange(L) < N)[None, :]
    read_ok = rtarget.sum(axis=1) >= R
    arrive_r = tau[:, None] + r
    fresh = (has_from <= arrive_r) & (arrive_r < gone_at)
    reply = np.where(rtarget, r + s, np.inf)
    first = np.argsort(reply, axis=1)[:, :R]
    got = np.take_along_axis(fresh & rtarget, first, axis=1).any(axis=1)
    return {"write_ok": write_ok, "read_ok": read_ok, "stale": ~got}


def read_repair_pair(rng, profile: str, N: int, R: int, W: int, t1: float, gap: float, n: int, repair: bool):
    """Failure-free: a read at t1 after commit, then a second read gap ms later.

    With read repair, the first read's coordinator waits for all N replies; if
    any carries the new version, it sends that version to every replica that
    replied without it, which arrives after a fresh W delay. Returns whether
    each of the two reads was stale.
    """
    w, a, r, s = sample_wars(rng, profile, n, N)
    wt = np.partition(w + a, W - 1, axis=1)[:, W - 1]
    t1a = wt[:, None] + t1 + r
    fresh1 = w <= t1a
    first = np.argsort(r + s, axis=1)[:, :R]
    stale1 = ~np.take_along_axis(fresh1, first, axis=1).any(axis=1)
    has_from = w.copy()
    if repair:
        done = (wt + t1)[:, None] + (r + s).max(axis=1, keepdims=True)
        know = fresh1.any(axis=1, keepdims=True)
        wr, _, _, _ = sample_wars(rng, profile, n, N)
        fix = know & ~fresh1
        has_from = np.where(fix, np.minimum(w, done + wr), w)
    _, _, r2, s2 = sample_wars(rng, profile, n, N)  # the second read: fresh delays
    t2a = wt[:, None] + t1 + gap + r2
    first2 = np.argsort(r2 + s2, axis=1)[:, :R]
    stale2 = ~np.take_along_axis(has_from <= t2a, first2, axis=1).any(axis=1)
    return stale1, stale2


# ---------------------------------------------------------------------------
# Closed forms from PBS and an exact one for exponential writes.


def p_k_stale(N: int, R: int, W: int, k: int) -> float:
    """PBS Definition 1: probability that a read misses the last k versions
    when write and read quorums are uniformly random and non-expanding."""
    return (comb(N - W, R) / comb(N, R)) ** k


def p_stale_exponential(N: int, R: int, W: int, lam: float, t: float) -> float:
    """Exact P(stale) t ms after commit when W ~ Exp(lam) and A = R = S = 0.

    The write commits when the W-th replica receives it. By memorylessness,
    each of the other N - W replicas has received it t ms later with
    probability p = 1 - exp(-lam t), independently. With R = S = 0 the read
    quorum is a uniformly random R-subset, so given c replicas hold the
    version the read misses it with probability C(N-c, R) / C(N, R).
    """
    p = 1.0 - np.exp(-lam * t)
    m = N - W
    return sum(comb(m, j) * p**j * (1 - p) ** (m - j) * comb(N - W - j, R) / comb(N, R) for j in range(m + 1))


def p_stale_eq4(rng, profile: str, N: int, R: int, W: int, t: float, n: int) -> float:
    """PBS Equation 4: E[C(N-c, R) / C(N, R)] over c, the number of replicas
    holding the version at the moment the read is issued."""
    w, a, _, _ = sample_wars(rng, profile, n, N)
    wt = np.partition(w + a, W - 1, axis=1)[:, W - 1]
    c = (w <= wt[:, None] + t).sum(axis=1)
    table = np.array([comb(N - j, R) / comb(N, R) for j in range(N + 1)])
    return float(table[c].mean())


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    h = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return ((c - h) / d, (c + h) / d)
