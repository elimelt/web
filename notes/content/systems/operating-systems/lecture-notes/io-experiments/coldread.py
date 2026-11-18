"""Read random 4 KiB blocks of image files with O_DIRECT, twice, and time each read.
First pass: blocks the guest has likely never read since boot. Second pass: same blocks again."""
import os, mmap, random, time, json, sys
roots = sys.argv[1:] or ["/usr/lib", "/usr/share", "/usr/libexec", "/opt"]
files = []
for r in roots:
    for d, _, fs in os.walk(r):
        for f in fs:
            p = os.path.join(d, f)
            try:
                st = os.lstat(p)
            except OSError:
                continue
            if os.path.isfile(p) and not os.path.islink(p) and st.st_size >= 1 << 20 and st.st_dev == os.stat("/").st_dev:
                files.append((p, st.st_size))
rng = random.Random(1)
picks = []
for _ in range(2000):
    p, sz = rng.choice(files)
    picks.append((p, rng.randrange(sz // 4096) * 4096))
buf = mmap.mmap(-1, 4096)
def run():
    out = []
    for p, off in picks:
        fd = os.open(p, os.O_RDONLY | os.O_DIRECT)
        t = time.perf_counter_ns(); os.preadv(fd, [buf], off); out.append(time.perf_counter_ns() - t)
        os.close(fd)
    return out
a = run(); b = run()
json.dump({"files": len(files), "first": a, "second": b}, open("coldread.json", "w"))
def q(x, p): x = sorted(x); return x[int(p * (len(x) - 1))] / 1e3
for name, x in (("first", a), ("second", b)):
    print(name, "p50 %.1f us  p90 %.1f  p99 %.1f  max %.1f" % (q(x, .5), q(x, .9), q(x, .99), max(x) / 1e3))
