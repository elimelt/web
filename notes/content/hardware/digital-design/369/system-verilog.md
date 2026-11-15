---
title: SystemVerilog
aliases:
  - hardware-design/369/system-verilog
category: Hardware Design
tags:
  - system-verilog
  - hardware
  - digital electronics
  - hardware description languages
date: 2024-04-02
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: SystemVerilog basics from CSE 369, covering nets and variables, signal values, modules, the hardware execution model, and structural design shown through an AOI circuit and a 2:1 mux.
sources:
  - title: UW CSE 369 lecture notes
    type: lecture
---

SystemVerilog is a hardware description language (HDL). A SystemVerilog program describes a digital circuit, as an interconnection of components or as behavior, for simulation and synthesis.

The primitives and the structural style are those used in CSE 369. The examples implement one AND-OR-INVERT circuit in three structural styles and compose it into a 2:1 multiplexer.

## What Verilog is

Verilog is a language for describing hardware. A design is described programmatically, so it can be tested in simulation before it is implemented in hardware. The syntax resembles C, but the execution model is different. SystemVerilog is a superset of the older Verilog, and the name Verilog is used for both.

## Nets and variables

A net (`wire`) transmits the value of a connected source. It behaves as a branching wire, since it can connect to many places. Connecting two different voltage sources to the same net causes contention.

A variable (`reg`) acts as a voltage source to which arbitrary values can be assigned. `logic` can also be used as a variable.

## Signal values

- `0`: low, treated as false
- `1`: high, treated as true
- `X`: unknown
- `Z`: floating, high impedance

## Modules

Modules are the unit of design in Verilog, comparable to classes in software. They define blocks with a boundary. Inputs are signals passed from outside the block to inside, and outputs are signals passed from inside to outside.

## Execution model

A wire cannot be turned off. Wires transmit voltages almost instantly, and every gate and module computes continuously, unlike the sequential execution of a software program. Hardware also has no inherent notion of initialization, and a wire can pick up voltage from its environment before it is driven.

## Structural Verilog

The same AND-OR-INVERT circuit can be written in three ways. The first uses a single continuous assignment:

```verilog
// SystemVerilog code for AND-OR-INVERT circuit
module AOI (F, A, B, C, D);
    output logic F;                     // each variable
    input logic A, B, C, D;             // is 1-bit (logic)

    assign F = ~((A & B) | (C & D));    // continuous assignment
endmodule
```

The second uses intermediate signals:

```verilog
// SystemVerilog code for AND-OR-INVERT circuit
module AOI (F, A, B, C, D);
    output logic F;
    input logic A, B, C, D;
    logic AB, CD, O; // now necessary

    assign AB = A & B;
    assign CD = C & D;
    assign O = AB | CD;
    assign F = ~O;
endmodule
```

The third uses gate primitives:

```verilog
// SystemVerilog code for AND-OR-INVERT circuit
module AOI (F, A, B, C, D);
    output logic F;
    input logic A, B, C, D;
    logic AB, CD, O; // now necessary

    // "and" is the module name. a1 is the instance name.
    // AB, A, B are port connections.
    and a1(AB, A, B);
    and a2(CD, C, D);
    or o1(O, AB, CD);
    not n1(F, O);
endmodule
```

## 2-input MUX from AOI

The following 2:1 multiplexer instantiates the AOI module:

```verilog
// 2:1 multiplexer built on top of AOI module
module MUX2 (V, SEL, I, J);
    output logic V;
    input logic SEL, I, J;
    logic SELN, VN;

    not G1 (SELN, SEL);
    // Explicit (named) port assignment, so port
    // order doesn't matter.
    AOI G2 (.F(VN), .A(I), .B(SEL), .C(SELN), .D(J));
    not G3 (V, VN);
endmodule
```

The AOI output is inverted, so `VN` is low when the selected input is high, and the final `not` restores the intended mux output.

## Related

- [[hardware/digital-design/369/combinational-logic|Combinational Logic]]
- [[hardware/digital-design/369/sequential-logic|Sequential Logic]]
- [[hardware/digital-design/369/quartus-workflow|the Quartus and ModelSim workflow]]
- [[hardware/computer-architecture/rtl-reading-lab|Open-Source CPU RTL Reading Lab]]
