---
title: Measuring Real DRAM Latency
aliases:
  - operating-systems/benchmarks/README
category: Performance Engineering
tags:
  - memory
  - dram
  - sram
  - cache
  - latency
  - benchmarks
  - pointer-chasing
  - memory-hierarchy
date: 2025-12-29
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: needs-review
description: Serial DRAM latency measured with a pointer-chasing benchmark, the memory-level parallelism that causes strided benchmarks to understate it, and the SRAM and DRAM circuit behavior that determines access latency.
sources:
  - title: What Every Programmer Should Know About Memory (Ulrich Drepper)
    url: https://www.akkadia.org/drepper/cpumemory.pdf
    type: paper
---

DRAM latency is the time from issuing a load to receiving its value when the data resides in none of the CPU's caches and must be read from main memory. The latency of a load such as `int x = array[i]` in C depends on the level of the memory hierarchy that holds the data, and a DRAM access takes orders of magnitude longer than a hit in the CPU's SRAM caches.

A benchmark that issues independent loads understates DRAM latency, because the processor overlaps the loads. A pointer-chasing benchmark, in which each load depends on the result of the previous one, measures serial DRAM latency, and on my machine it gives the figures in [Results](#results).

## Setup

The machine is an Intel i9-13900HK with 96 GB RAM, a 25 MB L3 cache and 64-byte cache lines. The compiler and flags were not recorded with these results, and for that reason the results are marked needs-review. Approximate latencies and sizes for this system are as follows.

- L1 cache: ~1-4 ns, 48 KB
- L2 cache: ~10-20 ns, 1.3 MB
- L3 cache: ~20-40 ns, 25 MB
- DRAM: ~60-100 ns, 96 GB

The first three levels are SRAM, static RAM. SRAM operates on different physical principles from DRAM, and the difference accounts for most of the latency gap.

## SRAM

SRAM is built from ordinary digital logic. A basic 6T-SRAM cell uses 6 transistors arranged as cross-coupled inverters. An inverter is a logic gate that outputs the inverse of its input, and cross-coupled means each inverter's output feeds the other's input, which creates a bistable circuit that holds its state.

```text
    VDD
     |
  |--+--|  Cross-coupled
  |     |  inverters (bistable)
--+     +--
  |     |
  |--+--|
     |
    GND

Access transistors connect to bit lines
```

In Verilog, such a memory is described as follows.

```verilog
module sram #(
    parameter ADDR_WIDTH = 10,  // 1024 words
    parameter DATA_WIDTH = 32
)(
    input wire clk,
    input wire [ADDR_WIDTH-1:0] addr,
    output reg [DATA_WIDTH-1:0] data
);
    reg [DATA_WIDTH-1:0] mem [0:(1<<ADDR_WIDTH)-1];

    always @(posedge clk) begin
        data <= mem[addr];
    end
endmodule
```

Physically, this synthesizes to decoder logic that activates one of 1024 word lines, a memory array of 1024 rows x 32 bits of six-transistor cells, sense amplifiers that detect voltage on the bit lines and amplify it to logic levels, and output drivers for the data bus.

SRAM is static. As long as power is on, the cross-coupled inverters hold their state. Access time is around 0.3-1 ns because a read consists only of transistor switching. Each bit requires six transistors, so SRAM occupies far more die area per bit than DRAM, which limits the L1 cache on my machine to 48 KB.

## DRAM

DRAM stores each bit as charge on a capacitor. A DRAM cell is one transistor plus one capacitor (1T1C):

```text
    Bit Line (vertical metal trace)
       |
       |
    [===]  <- Capacitor (tens of femtofarads)
       |
    --+--  <- NMOS access transistor
       |
    Word Line (horizontal polysilicon)
```

Where SRAM is digital, DRAM reads are an analog operation. The capacitor holds a voltage, and capacitors leak charge over time according to their RC time constants. This leakage makes DRAM dynamic; without a refresh roughly every 64 ms, the stored data is lost. Drepper's [What Every Programmer Should Know About Memory](https://www.akkadia.org/drepper/cpumemory.pdf) covers the cell design and refresh mechanics in depth.

At the level of detail needed to reason about performance, rather than at the circuit level, a DRAM read proceeds in five steps.

1. Precharge the bit line
2. Activate the word line (open the access transistor)
3. The capacitor connects to the bit line
4. Charge redistributes between the tiny cell capacitor and the much larger bit line capacitance
5. The result is a tiny voltage swing on the bit line, on the order of 100-200 mV

A sense amplifier, a differential analog circuit, detects this small swing and amplifies it to full logic levels. The sense amplifier also latches the amplified value into the row buffer.

## The row buffer

DRAM cells are arranged in a 2D array, and access happens in two steps:

```text
Step 1: RAS (Row Address Strobe)
  - Activate word line
  - All ~1024-8192 cells in that row dump charge onto bit lines
  - Sense amps detect, amplify, and latch values
  - Row buffer now holds the entire row (~1-8 KB)

Step 2: CAS (Column Address Strobe)
  - Select specific column(s) from row buffer
  - Drive data onto output bus
```

The row buffer is real hardware, a set of SRAM-like latches, one per column. Once a row is open, accesses to different columns in that row take about 10-15 ns, because they read only the latches.

An access to a closed row requires three operations. Precharge closes the current row (~15 ns), RAS opens the new row and waits for sensing (~15 ns), then CAS performs the column access (~10 ns). The full row operation therefore takes about 40-50 ns, against 10-15 ns when the row is already open and only the CAS is needed.

## Physical constraints

Two physical effects dominate DRAM access latency.

The first is wire delay. Signals travel at roughly 2/3 the speed of light in a conductor. On a 3 GHz CPU, light in vacuum covers about 10 cm per clock cycle, and the DRAM chips sit several centimeters from the CPU over motherboard traces. The round-trip signal propagation alone is on the order of 5-10 ns.

The second is capacitor charging. The cell capacitor is small and takes time to charge and discharge. In addition, activating a word line connects every cell in the row, thousands of capacitors, to bit lines at once, and all of the sense amplifiers must stabilize before the data is valid. The settling time was not estimated.

## First attempt, and why it failed

I wrote a simple benchmark to compare sequential and strided access:

```c
// Sequential access
for (size_t i = 0; i < n; i++) {
    sum += array[i];
}

// Strided access (every 1024th element)
for (size_t i = 0; i < n; i += 1024) {
    sum += array[i];
}
```

On a 64 MB array, larger than the 25 MB L3, the results were:

```text
Sequential:  1.50 ns/access
Stride 1024: 13.18 ns/access
```

Both numbers are implausibly low for DRAM. The `perf` counters showed that most of the strided loads missed in L3:

```text
LLC-load-misses: 80.52% of all L3 accesses
```

The loads therefore reached DRAM, yet each appeared to take only 13 ns. The true latency was hidden by memory-level parallelism (MLP). The loop issues its loads as follows.

```c
sum += array[i];      // Load request sent
sum += array[i+1024]; // Another load sent before first completes
// ... multiple loads in flight ...
```

The loads are independent. No load requires the result of another before it can be issued, so the load/store unit keeps a queue of outstanding requests and can hold around 10-12 loads in flight at once. If each DRAM access takes 100 ns but 10 are in flight, results arrive every 10 ns on average. The effect is pipelining applied to memory requests. I measure this effect directly in [[systems/operating-systems/benchmarks/mlp|memory-level parallelism]].

## Pointer chasing

To measure true serial latency, each load must depend on the previous one. Pointer chasing enforces this dependency. The array is arranged as a linked list in which each element holds the index of the next, in randomized order.

```c
// Setup: create randomized pointer chain
// array[i] contains the index of the next element
for (size_t i = 0; i < n - 1; i++) {
    array[indices[i]] = indices[i + 1];
}

// Chase pointers - each load depends on the previous
size_t index = 0;
for (size_t i = 0; i < n; i++) {
    index = array[index];  // Must wait for this load
}
```

The CPU cannot issue the load of `array[index]` until the value of `index` is available. Every load carries a true data dependency on the previous one, so no two loads overlap.

## Results

The three benchmarks were run on a 4 GB array, far larger than the caches.

| Benchmark | ns/access | LLC Misses | Explanation |
|-----------|-----------|------------|-------------|
| Sequential | 1.35 | 98% | Hardware prefetcher brings data into cache before needed |
| Random (parallel) | 7.90 | 99% | Hitting DRAM but MLP hides latency (~10 loads in flight) |
| Pointer Chase | 97.40 | 99% | True serial DRAM latency, no parallelism possible |

## Why sequential is so fast

The hardware prefetcher detects the stride-1 pattern and speculatively fetches cache lines ahead of the program. The `perf` counts show the effect.

```text
Sequential:    1.3M LLC loads    (for 537M accesses)
Random:        1.07B LLC loads   (for 537M accesses)
```

With sequential access, only about 0.2% of accesses ever reach L3. The prefetcher pulls lines into L1 and L2 before the load instruction executes. Each 64-byte [[systems/performance/streaming_benchmarks/cache_line_efficiency/README|cache line]] covers 8 adjacent `uint64_t` values, and the prefetcher tracks multiple concurrent streams with strides up to a few KB.

## Reading the 97 ns number

The 97 ns figure is probably an average across row buffer hits and misses. A row buffer hit might land around 50-60 ns end to end, while a miss that has to precharge the old row and activate a new one could run 100-120 ns. Random pointer chasing hits a mix of both, and the memory controller can't optimize for row locality when it can't predict the access pattern. Separating the two cases would require further benchmarks.

## Reproduction

```bash
make
./run_benchmarks.sh 4096  # 4096 MB array
```

## Sources

- [What Every Programmer Should Know About Memory (Drepper)](https://www.akkadia.org/drepper/cpumemory.pdf)

## Related notes

- [[systems/operating-systems/benchmarks/mlp|memory-level parallelism]]
- [[systems/operating-systems/benchmarks/bandwidth|memory bandwidth]]
- [[systems/operating-systems/benchmarks/tlb|TLB and page walks]]
- [[systems/performance/streaming_benchmarks/cache_line_efficiency/README|Cache Line Efficiency Benchmark]]
- [[systems/performance/streaming|Streaming Data]]
- [[hardware/computer-architecture/experiments-and-benchmarking|Experiments and Benchmarking in Computer Architecture]]
