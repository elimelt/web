"""Fixture for the LsqAccuracy figure's tests: problems built by numpy, with
the 80-digit reference solution from mpmath and numpy/scipy's own answers.

Run:  python3 make_fixture.py ../../../../quartz-site/plugins/mdx/test/lsq-accuracy.fixture.json
"""
import json, sys
import mpmath as mp
import numpy as np
from lsq_accuracy import problem, reference, solve_all

CASES = [(1e0, 0.0, 1), (1e4, 0.0, 2), (1e8, 0.0, 3), (1e12, 0.0, 4),
         (1e4, 1.0, 5), (1e8, 1.0, 6), (1e6, 1e-4, 7)]

out = []
for kappa, tan, seed in CASES:
    A, b = problem(60, 8, kappa, tan, seed)
    xref, _, _ = reference(A, b)
    sols = solve_all(A, b)
    out.append(dict(kappa=kappa, tan=tan, m=60, n=8,
                    a=A.ravel().tolist(), b=b.tolist(),
                    xref_hi=[float(t) for t in xref],
                    xref_lo=[float(t - mp.mpf(float(t))) for t in xref],
                    numpy={k: (None if v is None else v.tolist()) for k, v in sols.items()}))
json.dump(out, open(sys.argv[1], "w"))
print("wrote", sys.argv[1])
