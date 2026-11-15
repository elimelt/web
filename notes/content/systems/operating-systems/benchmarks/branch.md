---
title: "Branch Misprediction Penalty: Sorted vs Random vs Branchless"
aliases:
  - operating-systems/benchmarks/branch
category: Performance Engineering
tags:
  - branch-prediction
  - cpu
  - pipeline
  - branchless
  - performance
  - benchmarks
date: 2025-12-29
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: needs-review
description: A C benchmark of branch misprediction cost, in which an unpredictable branch is 3.2x slower than a sorted one, about 11 cycles per miss, and a branchless mask falls between the two.
sources:
  - title: The microarchitecture of Intel, AMD and VIA CPUs (Agner Fog)
    url: https://www.agner.org/optimize/microarchitecture.pdf
    type: docs
---

A branch misprediction occurs when a CPU's branch predictor guesses the outcome of a conditional branch incorrectly. Modern CPUs speculatively execute past branches before the outcome is known, and a misprediction forces a pipeline flush, a penalty that Agner Fog's [microarchitecture manual](https://www.agner.org/optimize/microarchitecture.pdf) puts in the tens of cycles for recent Intel and AMD cores. The benchmark measures this penalty by running the same branch on predictable and unpredictable data.

## Setup

The CPU model and compiler flags were not recorded with these results, so the results are marked needs-review. The cycle conversions assume a 3 GHz clock. The runs use the same `./bench` harness as the other benchmarks in this directory.

## Workload

The workload conditionally sums the elements of a 64 MB array.

```c
for (size_t i = 0; i < n; i++) {
    if (array[i] < threshold)
        sum += array[i];
}
```

Three variants differ in the predictability of the branch.

- `br_sort`: first half of the array below the threshold, second half above. The predictor learns this immediately.
- `br_rand`: each element is below the threshold with 50% probability. The predictor mispredicts about half the time.
- `br_less`: branchless, using a mask instead of a branch.

## Results

| Variant | ns/element | vs sorted |
|---------|------------|-----------|
| `br_sort` (sorted) | 0.85 ns | 1.0x |
| `br_less` (branchless) | 1.41 ns | 1.7x |
| `br_rand` (random) | 2.75 ns | 3.2x |

## Interpretation

The random variant takes 2.75 - 0.85 = 1.9 ns more per element. Only about half the elements mispredict, so each misprediction costs roughly 3.8 ns, or about 11 cycles at 3 GHz. This is at the low end of published flush penalties, consistent with the out-of-order core overlapping some of the recovery with other work.

The branchless variant replaces the branch with arithmetic:

```c
uint64_t mask = -(array[i] < threshold);  // 0 or 0xFFFFFFFFFFFFFFFF
sum += array[i] & mask;
```

It executes more instructions per element, so it is slower than the well-predicted branch (1.41 ns vs 0.85 ns). It is 1.95x faster than the mispredicted branch (1.41 ns vs 2.75 ns) because its cost does not depend on the data. The measurements imply a rule of thumb: a branch is preferable when the data has a pattern the predictor can learn, and a branchless form when the data is effectively random, as with hashed keys. When neither case clearly applies, profiling determines the choice.

In reproductions, GCC and Clang at `-O3` sometimes convert branches to conditional moves (`cmov`), which erases the difference between the branchy and branchless variants. Check the generated assembly if the numbers look flat.

On the hardware side, predictors track the history of each branch and the recent outcomes of all branches, and combine both. Agner Fog's [manual](https://www.agner.org/optimize/microarchitecture.pdf) describes the schemes used by each microarchitecture. These predictors can learn repeating patterns such as taken three times then not taken once. None of them can predict uniformly random outcomes, the property on which `br_rand` relies.

## Reproduction

```bash
./bench br_sort 64   # Predictable (sorted)
./bench br_rand 64   # Unpredictable (random)
./bench br_less 64   # Branchless (mask)
```

## Sources

- [The microarchitecture of Intel, AMD and VIA CPUs (Agner Fog)](https://www.agner.org/optimize/microarchitecture.pdf)

## Related notes

- [[systems/operating-systems/benchmarks/store_fwd|store-to-load forwarding]]
- [[systems/operating-systems/benchmarks/prefetch|software prefetching]]
- [[systems/performance/streaming_benchmarks/cache_line_efficiency/README|Cache Line Efficiency Benchmark]]
- [[systems/operating-systems/benchmarks/reductions|Parallel Reductions Benchmarks]]
- [[hardware/computer-architecture/rtl-reading-lab|Open-Source CPU RTL Reading Lab]]
