---
title: Hints for Computer System Design
aliases:
  - systems-research/hints-for-computer-system-design
category: Systems Research
tags:
  - systems
  - scaling
  - review
  - paper
  - caching
date: 2025-01-06
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: Notes on Lampson's hints paper plus lecture discussion, with a worked treatment of his caching formulation and the interface, implementation, efficiency, and reliability hints.
sources:
  - title: Hints for Computer System Design (SOSP 1983)
    url: https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/acrobat-17.pdf
    type: paper
---

[Hints for Computer System Design](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/acrobat-17.pdf) (Butler Lampson, SOSP 1983) is a collection of heuristics for the design of computer systems, concerning interfaces, implementation, efficiency and reliability. My reading of the paper is combined with lecture discussion of it. Caching is treated in the most depth, because Lampson's formulation generalizes beyond memory hierarchies.

## Citation

- [Hints for Computer System Design](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/acrobat-17.pdf), Butler Lampson, SOSP 1983.

## Lampson's formulation of caching

A cache stores $[f, x, f(x)]$ tuples, mapping a function and its argument to a memoized result.

If $f$ is not a pure function, cached entries must be updated when the input changes. Lampson frames invalidation as finding an inexpensive update function $g$ such that

$$
f(x + \Delta) = g(x, \Delta, f(x))
$$

For example, let $x$ be an `int[]`, let $\Delta$ be a write $(i, v)$, and let $f$ be `int sum(int[] x)`. Then $g(x, \Delta, f(x))$ is `f(x) + v - x[i]`. The sum is not recomputed from scratch; the cached value is updated.

Hardware caching fits the same shape with $[Fetch, \text{address}, \text{content of address}]$ tuples, and virtual memory with $[Page, \text{address}, \text{content of address}]$ tuples. More complex applications also exist. Real-time systems often cache the state of a system under small event-driven changes, and the goal is to invalidate as few entries as possible per event. Caches should ideally have adaptive sizes.

## Difficulty of system design

The external interface is not well defined. Requirements are unclear, and the components a system is built against are often poorly designed themselves. The measure of success is also unclear, since there are many ways to interact with a system, and many production systems ship with bugs.

## Interface design

An interface should be simple, complete and efficient at the same time, and these requirements conflict. Designing one resembles language design, since an interface exposes abstractions and operations on which clients build.

The hints I found most useful are the following.

- Do one thing at a time and do it well. Don't over-promise.
- Get it right, but beware the dangers of abstractions, especially their performance cost.
- Make it fast rather than general and complete. Small scope keeps a component easy to optimize and easy to compose with other systems.
- Procedure arguments keep an interface general but extendable. C function pointers and C++ callables are common instances. `LD_PRELOAD` is another, which overrides a call with a wrapper that adds functionality and then calls the original.
- Leave it to the client. Unix pipes follow this hint, and the [[systems/research/exokernel|Exokernel]] applies it as far as possible.
- Keep interfaces stable. The frequent interface changes in LLVM are a counterexample.
- Keep a place to stand. Virtualization is the canonical example.

## Implementation

Plan to throw one away; a prototype is a means of learning and should be expected to be discarded. Keep secrets, that is, hide implementation details from clients, with the qualification that secrecy can conflict with performance optimizations.

Handle normal and worst cases separately. Crashing a few processes may be acceptable if the system as a whole can recover. Processor caches and virtual memory paging both optimize for the common case that locality predicts.

## Efficiency

Split resources. Allocating a fresh resource is faster than waiting for one to be freed, and dedicating specialized hardware to specialized tasks follows the same logic. FPGAs and GPUs running dedicated workloads, like Google's TPU or Microsoft Azure's FPGAs, are current instances. Static analysis helps find the rest.

## Reliability

Log updates. A log enables recovery after a crash. Because it is append-only it is also inexpensive to write, and the same log can serve as a replication mechanism. Atomic transactions, in the ACID sense, build on that foundation.

## Takeaways

Successful systems tend to repeat a small set of themes, many of which Lampson names. A reader of such papers gains most by looking for what is applicable and disregarding irrelevant details. The hints also admit extension, for example along the axis of approximation versus precision, which Lampson leaves open.

## Further reading

- [DPDK](https://github.com/DPDK/dpdk), kernel-bypass networking that follows the "leave it to the client" hint
- MicroLog

## Sources

- [Hints for Computer System Design](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/acrobat-17.pdf)

## Related notes

- [[systems/research/end-to-end-arguments-in-sys-design|End-to-End Arguments in System Design]]
- [[systems/operating-systems/v1-kernels-and-processes/1-introductions|What Is an Operating System?]]
- [[systems/research/locality-principle|The Locality Principle]]
