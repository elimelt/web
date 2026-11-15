---
title: End-to-End Arguments in System Design
aliases:
  - systems-research/end-to-end-arguments-in-sys-design
category: Systems Research
tags:
  - system design
  - end-to-end
  - design
  - networking
  - paper-notes
date: 2025-01-14
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: draft
description: Review notes on Saltzer, Reed and Clark's end-to-end argument, which holds that functions such as reliability belong at the endpoints and that lower-level implementations are justified only as performance optimizations.
sources:
  - title: End-to-End Arguments in System Design (1984)
    url: https://web.mit.edu/Saltzer/www/publications/endtoend/endtoend.pdf
    type: paper
---

The end-to-end argument of [Saltzer, Reed and Clark](https://web.mit.edu/Saltzer/www/publications/endtoend/endtoend.pdf) holds that a function such as reliable delivery can be implemented completely and correctly only with the knowledge and help of the application at the endpoints of a communication system. A lower-level implementation of the same function is therefore justified only as a performance optimization.

## Citation

- [End-to-End Arguments in System Design](https://web.mit.edu/Saltzer/www/publications/endtoend/endtoend.pdf), Saltzer, Reed, and Clark.

## Problem

The problem is where, in a layered system, to place a function such as error checking, encryption or delivery acknowledgment. Placing it in the lower layers, so that every application obtains it without further work, is an attractive option. The paper argues that this placement is usually wrong.

## Main idea

A function can only be implemented completely and correctly with the knowledge and help of the application at the endpoints. The paper's running example is careful file transfer: even if the network guarantees reliable delivery, the transfer application still has to check the file end to end, because the file can be corrupted on disk, in memory, or in the file system before it ever reaches the network. Since the endpoint check has to exist anyway, a lower-level implementation of the same function is redundant for correctness. It can only be justified as a performance optimization.

The same reasoning covers crash detection, message sequencing, and duplicate suppression. Only the endpoints have the information about what the application requires, so a correct communication system is built from endpoint checks, independent of what the layers below do.

## Limits of the argument

If the probability of an error inside the network is low, adding checks in intermediate layers yields little benefit and imposes its cost on every user of the layer. The argument is a guideline, however, and it has limits:

- Systems that communicate over lossy media should have intermediate checks, because retransmitting a whole transfer from the endpoints costs far more than correcting errors hop by hop.
- Catching errors only at the endpoints delays detection. A corrupted message traverses the whole path before the error is detected.
- Omitting checks from intermediate layers reduces maintainability, since failures are observed far from where they occur.

> [!tip] Deciding where a function lives
> The endpoint check has to exist for correctness no matter what the network does. A copy of the function belongs in a lower layer only when it is justified as a performance optimization, as hop-by-hop error recovery is on lossy links where end-to-end retransmission would cost far more.

## Sources

- [End-to-End Arguments in System Design](https://web.mit.edu/Saltzer/www/publications/endtoend/endtoend.pdf)

## Related notes

- [[systems/research/internet-design-philosophy|Design Philosophy of DARPA Internet Protocols]]
- [[systems/research/hints-for-computer-system-design|Hints for Computer System Design]]
