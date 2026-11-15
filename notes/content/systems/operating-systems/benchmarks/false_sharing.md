---
title: False Sharing Benchmarks
aliases:
  - operating-systems/benchmarks/false_sharing
category: Performance Engineering
tags:
  - false-sharing
  - cache coherence
  - mesi
  - multi-threading
  - cache-line
  - benchmarks
date: 2025-12-29
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: needs-review
description: The cost of false sharing, measured with eight threads incrementing counters packed into one cache line, and the 8.5x speedup from padding each counter to its own line.
sources:
  - title: What Every Programmer Should Know About Memory (Ulrich Drepper)
    url: https://www.akkadia.org/drepper/cpumemory.pdf
    type: paper
  - title: perf-c2c(1) manual page
    url: https://man7.org/linux/man-pages/man1/perf-c2c.1.html
    type: docs
---

False sharing is the coherence traffic that arises when threads on different cores write to distinct variables that reside in the same cache line. The coherence protocol operates on whole lines, so the cores contend for ownership of the line although no thread accesses another thread's data.

## Setup

The CPU model and compiler flags were not recorded with these results, so the results are marked needs-review. The runs use 8 threads and the same `./bench` harness as the other benchmarks in this directory. Cache lines are 64 bytes.

## Workload

Eight threads each increment their own counter in a shared array.

```c
uint64_t counters[8];  // All 64 bytes = 1 cache line!

void thread_n() {
    for (int i = 0; i < N; i++)
        counters[n]++;  // Writes to MY counter
}
```

Each thread owns a different element, and all eight elements fit in one 64-byte cache line. The padded version places each counter on its own line.

```c
struct {
    uint64_t count;
    char pad[56];  // Pad to 64 bytes
} counters[8];
```

## Results

The runs perform 16 MB of work in total, about 167M increments per thread.

| Variant | Total time | ns/op | Speedup |
|---------|------------|-------|---------|
| `fs_bad` (packed) | 57.8 ms | 0.34 ns | 1.0x |
| `fs_good` (padded) | 6.8 ms | 0.04 ns | 8.5x |

## Interpretation

The packed version is slower because of the coherence protocol. Under MESI, a core must hold a line in Modified state to write it. When thread 0 writes `counters[0]`, its core takes the line in Modified state. Thread 1 then writes `counters[1]`, which forces an invalidation of core 0's copy before core 1 can proceed. Thread 0 writes again and invalidates core 1. The line moves back and forth between cores for the entire run, and every increment waits for a cross-core ownership transfer. Drepper covers the protocol and this case in [What Every Programmer Should Know About Memory](https://www.akkadia.org/drepper/cpumemory.pdf).

The padded version gives each core a line that no other core accesses. No coherence traffic arises, and each increment runs at the speed of a register operation and an L1 access. The 8.5x difference is therefore due entirely to ownership transfers.

False sharing occurs in real code wherever per-thread data is packed into one allocation. Common cases are per-thread counters in a global stats array, several locks placed adjacently in a struct, and queue head and tail pointers that different threads update.

## Detection

`perf c2c` samples cache-to-cache transfers and reports lines contended across cores (see the [perf-c2c manual page](https://man7.org/linux/man-pages/man1/perf-c2c.1.html)):

```bash
perf c2c record ./bench fs_bad 16
perf c2c report
```

Look for the shared data cache line events and high snoop counts.

## Fixes

The remedies are to pad frequently written per-thread fields to a cache line boundary, to align them with `__attribute__((aligned(64)))`, or to move them into thread-local storage with `thread_local` so that they never share an allocation.

## Reproduction

```bash
./bench fs_bad 16   # False sharing (packed)
./bench fs_good 16  # No false sharing (padded)
```

## Sources

- [What Every Programmer Should Know About Memory (Drepper)](https://www.akkadia.org/drepper/cpumemory.pdf)
- [perf-c2c(1) manual page](https://man7.org/linux/man-pages/man1/perf-c2c.1.html)

## Related notes

- [[systems/operating-systems/benchmarks/reductions|parallel reductions]]
- [[systems/operating-systems/benchmarks/bandwidth|memory bandwidth]]
- [[systems/performance/streaming_benchmarks/cache_line_efficiency/README|cache line efficiency]]
