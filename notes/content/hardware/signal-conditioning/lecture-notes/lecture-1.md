---
title: "C-SWAP: Cost, Size, Weight and Power"
aliases:
  - signal-conditioning/lecture-notes/lecture-1
category: Signal Conditioning
tags:
  - c-swap
  - embedded systems
  - power
  - hardware
  - energy constraints
  - heat dissipation
date: 2024-01-03
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: draft
description: Lecture 1 of a signal conditioning course on the C-SWAP constraints (cost, size, weight, power) that shape embedded hardware design, and the sources of a device's power draw.
sources:
  - title: Signal conditioning course, lecture 1
    type: lecture
---

C-SWAP denotes the four constraints of cost, size, weight, and power that shape the design of embedded hardware. Lecture 1 of the signal conditioning course framed hardware design around them.

## The constraints

Cost depends mainly on whether the device is consumable or reusable, since a consumable must be inexpensive enough to discard.

Size and weight are in many cases driven by power, because batteries tie stored energy to mass and volume.

Power determines how long the device runs between charges, and it also sets the thermal budget, since everything the device draws it eventually dissipates as heat. The lecture's rule of thumb was that 10 mW/cm^3 of dissipation raises device temperature about 2 degrees C.

Power draw comes from three principal sources: sensing, computing, and communication. The dominant source determines where optimization has the most effect.

## Related

- [[hardware/signal-conditioning/lecture-notes/lecture-2|Electricity]]
- [[systems/research/data-center-power-provisioning|Power Provisioning for a Warehouse-sized Computer]]
