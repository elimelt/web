---
title: Amdahl, Gustafson, and Scalability Limits
category: Performance Engineering
tags:
  - amdahl
  - gustafson
  - scalability
  - speedup
  - parallel performance
date: 2026-08-01
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: draft
description: The laws that bound parallel speedup, namely Amdahl's ceiling for a fixed problem, Gustafson's scaled-problem response, and the contention and coherency terms under which measured systems scale worse than either predicts, with computed tables.
sources:
  - title: Amdahl (1967), Validity of the Single Processor Approach
    url: https://dl.acm.org/doi/10.1145/1465482.1465560
    type: paper
  - title: Gustafson (1988), Reevaluating Amdahl's Law
    url: https://dl.acm.org/doi/10.1145/42411.42415
    type: paper
  - title: Brown (2000), Amdahl's Law and Parallel Speedup (USENIX ALS)
    url: https://www.usenix.org/legacy/publications/library/proceedings/als00/2000papers/papers/full_papers/brownrobert/brownrobert_html/node3.html
    type: paper
  - title: Gunther, The Universal Scalability Law
    url: http://www.perfdynamics.com/Manifesto/USLscalability.html
    type: docs
---

The speedup of a program on $N$ processors is the ratio of its execution time on one processor to its execution time on $N$. Amdahl's law bounds speedup for a fixed problem, Gustafson's law gives it for a problem that grows with $N$, and the Universal Scalability Law adds contention and coherency costs that grow with $N$. Together they make parallel-scaling claims falsifiable: given a measured speedup curve, they indicate whether the workload is limited by serial work, by communication, or by neither within the measured range.

The numeric tables are computed directly from the formulas (script run in the repo venv). The same models underlie measurements such as [[systems/operating-systems/benchmarks/reductions|the reductions benchmark]], which exhibits Amdahl-type serial limitation at small scale.

## Amdahl's law

For a fixed problem, let a fraction $p$ of the single-processor execution time parallelize perfectly and the remaining fraction $1-p$ not parallelize at all. On $N$ processors,

$$
S(N) = \frac{1}{(1-p) + p/N},
\qquad
\lim_{N \to \infty} S(N) = \frac{1}{1-p}.
$$

The parallel term shrinks in proportion to $1/N$ while the serial term stays constant, so the serial term dominates the denominator as $N$ grows:

| $p$ | $S(8)$ | $S(64)$ | $S(1024)$ | ceiling $1/(1-p)$ |
| --- | --- | --- | --- | --- |
| 0.50 | 1.78 | 1.97 | 2.00 | 2 |
| 0.90 | 4.71 | 8.77 | 9.91 | 10 |
| 0.95 | 5.93 | 15.42 | 19.64 | 20 |
| 0.99 | 7.48 | 39.26 | 91.18 | 100 |
| 0.999 | 7.94 | 60.21 | 506.18 | 1000 |

