import random, subprocess, struct, refsim
random.seed(1)
bad = 0
for trial in range(40):
    D = random.randint(3, 30); n = random.randint(50, 600)
    # mix of loops, locality and random references
    r = []
    while len(r) < n:
        k = random.random()
        if k < 0.3: r += list(range(random.randint(0, D//2), D)) * random.randint(1, 3)
        elif k < 0.6: base = random.randint(0, D - 3); r += [base + random.randint(0, 2) for _ in range(20)]
        else: r += [random.randrange(D) for _ in range(20)]
    r = r[:n]
    open('t.u32', 'wb').write(struct.pack(f'<{n}I', *r))
    Fs = sorted(set(random.randint(1, D + 2) for _ in range(5)))
    for pol in ['fifo', 'lru', 'clock', 'opt', 'arc']:
        out = subprocess.run(['./pagesim', 't.u32', pol] + [str(F) for F in Fs], capture_output=True, text=True).stdout.split('\n')
        for F, line in zip(Fs, out):
            c = int(line.split()[2]); py = getattr(refsim, pol)(r, F)
            if c != py: bad += 1; print('MISMATCH', pol, F, c, py)
print('mismatches', bad)
