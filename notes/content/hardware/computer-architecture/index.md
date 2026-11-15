---
title: Computer Architecture
category: Computer Architecture
tags:
  - computer-architecture
  - microarchitecture
  - isa
  - rtl
  - benchmarking
date: 2026-08-01
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: draft
description: An index of the computer architecture notes, organized as a graph of questions and experiments instead of a linear course sequence, spanning ISA/datapath, pipelining, and out-of-order execution.
sources:
  - title: The RISC-V Instruction Set Manual, Volume I - Unprivileged ISA
    url: https://riscv.github.io/riscv-isa-manual/snapshot/spec/
    type: docs
  - title: CVA6 (openhwgroup/cva6)
    url: https://github.com/openhwgroup/cva6
    type: source
  - title: riscv-boom (riscv-boom/riscv-boom)
    url: https://github.com/riscv-boom/riscv-boom
    type: source
---

Computer architecture studies the layers through which a program is executed by hardware. A program is
written against an ISA (an abstract contract of registers, memory, and instructions), the ISA is
implemented by a microarchitecture (pipelines, caches, predictors, out-of-order machinery), the
microarchitecture is described in RTL (SystemVerilog, Chisel), and RTL is converted to gates by
synthesis. Measurement proceeds in the opposite direction: benchmarks and hardware counters on real
silicon supply the observations that the architectural model must explain.

The notes cover a university-level Computer Architecture I/II curriculum and are organized as a graph
of questions and experiments instead of a sequence to be read in order. Each linked note is
self-contained and consists of a derivation, a reading of real source, or a measured benchmark. The
entry points correspond to a performance symptom, an RTL question, or an ISA detail.

## Entry points

- **Performance symptoms** (a benchmark is slower than expected): the
  [[systems/operating-systems/benchmarks/branch|branch misprediction]],
  [[systems/operating-systems/benchmarks/mlp|memory-level parallelism]], and
  [[systems/operating-systems/benchmarks/store_fwd|store-to-load forwarding]] benchmarks, whose "why"
  links lead into [[hardware/computer-architecture/pipelining-hazards-branch-prediction|pipelining]] and
  [[hardware/computer-architecture/out-of-order-execution|out-of-order execution]].
- **ISA questions** (what an instruction encodes, how a load executes):
  [[hardware/computer-architecture/isa-datapath-control|ISA, datapath, and control]].
