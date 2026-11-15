---
title: Hardware
category: Hardware
tags:
  - hardware
  - digital design
  - timing
  - signals
  - computer-architecture
date: 2026-07-31
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: Index of the hardware notes on digital design, signal conditioning (lecture notes), computer architecture and GPU architecture.
sources:
  - title: The RISC-V Instruction Set Manual
    url: https://riscv.github.io/riscv-isa-manual/snapshot/spec/
    type: spec
  - title: NVIDIA Hopper Architecture
    url: https://www.nvidia.com/en-us/data-center/technologies/hopper-architecture/
    type: docs
---

The hardware section concerns the design of digital and analog circuits and of the processors built from them. It has four tracks. [[hardware/digital-design/369/combinational-logic|Digital design]] covers logic, state, timing, and HDL workflow. [[hardware/signal-conditioning/lecture-notes/lecture-1|Signal conditioning]] covers the analog side. [[hardware/computer-architecture/index|Computer architecture]] covers the stack from ISA through microarchitecture to RTL that is built on digital design. [[hardware/gpu-architecture|GPU architecture]] applies the same digital design primitives to a large-scale parallel processor.

The tracks are separated because their constraints differ. Digital design concerns discrete state, timing closure, and implementation. Signal conditioning concerns the shaping of physical signals before a digital system can use them reliably. Computer architecture concerns the abstractions (ISA, pipeline, out-of-order execution) through which digital design produces a target for compilers. GPU architecture concerns the replication and specialization of the same digital logic at large scale to exploit data parallelism.

## Sections

- Digital design: [[hardware/digital-design/369/combinational-logic|combinational logic]], [[hardware/digital-design/369/sequential-logic|sequential logic]], [[hardware/digital-design/371/static-timing-analysis|static timing analysis]]
- Signal conditioning: [[hardware/signal-conditioning/lecture-notes/lecture-1|lecture 1]], [[hardware/signal-conditioning/lecture-notes/lecture-2|lecture 2]], [[hardware/signal-conditioning/lecture-notes/lecture-3|lecture 3]]
- Computer architecture: [[hardware/computer-architecture/index|map]], [[hardware/computer-architecture/isa-datapath-control|ISA/datapath/control]], [[hardware/computer-architecture/pipelining-hazards-branch-prediction|pipelining and hazards]], [[hardware/computer-architecture/out-of-order-execution|out-of-order execution]], [[hardware/computer-architecture/simd-vectors-gpus-accelerators|SIMD to SIMT]], [[hardware/computer-architecture/rtl-reading-lab|RTL reading lab]], [[hardware/computer-architecture/experiments-and-benchmarking|experiments and benchmarking]]
- GPU architecture: [[hardware/gpu-architecture|GPU Architecture from First Principles]], building SIMT execution up from clocked RTL primitives
