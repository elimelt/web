---
title: Memory Bandwidth Benchmarks
aliases:
  - operating-systems/benchmarks/bandwidth
category: Performance Engineering
tags:
  - memory
  - bandwidth
  - multi-threading
  - numa
  - benchmarks
date: 2025-12-29
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: needs-review
description: Scaling of sequential-read memory bandwidth from one to eight threads, and the limit on outstanding cache misses that prevents a single core from saturating the memory controller.
sources:
  - title: What Every Programmer Should Know About Memory (Ulrich Drepper)
    url: https://www.akkadia.org/drepper/cpumemory.pdf
    type: paper
---

Memory bandwidth is the rate at which data moves between DRAM and the processor, here measured in GB/s for a sequential read by one to eight threads. A single core can track only a limited number of outstanding cache misses, so it stalls well before the memory controller reaches its capacity. Additional threads add outstanding requests, which lets the controller keep more DRAM banks and channels busy.

## Setup

The hardware, DIMM configuration, and compiler flags were not recorded alongside these results, and for that reason the results are marked needs-review. The runs use the same `./bench` harness as the other benchmarks in this directory. The DRAM latency measurements in [[systems/operating-systems/benchmarks/README|measuring real DRAM latency]] record the system used there.

## Workload

Each run reads a 1 GB array sequentially and sums every element.

```c
for (size_t i = 0; i < n; i++) {
    sum += array[i];
}
```

The thread count varies from 1 to 8. Each thread reads a disjoint chunk of the array, so there is no sharing and no synchronization inside the timed loop. The array is large enough that the working set never fits in cache.

## Results

| Threads | GB/s | vs 1 thread |
|---------|------|-------------|
| 1 | 24.9 | 1.0x |
| 2 | 44.1 | 1.8x |
| 4 | 47.8 | 1.9x |
| 8 | 63.7 | 2.6x |

## Interpretation

One thread reaches 24.9 GB/s. The core exhausts its miss-tracking resources before DRAM bandwidth is exhausted. Each core has a fixed number of Line Fill Buffers (Intel's name for the L1 miss registers, often called MSHRs elsewhere), and once they are all occupied the core cannot issue another cache miss. Prefetcher aggressiveness and per-core queue depth in the memory controller bound it further.

A second thread raises bandwidth by 1.8x, close to linear scaling. Beyond two threads the memory controller begins to saturate. Going from two to four threads adds about 8%, and four to eight adds another 1.3x, which suggests that the additional threads expose some bank- and channel-level parallelism that four threads did not.

For reference, peak DRAM bandwidth is channels times 8 bytes times the transfer rate. Dual-channel DDR4-3200 works out to 2 x 8 B x 3200 MT/s = 51.2 GB/s, and dual-channel DDR5-4800 to 76.8 GB/s. The 63.7 GB/s measured here at 8 threads sits in that range, but without the DIMM configuration the utilization for this machine cannot be computed. Achieved bandwidth is below the peak because row buffer misses, refresh cycles, and command overhead occupy bus time. Drepper's memory paper ([What Every Programmer Should Know About Memory](https://www.akkadia.org/drepper/cpumemory.pdf)) treats those overheads in detail.

On multi-socket machines, a thread reading from the other socket's memory incurs an interconnect hop, which raises latency and reduces bandwidth. These runs were on a single socket, so NUMA placement did not affect them.

## Reproduction

```bash
./bench bw_1 1024   # 1 thread
./bench bw_2 1024   # 2 threads
./bench bw_4 1024   # 4 threads
./bench bw_8 1024   # 8 threads
```

Use arrays of 1 GB or more so the run stays memory-bound instead of measuring cache bandwidth.

## Sources

- [What Every Programmer Should Know About Memory (Drepper)](https://www.akkadia.org/drepper/cpumemory.pdf)

## Related notes

- [[systems/operating-systems/benchmarks/README|measuring real DRAM latency]]
- [[systems/operating-systems/benchmarks/mlp|memory-level parallelism]]
- [[systems/operating-systems/benchmarks/reductions|parallel reductions]]
- [[systems/performance/streaming_benchmarks/cache_line_efficiency/README|Cache Line Efficiency Benchmark]]
