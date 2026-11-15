---
title: Profiling, Tracing, and Flame Graphs
category: Performance Engineering
tags:
  - profiling
  - tracing
  - flame graphs
  - observability
  - performance debugging
date: 2026-08-01
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: draft
description: Measurement of live systems beneath the performance models, covering metrics, profiling and tracing, sampling mechanics and overhead, the interpretation of flame graphs, a minimal perf workflow, and common measurement errors.
sources:
  - title: Gregg, Flame Graphs
    url: https://www.brendangregg.com/flamegraphs.html
    type: docs
  - title: Gregg (2016), The Flame Graph, ACM Queue
    url: https://queue.acm.org/detail.cfm?id=2927301
    type: paper
  - title: Gregg, Linux perf Examples
    url: https://www.brendangregg.com/perf.html
    type: docs
---

Performance measurement of a live system determines where its execution time is spent, and it connects analytic models such as [[systems/performance/latency-throughput-and-utilization|Latency, Throughput, and Utilization]] to observed behavior. Three families of tools answer different questions: metrics count events, profilers sample program state, and tracers record individual events. Applying the wrong family produces an accurate but uninformative result; a CPU profile of an I/O-bound program correctly reports that the program is idle.

## Three kinds of measurement

- **Metrics/counters** count events over an interval, such as CPU utilization, cache misses and requests per second. They have near-zero overhead, can remain enabled permanently, and are the appropriate starting point. Gregg's **USE method** structures the first pass. For every resource (CPU, memory, disk, NIC), Utilization, Saturation and Errors are checked before a profiler is used, so that the profile is directed at the resource that is the bottleneck.
- **Profiling** samples state at a fixed rate, typically the stack of the thread on-CPU at 99 Hz, and aggregates the samples. It is statistical, has low overhead and is safe in production. It answers the question of where the time goes.
- **Tracing** records every occurrence of chosen events, such as syscalls, scheduler switches and function calls, with timestamps. It is complete, but its cost scales with the event rate, and per-function tracing of a hot process can perturb the process enough to invalidate the measurement. It answers what happened and in what order, and it is required for latency outliers and rare events, which a sampler rarely captures.

