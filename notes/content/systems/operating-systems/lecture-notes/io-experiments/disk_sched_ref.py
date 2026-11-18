"""Independent reference for the DiskQueue figure: the same disk and closed queue,
written separately in Python with its own random generator. Prints JSON of the
long-run requests per second and mean positioning time for each policy and depth."""
import json, math, random

RPM, AVG, SETTLE, MBPS, BS = 7200, 9.0, 1.0, 105, 4096
REV = 60000 / RPM
FULL = SETTLE + (AVG - SETTLE) * 15 / 8
XFER = BS / (MBPS * 1e6) * 1000

def seek(a, b):
    d = abs(a - b)
    return 0.0 if d == 0 else SETTLE + (FULL - SETTLE) * math.sqrt(d)

def rot(t, ang):
    return ((ang - (t / REV) % 1.0) % 1.0) * REV

def sim(policy, qd, n=40000, warm=2000, seed=11):
    rng = random.Random(seed)
    t, head = 0.0, rng.random()
    q = [(rng.random(), rng.random(), 0.0, i) for i in range(qd)]
    nid = qd
    first = None; pos = 0.0; resp = 0.0
    for k in range(warm + n):
        if policy == "fcfs":
            j = min(range(len(q)), key=lambda i: q[i][3])
        elif policy == "sstf":
            j = min(range(len(q)), key=lambda i: abs(q[i][0] - head))
        elif policy == "clook":
            ahead = [i for i in range(len(q)) if q[i][0] >= head]
            j = min(ahead, key=lambda i: q[i][0]) if ahead else min(range(len(q)), key=lambda i: q[i][0])
        else:
            j = min(range(len(q)), key=lambda i: seek(head, q[i][0]) + rot(t + seek(head, q[i][0]), q[i][1]))
        r, ang, arr, _ = q.pop(j)
        s = seek(head, r); w = rot(t + s, ang)
        if k == warm: first = t
        end = t + s + w + XFER
        if k >= warm: pos += s + w; resp += end - arr
        t, head = end, r
        q.append((rng.random(), rng.random(), t, nid)); nid += 1
    return {"iops": n / (t - first) * 1000, "pos": pos / n, "resp": resp / n}

out = {p: {str(d): sim(p, d) for d in (1, 4, 16, 64)} for p in ("fcfs", "sstf", "clook", "sptf")}
print(json.dumps(out, indent=1))
