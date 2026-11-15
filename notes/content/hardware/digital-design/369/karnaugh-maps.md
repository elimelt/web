---
title: Karnaugh Maps
aliases:
  - hardware-design/369/karnaugh-maps
category: Hardware Design
tags:
  - karnaugh maps
  - truth tables
  - boolean minimization
date: 2024-04-14
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: draft
description: Construction of a Karnaugh map from a truth table and the grouping of 1s to minimize a boolean expression, with notes on Verilog procedural blocks from the same lecture.
sources:
  - title: UW CSE 369 lecture notes
    type: lecture
---

A Karnaugh map (K-map) is a rearrangement of a truth table into a grid in which adjacent cells differ in exactly one input variable.

Grouping adjacent cells of the on set into rectangles identifies product terms from which variables can be eliminated, so the map is a visual method for minimizing boolean expressions.

## Building and reading a K-map

The layout makes adjacencies visible for functions of up to about 4 variables.

1. Split the inputs into two evenly sized groups.
2. Draw a grid with the two groups as the axes, yielding $2^n$ cells for $n$ inputs.
3. Fill in each cell from the truth table.
4. Group the 1s into rectangles whose sizes are powers of two. Groups can span both axes and can wrap around the edges of the map.
5. Group any leftover 1s with adjacent 1s where possible.

> [!tip] Label the axes in Gray code
> Order each axis 00, 01, 11, 10 rather than counting in binary. Gray code ordering changes exactly one variable between neighboring rows and columns, so cells that touch on the grid are logical neighbors. Binary ordering (00, 01, 10, 11) breaks that property between 01 and 10, and groupings read from such a map can combine cells that are not logical neighbors.

A group of size $2^k$ covers cells that agree on all but $k$ of the variables, so its product term drops those $k$ variables. Larger groups give simpler terms, so minimization seeks the largest power-of-two groupings available.

> [!warning] The map wraps around
> Cells on opposite edges are adjacent. The leftmost and rightmost columns differ in one variable, and so do the top and bottom rows, so a group can span the edge of the map. In a 4-variable map the four corners form a legal group of 4. An overlooked wrap-around group leaves an unnecessarily large expression even when every grouping found is correct.

## Verilog procedural blocks

These constructs came up in lab while building a 7-segment display driver.

- `assign` is continuous assignment. The statement holds for all time.
- `initial` executes once at time zero. It is appropriate only in test benches, since time zero is a simulation concept with no hardware meaning.
- `always` re-executes whenever a signal in its *sensitivity list* changes. Any object assigned inside an `always` block must be declared as a variable (`reg` or `logic`). Writing `always @ (a or b or c)` is the same as `always @ (a, b, c)`, and `always @ (*)` implicitly includes every signal the block reads.
- `always_comb` is the SystemVerilog form of `always @ (*)`. It infers the sensitivity list from the signals read in the block and declares to the tools that the block is intended as combinational logic.

## Related

- [[hardware/digital-design/369/combinational-logic|Combinational Logic]]
- [[hardware/digital-design/369/system-verilog|SystemVerilog]]
