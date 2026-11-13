# Plain O(n*F) reference implementations used only to check pagesim.c.
from collections import OrderedDict
def fifo(r, F):
    mem, q, f = set(), [], 0
    for p in r:
        if p in mem: continue
        f += 1
        if len(mem) == F: mem.remove(q.pop(0))
        mem.add(p); q.append(p)
    return f
def lru(r, F):
    od, f = OrderedDict(), 0
    for p in r:
        if p in od: od.move_to_end(p); continue
        f += 1
        if len(od) == F: od.popitem(last=False)
        od[p] = 1
    return f
def clock(r, F):
    pages, bits, hand, f = [], [], 0, 0
    for p in r:
        if p in pages: bits[pages.index(p)] = 1; continue
        f += 1
        if len(pages) < F: pages.append(p); bits.append(1); continue
        while bits[hand]: bits[hand] = 0; hand = (hand + 1) % F
        pages[hand] = p; bits[hand] = 1; hand = (hand + 1) % F
    return f
def opt(r, F):
    mem, f = set(), 0
    for t, p in enumerate(r):
        if p in mem: continue
        f += 1
        if len(mem) == F:
            def nxt(q):
                for u in range(t + 1, len(r)):
                    if r[u] == q: return u
                return 10**18
            mem.remove(max(mem, key=lambda q: (nxt(q), q)))
        mem.add(p)
    return f
def arc(r, c):
    T1, T2, B1, B2 = OrderedDict(), OrderedDict(), OrderedDict(), OrderedDict()  # first item = LRU
    p, f = 0.0, 0
    def replace(x):
        if T1 and (len(T1) > p or (x in B2 and len(T1) == p)):
            v, _ = T1.popitem(last=False); B1[v] = 1
        else:
            v, _ = T2.popitem(last=False); B2[v] = 1
    for x in r:
        if x in T1: del T1[x]; T2[x] = 1; continue
        if x in T2: T2.move_to_end(x); continue
        f += 1
        if x in B1:
            p = min(p + (1 if len(B1) >= len(B2) else len(B2) / len(B1)), c); replace(x); del B1[x]; T2[x] = 1; continue
        if x in B2:
            p = max(p - (1 if len(B2) >= len(B1) else len(B1) / len(B2)), 0); replace(x); del B2[x]; T2[x] = 1; continue
        if len(T1) + len(B1) == c:
            if len(T1) < c: B1.popitem(last=False); replace(x)
            else: T1.popitem(last=False)
        else:
            tot = len(T1) + len(T2) + len(B1) + len(B2)
            if tot >= c:
                if tot == 2 * c: B2.popitem(last=False)
                replace(x)
        T1[x] = 1
    return f
