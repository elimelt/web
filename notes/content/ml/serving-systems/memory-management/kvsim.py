"""KV-cache allocation simulator: reserve-max, grow-by-doubling and paged blocks.

This is the reference the figure's TypeScript model is tested against
(quartz-site/plugins/mdx/test/kv-alloc.test.mjs). The two were written
separately; the test compares their outputs on the committed trace slices.

Model of a serving step (one "iteration"), saturated FCFS queue:

1. Growth. Every running request, oldest admission first, appends the KV of
   one token. If that needs memory the allocator cannot give, the most recently
   admitted running request is preempted (vLLM's recompute policy: its memory
   is freed and it goes back to the front of the queue with its prompt plus the
   tokens it had generated), and the growth is retried.
2. Completion. A request whose KV length reached prompt + output frees its
   memory.
3. Admission. If nothing was preempted in step 1, requests are admitted in
   queue order until the head does not fit (head-of-line blocking). Admission
   allocates for the request's current context.
4. Sample. Memory is split into used, reserved (allocated slots the request
   will still fill), internal fragmentation (allocated slots past the
   request's final length), external fragmentation (free memory that is at
   least the head request's need but holds no block large enough) and free.

A request with prompt c and output g holds c slots after the step that admits
it and c + g slots in its last step.

Allocators, in units of token slots:
- max: a contiguous region of max_len slots per request (buddy allocator).
- double: a contiguous region of max(16, next power of two >= c) slots, which
  doubles when full: in place if its buddy is free, else by allocating the
  larger block, copying the KV, and freeing the old block (buddy allocator).
  `headroom` optionally keeps that fraction of the budget free at admission.
- paged: fixed blocks of `block` slots from a pool; admission keeps vLLM's
  1% watermark of free blocks (vllm/core/block_manager_v1.py, v0.6.0).
"""

from bisect import bisect_left, insort
from collections import deque

MIN_BLOCK = 16


def pow2ceil(n):
    p = 1
    while p < n:
        p <<= 1
    return p


class Buddy:
    """Binary buddy allocator over [0, total) made of top-sized roots.

    Allocation takes the lowest-address free block of the smallest size that
    fits and splits it, keeping the lower half each time.
    """

    def __init__(self, total, top):
        assert total % top == 0 and top & (top - 1) == 0
        self.top = top
        self.free = {}
        s = MIN_BLOCK
        while s <= top:
            self.free[s] = []
            s <<= 1
        self.free[top] = list(range(0, total, top))
        self.free_total = total

    def _has(self, size, a):
        lst = self.free[size]
        i = bisect_left(lst, a)
        return i < len(lst) and lst[i] == a

    def _remove(self, size, a):
        lst = self.free[size]
        lst.pop(bisect_left(lst, a))

    def can_alloc(self, size):
        s = size
        while s <= self.top:
            if self.free[s]:
                return True
            s <<= 1
        return False

    def alloc(self, size):
        s = size
        while s <= self.top and not self.free[s]:
            s <<= 1
        if s > self.top:
            return None
        a = self.free[s].pop(0)
        while s > size:
            s >>= 1
            insort(self.free[s], a + s)
        self.free_total -= size
        return a

    def release(self, a, size):
        self.free_total += size
        while size < self.top:
            b = a ^ size
            if not self._has(size, b):
                break
            self._remove(size, b)
            a = min(a, b)
            size <<= 1
        insort(self.free[size], a)

    def grow_in_place(self, a, size):
        if 2 * size > self.top or a % (2 * size) != 0 or not self._has(size, a + size):
            return False
        self._remove(size, a + size)
        self.free_total -= size
        return True


class Req:
    __slots__ = ("i", "final", "ctx", "len", "cap", "addr")

    def __init__(self, i, c, g):
        self.i = i
        self.final = c + g
        self.ctx = c
        self.len = 0
        self.cap = 0
        self.addr = -1


def simulate(reqs, kind, budget, block=16, max_len=8192, top=16384, watermark=0.01, headroom=0.0):
    """Replay (prompt, output) pairs through one allocator; return averages over
    the iterations in which the queue is non-empty after admission."""
    waiting = deque(Req(i, c, g) for i, (c, g) in enumerate(reqs))
    running = []
    buddy = Buddy(budget, top) if kind in ("max", "double") else None
    nblocks = budget // block
    free_blocks = nblocks
    wm = int(watermark * nblocks)
    totals = dict(used=0, reserved=0, internal=0, external=0, free=0, running=0)
    steady = 0
    iters = 0
    preemptions = 0
    recomputed = 0
    copied = 0
    peak_running = 0

    def need(r):
        if kind == "max":
            return max_len
        if kind == "double":
            return max(MIN_BLOCK, pow2ceil(r.ctx))
        return -(-r.ctx // block)

    def admit(r):
        nonlocal free_blocks
        n = need(r)
        if kind == "paged":
            if free_blocks - n < wm:
                return False
            free_blocks -= n
            r.cap = n * block
        else:
            if buddy.free_total - n < headroom * budget:
                return False
            a = buddy.alloc(n)
            if a is None:
                return False
            r.addr, r.cap = a, n
        r.len = r.ctx
        return True

    def release(r):
        nonlocal free_blocks
        if kind == "paged":
            free_blocks += r.cap // block
        else:
            buddy.release(r.addr, r.cap)
        r.cap, r.addr = 0, -1

    def grow(r):
        """Make room for slot r.len + 1; False if memory is exhausted."""
        nonlocal free_blocks, copied
        if r.len < r.cap:
            return True
        if kind == "paged":
            if free_blocks == 0:
                return False
            free_blocks -= 1
            r.cap += block
            return True
        if kind == "max":
            raise AssertionError("request outgrew max_len")
        if buddy.grow_in_place(r.addr, r.cap):
            r.cap *= 2
            return True
        a = buddy.alloc(2 * r.cap)
        if a is None:
            return False
        copied += r.len
        buddy.release(r.addr, r.cap)
        r.addr, r.cap = a, 2 * r.cap
        return True

    while waiting or running:
        iters += 1
        preempted = False
        i = 0
        while i < len(running):
            r = running[i]
            gone = False
            while not grow(r):
                v = running.pop()
                release(v)
                v.ctx = v.len
                waiting.appendleft(v)
                preemptions += 1
                recomputed += v.len
                preempted = True
                if v is r:
                    gone = True
                    break
            if gone:
                break
            r.len += 1
            i += 1
        keep = []
        for r in running:
            if r.len >= r.final:
                release(r)
            else:
                keep.append(r)
        running = keep
        if not preempted:
            while waiting and admit(waiting[0]):
                running.append(waiting.popleft())
        peak_running = max(peak_running, len(running))
        if waiting:
            steady += 1
            used = sum(r.len for r in running)
            alloc = sum(r.cap for r in running)
            res = sum(min(r.cap, r.final) - r.len for r in running)
            internal = sum(max(0, r.cap - r.final) for r in running)
            free = budget - alloc
            ext = 0
            if buddy is not None:
                n = need(waiting[0])
                if free >= n and not buddy.can_alloc(n):
                    ext = free
            totals["used"] += used
            totals["reserved"] += res
            totals["internal"] += internal
            totals["external"] += ext
            totals["free"] += free - ext
            totals["running"] += len(running)
    out = {k: (v / steady / (1 if k == "running" else budget) if steady else 0.0) for k, v in totals.items()}
    out.update(
        steady_iterations=steady,
        iterations=iters,
        preemptions=preemptions,
        recomputed_tokens=recomputed,
        copied_tokens=copied,
        generated_tokens=sum(g for _, g in reqs),
        peak_running=peak_running,
    )
    return out
