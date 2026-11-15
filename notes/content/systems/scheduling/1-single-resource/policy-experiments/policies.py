"""Exact event-driven simulators for one preemptive server.

Each function takes arrival times (sorted, ascending) and job sizes and returns
the completion time of every job. Preemption and switching are free, and the
server never idles while work is waiting (every policy is work conserving).

Policies: fifo, sjf (non-preemptive shortest job first), srpt, ps (processor
sharing, the limit of round robin as the quantum goes to zero), rr (round robin
with a finite quantum), fb (foreground-background, also called least attained
service), mlfq (multi-level feedback queue with CPU-bound jobs) and
srpt_estimates (preemptive shortest *estimated* remaining time).
"""
import heapq
import math
from collections import deque

EPS = 1e-12


def fifo(arr, size):
    done = [0.0] * len(arr)
    now = 0.0
    for i, (a, s) in enumerate(zip(arr, size)):
        now = max(now, a) + s
        done[i] = now
    return done


def sjf(arr, size):
    n = len(arr)
    done = [0.0] * n
    heap = []
    now = 0.0
    i = 0
    while i < n or heap:
        if not heap:
            now = max(now, arr[i])
        while i < n and arr[i] <= now:
            heapq.heappush(heap, (size[i], i))
            i += 1
        s, j = heapq.heappop(heap)
        now += s
        done[j] = now
    return done


def srpt(arr, size):
    """Preemptive; the job with the least remaining work runs."""
    n = len(arr)
    done = [0.0] * n
    heap = []  # (remaining, index)
    now = 0.0
    i = 0
    while i < n or heap:
        if not heap:
            now = max(now, arr[i])
            while i < n and arr[i] <= now:
                heapq.heappush(heap, (size[i], i))
                i += 1
        rem, j = heap[0]
        nxt = arr[i] if i < n else float("inf")
        if now + rem <= nxt + EPS:
            heapq.heappop(heap)
            now += rem
            done[j] = now
        else:
            heapq.heapreplace(heap, (rem - (nxt - now), j))
            now = nxt
        while i < n and arr[i] <= now:
            heapq.heappush(heap, (size[i], i))
            i += 1
    return done


def srpt_estimates(arr, size, est):
    """Preemptive; runs the job whose estimate minus attained service is
    smallest (this can go negative when a job outlives its estimate)."""
    n = len(arr)
    done = [0.0] * n
    attained = [0.0] * n
    heap = []  # (estimate - attained, index)
    now = 0.0
    i = 0
    while i < n or heap:
        if not heap:
            now = max(now, arr[i])
            while i < n and arr[i] <= now:
                heapq.heappush(heap, (est[i], i))
                i += 1
        _, j = heap[0]
        rem = size[j] - attained[j]
        nxt = arr[i] if i < n else float("inf")
        if now + rem <= nxt + EPS:
            heapq.heappop(heap)
            now += rem
            done[j] = now
        else:
            attained[j] += nxt - now
            heapq.heapreplace(heap, (est[j] - attained[j], j))
            now = nxt
        while i < n and arr[i] <= now:
            heapq.heappush(heap, (est[i], i))
            i += 1
    return done


def ps(arr, size):
    """Processor sharing: every job present gets 1/N of the server.

    V is the service each job present has received since time zero; job j
    finishes when V reaches V(arrival_j) + size_j.
    """
    n = len(arr)
    done = [0.0] * n
    heap = []  # (finish in virtual time, index)
    now = 0.0
    V = 0.0
    i = 0
    while i < n or heap:
        if not heap:
            now = max(now, arr[i])
        while i < n and arr[i] <= now + EPS:
            heapq.heappush(heap, (V + size[i], i))
            i += 1
        m = len(heap)
        f, j = heap[0]
        nxt = arr[i] if i < n else float("inf")
        t_fin = now + (f - V) * m
        if t_fin <= nxt + EPS:
            heapq.heappop(heap)
            now = t_fin
            V = f
            done[j] = now
        else:
            V += (nxt - now) / m
            now = nxt
    return done


def rr(arr, size, quantum, switch=0.0):
    """Round robin with a finite quantum. An arrival during a slice joins the
    back of the queue before the preempted job does. `switch` is dead time
    paid every time a different job is dispatched."""
    n = len(arr)
    done = [0.0] * n
    rem = list(size)
    q = deque()
    now = 0.0
    i = 0
    last = -1
    while i < n or q:
        if not q:
            now = max(now, arr[i])
        while i < n and arr[i] <= now:
            q.append(i)
            i += 1
        j = q.popleft()
        if j != last:
            now += switch
        last = j
        run = min(quantum, rem[j])
        now += run
        rem[j] -= run
        while i < n and arr[i] <= now:
            q.append(i)
            i += 1
        if rem[j] <= EPS:
            done[j] = now
        else:
            q.append(j)
    return done