Sampling and instrumentation trade overhead against completeness. Sampling at 99 Hz has a fixed cost of about 100 stack walks per second per CPU regardless of workload, whereas instrumenting every function call has a cost per *event*, which on a hot path can exceed the work of the function itself. The rate of 99 Hz is chosen deliberately. Sampling at exactly 100 Hz risks lockstep with timer-driven activity, which would sample the same code systematically and bias the profile, and an offset frequency decorrelates the two ([Gregg's perf page](https://www.brendangregg.com/perf.html) uses `-F 99` throughout).

## Flame graphs

A flame graph renders a set of sampled stacks so that visual area equals time ([Gregg 2016, ACM Queue](https://queue.acm.org/detail.cfm?id=2927301)). The layout follows four rules.

- Each box is a function present in some stacks; the y-axis is stack depth, callers below callees.
- Box **width** is the fraction of samples containing that frame, that is, the total time in the function and its callees.
- The **x-axis is alphabetical, not time**. Identical stacks merge regardless of when they occurred, and left-to-right order carries no temporal information.
- The **top edge** shows the function executing on-CPU when each sample was taken. The frames below it are its ancestors, which give the call path that led there.

> [!tip] Width is time share, not call order
> A frame's width is the fraction of samples in which it appears, which is the inclusive time of the frame and its callees. Left-to-right position is alphabetical and carries no temporal information, so a flame graph is not a timeline. Wide plateaus on the *top edge* mark code that consumes CPU itself, and the frames below them show how execution reached that code.

The widest box is not necessarily the most informative one. A wide frame near the bottom (`main`, an event loop) is only ancestry. The informative patterns are a wide *plateau along the top edge*, which is a function consuming CPU itself, and a wide frame whose children fan out into many narrow flames, which indicates that its descendants collectively dominate and that the remedy lies in the parent's call rate rather than in any one child. Flame graphs originated in Gregg's investigation of a MySQL CPU regression in which the top entry of `perf report` was a status command at about 3% of samples; the flame graph showed that the dominant cost was under `JOIN::exec`, and the eventual fix recovered 40% CPU. The interactive SVGs support click-to-zoom and search with a cumulative percentage readout, which removes the need to estimate widths by eye.

Common variants are **differential** flame graphs (color = change versus a baseline profile, for locating regressions), **off-CPU** flame graphs (which sample or trace *blocked* time instead of running time and so capture I/O, lock waits and scheduler delay), and the icicle (inverted) layout, which merges stacks from leaves instead of roots.

## A minimal workflow

System-wide CPU investigation on Linux with `perf` and the [FlameGraph scripts](https://www.brendangregg.com/flamegraphs.html):

```bash
perf stat -a -- sleep 10             # step 0: counters first - is this even
                                     #   a CPU problem? IPC, branch misses
perf record -F 99 -a -g -- sleep 30  # step 1: sample all CPUs at 99 Hz
                                     #   for 30 s, with call stacks
perf script | ./stackcollapse-perf.pl \
            | ./flamegraph.pl > cpu.svg   # step 2: fold and render
```

The counter summary from `perf stat` sets expectations before any profile is taken. Instructions per cycle near the machine's ceiling indicate compute-bound code, for which the flame graph identifies algorithmic cost. An IPC of 0.2 indicates stalls (memory, branches), and then the *widest frame is not where the fix is*, because the cycles are spent waiting inside it; the cache-miss counters of `perf stat -d` are the next measurement. For blocked time, the eBPF tools are the current approach. `profile(8)` samples on-CPU stacks in-kernel, and `offcputime(8)` aggregates off-CPU durations with stacks, and both produce the same folded-stack format.

Two prerequisites fail without an error. Stack walks require frame pointers, and most distros compile with `-fomit-frame-pointer`; the resulting profiles show implausibly shallow or fragmented stacks ("grass"). The remedies are rebuilding with `-fno-omit-frame-pointer`, or `--call-graph dwarf` / `--call-graph lbr` at record time. JIT runtimes (Java, Node) require symbol maps (`perf-map-agent`, `-XX:+PreserveFramePointer`), without which every frame is an anonymous address.

## Measurement traps

- **Observer effect.** Every tool has overhead, and tracing hot events can cost enough to change the behavior under study (Gregg measured ~9% throughput loss tracing scheduler events on a busy MySQL with perf, versus ~6% doing in-kernel aggregation with eBPF). Sampling is the appropriate first step, tracing should be applied narrowly, and the tool's effect on the metric of interest should itself be measured.
- **Wrong resource.** An on-CPU profile of a blocked program shows the idle path, which is accurate but uninformative. If utilization counters say the CPU is not the bottleneck, profile off-CPU time or the saturated device instead.
- **Cold start and warmup.** JIT compilation, cold caches, and unpopulated buffer pools dominate early samples. Profiles should cover steady state unless startup *is* the target, and benchmarks should warm up before the measured window.
- **Coordinated omission.** A load generator that waits for each response before sending the next omits the latency that would have been observed during stalls, so the benchmark under-samples exactly the periods in which the system performs worst. Fixed-schedule (open-loop) load generation and recording intended-start-to-completion latency avoid it. This is the measurement-side counterpart of the percentile arguments in [[systems/performance/tail-latency-percentiles|Tail Latency and Percentiles]].
- **Averaged mixtures.** A profile summed over day and night traffic, or over two request classes, can show a blend that no single request experiences, the same error as averaging latency distributions. Workloads that differ should be segmented before profiling.
- **Missing symbols and truncated stacks** produce incorrect pictures without reporting an error. A profile with unresolved frames or grass-like fragments indicates a tooling failure and should not be interpreted as data.

The benchmark suites under [[systems/operating-systems/benchmarks/README|the OS benchmarks]] are the controlled-environment counterpart of these tools; they use the same counters without the variability of production traffic.

## Related notes

- [[systems/performance/latency-throughput-and-utilization|Latency, Throughput, and Utilization]]
- [[systems/performance/tail-latency-percentiles|Tail Latency, Percentiles, and Queueing Distributions]]
- [[systems/operating-systems/benchmarks/README|OS Benchmarks]]
- [[ml/serving-systems/gpu-basics|GPU Basics]]

## Sources

- [Gregg, Flame Graphs](https://www.brendangregg.com/flamegraphs.html)
- [Gregg (2016), The Flame Graph, ACM Queue 14(2)](https://queue.acm.org/detail.cfm?id=2927301)
- [Gregg, Linux perf Examples](https://www.brendangregg.com/perf.html)
- [Gregg, Off-CPU Analysis](https://www.brendangregg.com/offcpuanalysis.html)
