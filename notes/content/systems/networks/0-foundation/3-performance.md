---
title: Performance
aliases:
  - networks/0-foundation/3-performance
category: Networks
tags:
  - bandwidth
  - throughput
  - latency
  - delay
date: 2024-01-12
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: incomplete
description: Stub defining bandwidth and latency as network performance metrics, with links to the notes that treat each in detail.
---

Network performance is described chiefly by two metrics. **Bandwidth** (or throughput) is the number of bits per second a link or path can carry, and **latency** (or delay) is the time a message takes to cross it.

> [!abstract] Bandwidth vs. latency
> Bandwidth and latency are independent quantities. A satellite link can have high bandwidth and high latency at once, and a short serial cable low bandwidth and low latency. Parallelism (more channels, wider signals) increases bandwidth, whereas only a shorter path or a faster medium reduces propagation latency.

[[systems/networks/0-foundation/2-physical-layer|The physical layer]] works a latency example with the transmission and propagation delay formulas, [[systems/networks/1-physical/coding-and-modulation|coding and modulation]] covers the bandwidth-delay product, and [[systems/networks/0-foundation/information-theory|information theory]] covers the theoretical limits on link capacity.
