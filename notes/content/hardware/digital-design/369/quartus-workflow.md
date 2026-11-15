---
title: Developing FPGA Designs with Quartus and ModelSim
aliases:
  - hardware-design/369/quartus-workflow
category: Hardware Design
tags:
  - quartus
  - modelsim
  - verilog
  - testing process
  - modular design
date: 2024-02-25
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: A module-by-module workflow for building and simulating FPGA designs in Quartus and ModelSim, and the debugging benefit of testing each unit before integration.
sources:
  - title: UW CSE 369 lab material
    type: lecture
---

FPGA development in Quartus and ModelSim proceeds module by module. Each module is written with its own test bench and verified in simulation before it is instantiated in a larger design.

The procedure is the one I use for the CSE 369 FPGA labs.

## Setup

Make a copy of a previous lab directory and build from it. The copy retains the Quartus project file and the ModelSim files, and the old design remains available as a reference.

## Per-module loop

Each module is developed in seven steps:

1. Create and populate two new files, one for the module definition and one for that module's test bench.
2. Set the new module file as the top-level module in Quartus.
3. Run Analysis and Synthesis and fix any errors it finds.
4. Edit `runlab.do` to include the new module, its test bench, and its yet-to-be-created simulation view.
5. Start ModelSim and perform `do runlab.do`. Fix any errors the compiler finds.
6. When ModelSim reports a missing `*_wave.do` file, set up the Wave pane by drag-and-dropping signals from the Object pane. Save the waveform setup with File -> "Save Formatting", then perform `do runlab.do` again.
7. Check the simulation results, correct errors, and iterate until the module works as intended.

## Why the loop works

Testing every module before the larger modules that instantiate it simplifies debugging, since a bug in a large design is unlikely to lie in a unit that has already been verified. Keeping a separate `*_wave.do` file per Verilog file means each module keeps its own formatted wave window. When a new bug appears in a larger design, a submodule can be re-tested by pointing `runlab.do` at that unit's test bench and `*_wave.do` file.

## Related

- [[hardware/digital-design/369/system-verilog|SystemVerilog]]
- [[hardware/digital-design/369/waveform-diagram|Waveform Diagrams]]