def fb(arr, size):
    """Foreground-background (least attained service): the jobs with the least
    service so far share the server equally.

    The jobs tied at the lowest attained service form the active group. When a
    job arrives (attained 0) the active group is frozen on a stack; frozen
    groups are ordered with the least attained on top. When the active group
    catches up with the top frozen group the two merge.
    """
    n = len(arr)
    done = [0.0] * n
    stack = []  # (attained level, heap of (size, index))
    act = []  # heap of (size, index)
    a = 0.0  # attained service of the active group
    now = 0.0
    i = 0
    while i < n or act or stack:
        if not act and stack:
            a, act = stack.pop()
        if not act:
            now = max(now, arr[i])
            a = 0.0
        else:
            nxt = arr[i] if i < n else float("inf")
            m = len(act)
            fin = act[0][0]  # attained level at which the smallest finishes
            lvl = min(fin, stack[-1][0]) if stack else fin
            t = now + (lvl - a) * m
            if t <= nxt:
                now, a = t, lvl
                while act and act[0][0] <= a * (1 + 1e-12) + EPS:
                    _, j = heapq.heappop(act)
                    done[j] = now
                if stack and stack[-1][0] <= a * (1 + 1e-12) + EPS:
                    _, other = stack.pop()
                    if len(other) > len(act):
                        act, other = other, act
                    for item in other:
                        heapq.heappush(act, item)
                continue
            a += (nxt - now) / m
            now = nxt
        if i < n and arr[i] <= now:
            if act:
                stack.append((a, act))
                act = []
            a = 0.0
            while i < n and arr[i] <= now:
                heapq.heappush(act, (size[i], i))
                i += 1
    return done


def mlfq(arr, size, q0, levels, boost=None, growth=2.0):
    """CPU-bound jobs in a multi-level feedback queue (OSTEP rules 1 to 5).

    Level k has allotment q0 * growth**k; a job that uses its allotment moves
    down one level (the last level is round robin with its own quantum). A
    job preempted by a higher level keeps its place at the head of its level
    and its unused allotment. Every `boost` seconds all jobs return to level
    0, in level order, with fresh allotments (allotments of jobs already at
    level 0 are reset lazily through an epoch counter).
    """
    n = len(arr)
    done = [0.0] * n
    rem = list(size)
    left = [0.0] * n  # allotment left at the current level
    epoch = [0] * n
    qs = [deque() for _ in range(levels)]
    quanta = [q0 * growth ** k for k in range(levels)]
    now = 0.0
    i = 0
    present = 0
    lower = 0  # jobs below level 0
    cur = 0  # boost epoch
    next_boost = boost if boost else float("inf")

    while i < n or present:
        if not present:
            now = max(now, arr[i])
            if boost and next_boost <= now:
                k = math.floor((now - next_boost) / boost) + 1
                next_boost += k * boost
                cur += k
        while i < n and arr[i] <= now:
            qs[0].append(i)
            left[i] = quanta[0]
            epoch[i] = cur
            i += 1
            present += 1
        k = 0
        while not qs[k]:
            k += 1
        j = qs[k][0]
        if epoch[j] != cur:
            epoch[j] = cur
            left[j] = quanta[k]
        nxt = arr[i] if i < n else float("inf")
        end = now + min(rem[j], left[j])
        stop = min(end, next_boost, nxt if k > 0 else end)
        dt = stop - now
        now = stop
        if stop == end:
            if rem[j] <= left[j]:
                rem[j] = 0.0
            else:
                rem[j] -= dt
                left[j] = 0.0
        else:
            rem[j] -= dt
            left[j] -= dt
        if rem[j] <= EPS:
            qs[k].popleft()
            done[j] = now
            present -= 1
            if k:
                lower -= 1
        elif left[j] <= EPS:
            qs[k].popleft()
            nk = min(k + 1, levels - 1)
            left[j] = quanta[nk]
            qs[nk].append(j)
            if k == 0:
                lower += 1
        if now >= next_boost:
            cur += 1
            next_boost += boost
            if lower:
                for k2 in range(1, levels):
                    qs[0].extend(qs[k2])
                    qs[k2].clear()
                lower = 0
    return done


def srpt_bounce(arr, size, est):
    """SRPT-Bounce (Scully, Grosof and Mitzenmacher, ITCS 2022): the rank of a
    job with estimate z and attained service a is z - a until a reaches z,
    then a - z, capped at z. Lowest rank runs. Waiting jobs keep their rank.
    A running job whose rank climbs is preempted once it exceeds the best
    waiting rank by 1% (so two climbing jobs alternate a bounded number of
    times instead of sharing exactly)."""
    def rank(j, a):
        z = est[j]
        return z - a if a <= z else min(a - z, z)

    n = len(arr)
    done = [0.0] * n
    att = [0.0] * n
    heap = []  # (rank, index) of waiting jobs
    now = 0.0
    i = 0
    run = -1
    while i < n or heap or run >= 0:
        if run < 0:
            if not heap:
                now = max(now, arr[i])
                while i < n and arr[i] <= now:
                    heapq.heappush(heap, (est[i], i))
                    i += 1
            _, run = heapq.heappop(heap)
        j = run
        z = est[j]
        a = att[j]
        nxt = arr[i] if i < n else float("inf")
        t_fin = now + size[j] - a
        t_pre = float("inf")
        if heap:
            r2 = heap[0][0] * 1.01 + 1e-9
            # rank is a - z on (z, 2z]; it passes r2 at a = z + r2 if r2 < z
            if r2 < z:
                t_pre = now + max(z + r2 - a, 0.0)
        t = min(t_fin, t_pre, nxt)
        att[j] = a + (t - now)
        now = t
        if t == t_fin:
            done[j] = now
            run = -1
        elif t == t_pre:
            heapq.heappush(heap, (rank(j, att[j]), j))
            run = -1
        else:
            while i < n and arr[i] <= now:
                heapq.heappush(heap, (est[i], i))
                i += 1
            if heap[0][0] < rank(j, att[j]):
                heapq.heappush(heap, (rank(j, att[j]), j))
                run = -1
    return done
