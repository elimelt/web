"""Writes timeline_fixtures.json: completion times from policies.py for small
random job sets, which the timeline figure's test compares against its own
TypeScript schedules (notes/quartz-site/plugins/mdx/test/schedule-timeline.test.mjs).

Run: python3 make_fixtures.py
"""
import json
import random

import policies as P


def main():
    rng = random.Random(2026)
    cases = []
    for _ in range(300):
        n = rng.randint(1, 6)
        jobs = sorted((rng.randint(0, 10), rng.randint(1, 8)) for _ in range(n))
        arr = [float(a) for a, _ in jobs]
        size = [float(s) for _, s in jobs]
        q = rng.choice([0.5, 1, 2, 3])
        q0 = rng.choice([0.5, 1, 2])
        levels = rng.randint(1, 4)
        boost = rng.choice([0, 0, 3, 5, 7])
        cases.append({
            "jobs": [{"arrival": a, "size": s} for a, s in zip(arr, size)],
            "quantum": q, "q0": q0, "levels": levels, "boost": boost,
            "done": {
                "fifo": P.fifo(arr, size),
                "sjf": P.sjf(arr, size),
                "srpt": P.srpt(arr, size),
                "ps": P.ps(arr, size),
                "rr": P.rr(arr, size, q),
                "mlfq": P.mlfq(arr, size, q0, levels, boost=boost or None),
            },
        })
    with open("timeline_fixtures.json", "w") as f:
        json.dump(cases, f, separators=(",", ":"))
    print(len(cases), "cases")


if __name__ == "__main__":
    main()