- **RTL modules** (a decoder, a BTB, a reorder buffer): the three narrative notes pin real source
  snippets to commits from [CVA6](https://github.com/openhwgroup/cva6),
  [Rocket Chip](https://github.com/chipsalliance/rocket-chip), and [BOOM](https://github.com/riscv-boom/riscv-boom),
  which connects each mechanism to an implementation.
- **Multicore anomalies**: the load/store queue and memory disambiguation discussion in
  [[hardware/computer-architecture/out-of-order-execution|out-of-order execution]] is the single-core
  prerequisite for coherence and consistency questions.

## The three narrative branches

| Note | Type | What it answers |
|---|---|---|
| [[hardware/computer-architecture/isa-datapath-control\|ISA, datapath, and control]] | Narrative + source reading | How does RV32I encoding become a working single-cycle/multicycle processor? |
| [[hardware/computer-architecture/pipelining-hazards-branch-prediction\|Pipelining, hazards, and branch prediction]] | Narrative + source reading + benchmark | Why does overlapping instructions require forwarding, stalls, and speculation, and what does a misprediction actually cost? |
| [[hardware/computer-architecture/out-of-order-execution\|Out-of-order and superscalar execution]] | Narrative + source reading + benchmark | How do real cores extract ILP beyond in-order issue, and why do the MLP/reduction benchmarks look the way they do? |

Each note first derives its mechanism from first principles, in the order a course would, and then
grounds the mechanism in real RTL (a specific file, pinned to a commit SHA) and, where the mechanism is
directly measurable, in an existing benchmark note.

## Coverage matrix

The table maps the notes onto typical Computer Architecture I/II course outcomes.

| Course outcome | Covered by | Evidence type |
|---|---|---|
| Instruction encoding and decoding | [[hardware/computer-architecture/isa-datapath-control\|ISA note]] | Derivation + CVA6 decoder source |
| Single-cycle / multicycle datapath design | [[hardware/computer-architecture/isa-datapath-control\|ISA note]] | Derivation + CVA6 register file source |
| CPI and clock period tradeoffs | [[hardware/computer-architecture/isa-datapath-control\|ISA note]], [[hardware/computer-architecture/pipelining-hazards-branch-prediction\|pipelining note]] | Derivation + worked CPI models |
| Pipeline hazards (structural, data, control) | [[hardware/computer-architecture/pipelining-hazards-branch-prediction\|pipelining note]] | Derivation |
| Forwarding and stall logic | [[hardware/computer-architecture/pipelining-hazards-branch-prediction\|pipelining note]] | Derivation |
| Branch prediction (BTB, RAS) | [[hardware/computer-architecture/pipelining-hazards-branch-prediction\|pipelining note]] | CVA6 BTB/RAS source + Agner Fog's measured penalties across microarchitectures |
| Branch misprediction cost, measured | [[systems/operating-systems/benchmarks/branch\|branch benchmark]] | Real-hardware measurement (~11 cycles/misprediction) |
| Tomasulo's algorithm, register renaming | [[hardware/computer-architecture/out-of-order-execution\|OoO note]] | Derivation + BOOM rename-maptable source |
| Reorder buffer, precise exceptions | [[hardware/computer-architecture/out-of-order-execution\|OoO note]] | Derivation + BOOM ROB source |
| Load/store queue, memory disambiguation | [[hardware/computer-architecture/out-of-order-execution\|OoO note]] | Derivation + Drepper's ordering discussion |
| ILP extraction, measured | [[systems/operating-systems/benchmarks/mlp\|MLP benchmark]], [[systems/operating-systems/benchmarks/reductions\|reductions benchmark]] | Real-hardware measurement |
| Store-to-load forwarding | [[systems/operating-systems/benchmarks/store_fwd\|store-forwarding benchmark]] | Real-hardware measurement |

The table does not map coherence, interconnects, vector/accelerator ISAs, or an RTL implementation lab
(a working RV32I core with a testbench).

## What's measured vs. simulated vs. inferred from source vs. conceptual

- **Measured on real hardware**: the [[systems/operating-systems/benchmarks/branch|branch]],
  [[systems/operating-systems/benchmarks/mlp|MLP]], and [[systems/operating-systems/benchmarks/store_fwd|store-forwarding]]
  benchmarks. These are measurements of one specific CPU, whose model is unrecorded (hence
  `needs-review`), and do not generalize to all out-of-order cores.
- **Inferred from source, not simulated or measured**: every RTL snippet pinned to a commit SHA (CVA6
  decoder/ALU/BTB/RAS, BOOM rename/ROB). These show *what a real implementation does*, not how fast it
  is; timing and area claims about them would require synthesis or simulation, which the notes do not
  yet include.
- **Purely conceptual / derived**: the CPI models, the hazard taxonomy, and Tomasulo's algorithm as
  presented are textbook derivations, cross-checked against source and measurement where a link exists
  but not independently re-derived from a simulator run.
- **Not yet present**: gem5/ChampSim simulation results, a from-scratch RV32I RTL build
  with its own testbench, and ISA extensions beyond RV32I (M/F/D/V, privileged spec).

## Sources

- [The RISC-V Instruction Set Manual, Volume I](https://riscv.github.io/riscv-isa-manual/snapshot/spec/)
- [CVA6 source](https://github.com/openhwgroup/cva6)
- [riscv-boom source](https://github.com/riscv-boom/riscv-boom)

## Related notes

- [[hardware/computer-architecture/isa-datapath-control|Instruction sets, datapaths, and control]]
- [[hardware/computer-architecture/pipelining-hazards-branch-prediction|Pipelining, hazards, and branch prediction]]
- [[hardware/computer-architecture/out-of-order-execution|Out-of-order and superscalar execution]]
- [[hardware/index|Hardware]]
- [[systems/operating-systems/benchmarks/README|Operating systems benchmarks]]
