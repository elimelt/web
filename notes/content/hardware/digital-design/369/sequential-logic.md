---
title: Sequential Logic (SL)
aliases:
  - hardware-design/369/sequential-logic
category: Hardware Design
tags:
  - sequential logic
  - digital systems
  - finite state machines
  - flip-flops
  - clock signals
date: 2024-05-17
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: Feedback as the source of state in circuits, the D flip-flops and registers that synchronize signals with a clock, and the timing constraints that set the maximum clock frequency.
sources:
  - title: UW CSE 369 lecture notes
    type: lecture
---

Sequential logic is logic whose outputs depend on its present inputs and on stored state. The state is held through *feedback*, in contrast to [[hardware/digital-design/369/combinational-logic|combinational logic]], whose outputs are functions of the present inputs alone. Stored state is the basis of memory and computation in digital systems.

Sequential logic controls the flow of information through blocks of combinational logic, usually synchronized with a clock signal. One major application is the **Finite State Machine (FSM)**. Without sequential logic, the output of a combinational circuit would change with every change in input, including glitches through intermediate states, so downstream logic could observe unpredictable values.

## Positive edge-triggered D flip-flop

On the rising edge of the clock, the flip-flop samples its input and transfers it to the output. At all other times its output does not respond to changes on the input and holds the previously sampled value. This *synchronizes* the input with the clock, quantizing input changes so that they only take effect on rising clock edges.

## Registers

An $n$-bit register is $n$ flip-flops sharing a clock. Registers add a `reset` signal, which forces the register to a known state when it is high during a clock trigger.

## Flip-flop timing

- **Setup time** $t_{setup}$: how long the input must be stable *before* the clock trigger for a proper read.
- **Hold time** $t_{hold}$: how long the input must be stable *after* the clock trigger for a proper read.
- **Clock-to-Q delay** $t_{clk\text{-}to\text{-}Q}$: how long the output takes to change after a clock trigger.

Let $t_{input, i}$ be the time at which the input of a register changes for the $i$-th time within a clock cycle, measured from the clock edge. Every change must land in the window

$$
t_{hold} \le t_{input, i} \le t_{period} - t_{setup}
$$

The lower bound keeps the input stable long enough after the edge for the old value to latch. The upper bound leaves the input stable for the setup window before the next edge.

### Minimum delay

If the shortest path to a register input is too short, the input can change before the state is locked in, violating $t_{hold}$. The shortest path either starts at another register (clock-to-Q plus the shortest combinational delay) or comes straight from an external input (the combinational delay alone):

```plaintext
min_delay = min(clk_to_q + min_cl_delay, min_cl_delay)
min_delay >= t_hold
```

> [!warning] A slower clock never fixes a hold violation
> The hold constraint compares `min_delay` against $t_{hold}$, and the clock period appears nowhere in it. If the shortest path is too fast, the only fix is adding delay to that path or using a flip-flop with a smaller hold time. Slowing the clock adds margin only against setup violations.

### Maximum clock frequency

The clock can only run as fast as the slowest path that must deliver a correct next state to a register:

```plaintext
max_delay  = max(clk_to_q + max_cl_delay, max_cl_delay)
min_period = max_delay + t_setup
max_freq   = 1 / min_period
```

## Related

- [[hardware/digital-design/369/waveform-diagram|Waveform Diagrams]]
- [[hardware/digital-design/371/algorithmic-state-machines|Algorithmic State Machines]]
- [[hardware/digital-design/371/static-timing-analysis|Static Timing Analysis]]
