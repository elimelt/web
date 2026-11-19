# Closed forms used in the note.
import math
import numpy as np

def fpr_std(bits_per_key, k):
    return (1 - math.exp(-k / bits_per_key)) ** k

def fpr_blocked(bits_per_key, k, B, imax=None):
    # Putze, Sanders, Singler: a block of B bits receives Poisson(B / bits_per_key) keys.
    lam = B / bits_per_key
    i = np.arange(0, int(lam + 20 * math.sqrt(lam) + 50))
    p = np.exp(-lam + i * math.log(lam) - np.array([math.lgamma(x + 1) for x in i]))
    inner = (1 - (1 - 1 / B) ** (i * k)) ** k
    return float(np.sum(p * inner))

if __name__ == "__main__":
    for b in [6, 8, 10, 12, 16, 20, 24]:
        k0 = round(b * math.log(2))
        best512 = min(range(1, 30), key=lambda k: fpr_blocked(b, k, 512))
        best64 = min(range(1, 30), key=lambda k: fpr_blocked(b, k, 64))
        print(b, k0, f"std {fpr_std(b,k0):.3e}", f"b512(k0) {fpr_blocked(b,k0,512):.3e}", f"b512 best k={best512} {fpr_blocked(b,best512,512):.3e}",
              f"b64(k0) {fpr_blocked(b,k0,64):.3e}", f"b64 best k={best64} {fpr_blocked(b,best64,64):.3e}")

def occupancy_moments(B, k, tmax):
    # E[(X_t / B)^k] for t = 0..tmax, where X_t is the number of distinct bits set
    # after t independent uniform throws into B bits (exact, by dynamic programming).
    out = np.zeros(tmax + 1)
    dist = np.zeros(B + 1); dist[0] = 1.0
    x = np.arange(B + 1)
    w = (x / B) ** k
    for t in range(tmax + 1):
        out[t] = dist @ w
        new = dist * (x / B)
        new[1:] += dist[:-1] * (1 - x[:-1] / B)
        dist = new
    return out

def fpr_blocked_exact(bits_per_key, k, B):
    # Same Poisson load, but the fill of a block is a random variable, not its mean.
    lam = B / bits_per_key
    imax = int(lam + 20 * math.sqrt(lam) + 50)
    i = np.arange(imax + 1)
    p = np.exp(-lam + i * math.log(lam) - np.array([math.lgamma(x + 1) for x in i]))
    mom = occupancy_moments(B, k, imax * k)
    return float(np.sum(p * mom[i * k]))
