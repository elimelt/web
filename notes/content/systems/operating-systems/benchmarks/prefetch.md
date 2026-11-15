---
title: "Software Prefetching Benchmark: __builtin_prefetch vs Hardware"
aliases:
  - operating-systems/benchmarks/prefetch
category: Performance Engineering
tags:
  - prefetching
  - cache
  - memory-latency
  - hardware-prefetcher
  - performance
  - benchmarks
date: 2025-12-29
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: needs-review
description: A C benchmark of GCC __builtin_prefetch, in which prefetching 64 elements ahead makes sequential reads 2.5x faster than with the hardware prefetcher alone, and prefetching 32 to 128 elements ahead makes random reads about 1.3x faster.
sources:
  - title: GCC documentation for __builtin_prefetch
    url: https://gcc.gnu.org/onlinedocs/gcc/Other-Builtins.html
    type: docs
---

Software prefetching is the insertion of explicit prefetch instructions that request a cache line before the program loads from it. Hardware prefetchers detect sequential and strided patterns and fetch ahead without software involvement, and they do not help random patterns. Software prefetching can cover the random case whenever future addresses are computable, and in these measurements it also outperforms the hardware prefetcher on sequential access.

## Setup

The CPU model and compiler flags were not recorded with these results, so the results are marked needs-review. The runs use a 256 MB array and the same `./bench` harness as the other benchmarks in this directory. The DRAM latency assumed in the analysis (~75 to 100 ns) comes from the pointer-chase measurement in [[systems/operating-systems/benchmarks/README|measuring real DRAM latency]].

## Workload

The software prefetch is GCC's builtin ([docs](https://gcc.gnu.org/onlinedocs/gcc/Other-Builtins.html)):

```c
__builtin_prefetch(&array[i + 64], 0, 0);  // Prefetch 64 elements ahead
sum += array[i];                            // Use current element
```

The signature is `__builtin_prefetch(addr, rw, locality)` where `rw` is 0 for read and 1 for write, and `locality` runs from 0 (no temporal locality) to 3 (high). On x86 it compiles to `prefetchnta` or `prefetcht0/t1/t2`.

The random variants walk a precomputed index array, prefetching `array[indices[i+N]]` while processing `array[indices[i]]`. The sequential variants stream through the array with and without an explicit prefetch at distance +64 elements.

## Results

Random access:

| Variant | Distance | ns/access | vs baseline |
|---------|----------|-----------|-------------|
| `pf_none` | 0 | 7.61 ns | 1.0x |
| `pf_8` | +8 | 6.23 ns | 1.2x |
| `pf_32` | +32 | 5.91 ns | 1.3x |
| `pf_128` | +128 | 5.99 ns | 1.3x |

Sequential access:

| Variant | Distance | ns/access | vs baseline |
|---------|----------|-----------|-------------|
| `pf_seq` | 0 (hw only) | 1.37 ns | 1.0x |
| `pf_seq64` | +64 | 0.54 ns | 2.5x |

## Interpretation

For random access the improvement reaches at most about 25%. The indices are known ahead of time, so the prefetch addresses are computable, but the improvement remains small. The prefetch distance has to be long enough to cover the DRAM round trip, and the 7.6 ns baseline already reflects heavy memory-level parallelism (see [[systems/operating-systems/benchmarks/mlp|memory-level parallelism]]), so the run is close to bandwidth-bound before any prefetching happens. When bandwidth is the limit, a prefetch can at most even out the arrival times of the requests.

The sequential result was unexpected. The explicit prefetch at +64 elements (512 bytes, 8 cache lines ahead) is 2.5x faster than the hardware prefetcher alone. A plausible explanation is that the hardware prefetcher limits its prefetch distance to avoid polluting the cache when it has misidentified a pattern. The software prefetch is issued by code whose access pattern is known exactly, so a long prefetch distance carries no such risk and reduces the time per access.

Distance tuning depends on the memory latency, the work per iteration, and cache capacity. In these runs, +32 to +128 worked for random access and +64 worked for sequential. If the distance is too short, the data has not arrived when the load executes; if it is too long, the prefetched lines are evicted before use.

Prefetching cannot help a pointer chase, since `array[array[i]]` requires `array[i]` before the prefetch address is known. It is counterproductive for data already resident in cache, where the extra instructions are pure overhead, and in bandwidth-saturated loops, where the prefetches only add memory traffic.

## Reproduction

```bash
./bench pf_none 256   # Random baseline
./bench pf_32 256     # Random prefetch +32
./bench pf_seq 256    # Sequential hw prefetch only
./bench pf_seq64 256  # Sequential sw prefetch +64
```

## Sources

- [GCC documentation for __builtin_prefetch](https://gcc.gnu.org/onlinedocs/gcc/Other-Builtins.html)

## Related notes

- [[systems/operating-systems/benchmarks/mlp|memory-level parallelism]]
- [[systems/operating-systems/benchmarks/README|measuring real DRAM latency]]
- [[systems/performance/streaming_benchmarks/cache_line_efficiency/README|cache line efficiency]]
- [[systems/operating-systems/benchmarks/reductions|parallel reductions]]
- [[systems/operating-systems/benchmarks/tlb|TLB and page walks]]