A program that is 95% parallel cannot exceed a speedup of 20, and at 64 cores it already reaches 15.42, about three quarters of that ceiling. [Amdahl's 1967 paper](https://dl.acm.org/doi/10.1145/1465482.1465560) contains no formula. It is a two-and-a-half-page argument against parallel machines, estimating that data-management housekeeping consumed about 40% of executed instructions and would not parallelize; the algebra was formalized by later commentators.

> [!warning] The ceiling is set entirely by the serial fraction
> For every processor count, speedup stays below $S(\infty) = 1/(1-p)$, so a serial share of 5% bounds speedup at 20x. Speedup also approaches the ceiling slowly. At $N = p/(1-p)$ processors (19 for $p = 0.95$) speedup is exactly *half* the ceiling, and the remaining factor of 2 is approached only as $N \to \infty$. Beyond that point, reducing $1-p$ is an alternative to adding hardware, and often the less costly one.

**The effective serial fraction.** The quantity $1-p$ includes every cost that does not shrink with $N$, of which code outside the parallel loop is only one part. It also includes lock acquisition and barriers, load imbalance (the barrier waits for the slowest worker), the fork/join and result-merge phases, and, on multicore processors in particular, shared memory bandwidth. A saturated memory bus has the same effect as serial work; for a bandwidth-bound kernel, speedup is bounded by (aggregate bandwidth) / (single-core bandwidth demand) regardless of the number of cores. When a measured curve flattens earlier than the code's structure predicts, one of these components contributes to the effective serial fraction, and fitting $1/((1-p)+p/N)$ to the measurements estimates its size.

## Gustafson's law

[Gustafson (1988)](https://dl.acm.org/doi/10.1145/42411.42415) rejected the fixed-problem assumption, arguing that a 1024-node machine is in practice used to run a problem sized for 1024 nodes. His formulation fixes the execution *time* instead, lets the parallel work grow with $N$, and measures how much more work is completed. If the scaled run spends fraction $s = 1 - p'$ of its time in serial work, the same job on one processor would have taken $s + p'N$, so the scaled speedup is

$$
S(N) = s + p'N = N - (1-p')(N-1),
$$

which is linear in $N$ with slope $p'$ and has no upper bound. With $p' = 0.99$ and $N = 1024$ the scaled speedup is 1014x, against 91x from Amdahl's law for the same fractions. Gustafson's team at Sandia reported scaled speedups of 1016-1021x on a 1024-processor hypercube for three applications, results that were widely cited against the view that Amdahl's law made large-scale parallelism futile.

The two laws answer different questions and do not contradict each other. **Strong scaling** (Amdahl) holds the problem fixed and adds processors to reduce latency; it applies when external requirements fix the problem size, as when serving one request faster. **Weak scaling** (Gustafson) grows the problem in proportion to the processor count at constant wall-clock time; it applies to batch and simulation workloads in which fidelity or dataset size grows to use the available capacity. Applying the wrong model misestimates in either direction. Weak-scaling numbers quoted for a latency problem overstate the benefit of additional hardware, and Amdahl's law applied to a throughput problem understates it.

## Where both laws are too optimistic

Both laws assume that coordinating the parallel fraction has no cost. Add an overhead term $T_o(N)$ that *grows* with $N$ ([Brown 2000](https://www.usenix.org/legacy/publications/library/proceedings/als00/2000papers/papers/full_papers/brownrobert/brownrobert_html/node3.html)):

$$
S(N) = \frac{T_s + T_p}{T_s + T_o(N) + T_p/N}.
$$

If $T_o$ is all-to-all communication, $T_o \propto N^2$ per step and the curve peaks at finite $N$, then declines. Gunther's [Universal Scalability Law](http://www.perfdynamics.com/Manifesto/USLscalability.html) expresses this with two parameters fitted to measurements:

$$
S(N) = \frac{N}{1 + \sigma(N-1) + \kappa N(N-1)},
$$

where $\sigma$ is contention (queueing for a shared resource; $\kappa = 0$ reduces the model to Amdahl's shape) and $\kappa$ is coherency (the pairwise cost of keeping $N$ parties consistent, such as cache-line ping-pong, lock handoffs and consensus messages, which accounts for the factor $N(N-1)$). The $\kappa$ term models a behavior that neither Amdahl's nor Gustafson's law can express, **retrograde scaling**, in which throughput falls as capacity is added, with the peak at $N_{opt} = \sqrt{(1-\sigma)/\kappa}$. Computed example with $\sigma = 0.02$, $\kappa = 10^{-4}$:

| $N$ | 8 | 32 | 64 | 99 | 200 | 350 |
| --- | --- | --- | --- | --- | --- | --- |
| $S(N)$ | 7.0 | 18.6 | 24.0 | **25.2** | 22.3 | 17.3 |

Speedup peaks at 25.2x at $N_{opt} = \sqrt{0.98/10^{-4}} \approx 99$, and 350 processors are 30% *slower* than 99. In practice the model is fitted to a measured scaling curve. The fitted $\sigma$ quantifies serialization, a nonzero $\kappa$ quantifies coherency cost, and $N_{opt}$ gives the processor count beyond which added hardware reduces throughput.

```python
import numpy as np

def amdahl(p, N):    return 1 / ((1 - p) + p / N)
def gustafson(p, N): return N - (1 - p) * (N - 1)
def usl(N, sigma, kappa):
    return N / (1 + sigma * (N - 1) + kappa * N * (N - 1))

N = np.array([8, 32, 64, 99, 200, 350])
print(np.round(amdahl(0.95, N), 2))       # [ 5.93 12.55 15.42 16.78 18.26 18.97]
print(np.round(usl(N, 0.02, 1e-4), 1))    # [ 7.  18.6 24.  25.2 22.3 17.3]
```

In the two printed rows, the Amdahl curve with $p = 0.95$ increases monotonically toward its ceiling of 20, while the USL curve with a small $\kappa$ reaches a maximum and then declines.

## Using the laws

- **Estimate before parallelizing.** Measuring the serial share first bounds the attainable speedup. If 20% of runtime cannot be parallelized, the ceiling is 5x, and reducing that 20% yields more than a port to 64 cores.
- **Diagnose from the curve's shape.** A curve that flattens toward an asymptote indicates Amdahl-type serialization ($\sigma$). A peak followed by a decline indicates coherency cost ($\kappa$); additional parallelism then lowers throughput, and the remedy is to reduce sharing (partitioning, per-core state, batching updates) rather than to tune the parallel code.
- **State which scaling regime a benchmark ran.** "Linear to 1024 nodes" under weak scaling and under strong scaling are claims of very different strength, and a published speedup cannot be interpreted without this label.
- **Watch the denominator.** Speedup should be measured against the best *serial* implementation. A parallel program that scales well relative to its own single-threaded mode may still be slower than tuned serial code, and Amdahl-type arguments implicitly assume that the $N=1$ baseline is efficient.

The queueing view of the same saturation, in which latency rather than throughput is examined as load approaches capacity, is treated in [[systems/performance/latency-throughput-and-utilization|Latency, Throughput, and Utilization]] and [[systems/operating-systems/v2-concurrency/7-queueing-theory|Queueing Theory]].

## Sources

- [Amdahl (1967), Validity of the Single Processor Approach to Achieving Large Scale Computing Capabilities](https://dl.acm.org/doi/10.1145/1465482.1465560)
- [Gustafson (1988), Reevaluating Amdahl's Law, CACM 31(5)](https://dl.acm.org/doi/10.1145/42411.42415)
- [Brown (2000), Amdahl's Law and Parallel Speedup, USENIX ALS](https://www.usenix.org/legacy/publications/library/proceedings/als00/2000papers/papers/full_papers/brownrobert/brownrobert_html/node3.html)
- [Gunther, USL Scalability Manifesto](http://www.perfdynamics.com/Manifesto/USLscalability.html)

## Related notes

- [[systems/performance/latency-throughput-and-utilization|Latency, Throughput, and Utilization]]
- [[systems/operating-systems/v2-concurrency/7-queueing-theory|Queueing Theory]]
- [[systems/performance/streaming|Streaming Data]]
- [[systems/operating-systems/benchmarks/reductions|Reductions Benchmark]]
