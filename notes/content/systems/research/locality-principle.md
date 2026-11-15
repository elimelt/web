---
title: The Locality Principle
aliases:
  - systems-research/locality-principle
category: Systems Research
tags:
  - os
  - operating-system
  - systems
  - virtual-memory
  - paging
  - lru
  - caching
  - paper-notes
date: 2025-03-05
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: Review notes on Denning's retrospective about the working set model and how locality of reference became a general design principle for memory systems.
sources:
  - title: The Locality Principle, Peter J. Denning, Communications of the ACM 48(7), 2005
    url: https://dl.acm.org/doi/10.1145/1070838.1070856
    type: paper
  - title: Author's PDF
    url: https://denninginstitute.com/pjd/PUBS/CACMcols/cacmJul05.pdf
    type: paper
---

[The Locality Principle](https://dl.acm.org/doi/10.1145/1070838.1070856) (Peter J. Denning, CACM, July 2005) is a retrospective on the working set model and on locality of reference, the tendency of a program's memory references to cluster in a subset of its address space that changes slowly over time. Denning traces how the working set model resolved thrashing in early virtual memory systems and how locality became a design principle for systems well beyond paging. My original note linked the wrong PDF; the sources listed with the citation are the correct ones.

## Citation

- [The Locality Principle](https://dl.acm.org/doi/10.1145/1070838.1070856), Peter J. Denning, Communications of the ACM, July 2005 ([author's PDF](https://denninginstitute.com/pjd/PUBS/CACMcols/cacmJul05.pdf)).

## Problem

Thrashing was a recurring problem in early virtual memory implementations. A thrashing system spends more time swapping pages in and out of memory than executing the program. Thrashing occurs when a program's working set is larger than the physical memory available to it, so it page faults repeatedly and throughput falls sharply.

## Main idea

Denning recounts the history of virtual memory and the development of the working set model for managing memory. In studying the problem, he observed a regularity in program behavior. Memory references cluster, and the set of pages a program uses changes slowly over time. That property is general and can be exploited to improve the performance of systems well beyond paging, particularly systems that access external storage.

## Mechanism

The working set model $W(t, T)$ defines a process's memory needs as the set of pages it referenced in the time interval of length $T$ preceding time $t$. This gives an abstract, measurable definition of a process's memory demand, and a theoretical basis for reasoning about memory behavior.

The model becomes a control mechanism through admission control on the multiprogramming level. The OS does not activate a program whose working set would not fit in available memory. Feedback control on that admission decision prevents thrashing, because memory is never committed beyond what the active working sets demand. The same strategy, queueing requests and controlling admission, applies whenever working sets grow too large.

> [!tip] Preventing thrashing
> A program is activated only if its working set fits in available memory. $W(t, T)$ makes "fit" a measurable condition.

## Assumptions and limits

The original model fixes $T$, which makes it behave like an LRU cache of a fixed window, and no single window suits all workloads. Some workloads also fall entirely outside the model, such as a job that reads a large file sequentially and never revisits a page.

## Evidence

The paper is historical, so its evidence is the historical record. Working-set-based memory management made virtual memory viable and reasonably predictable, and locality was subsequently applied to caches, storage hierarchies and many other domains.

## Open questions

- Can malicious actors exploit systems designed around the common case of locality, turning worst-case access patterns into a denial of service?
- Is designing for high-throughput sequential reads directly at odds with designing for locality, or can a system target both at once?

## Sources

- [The Locality Principle, CACM 2005](https://dl.acm.org/doi/10.1145/1070838.1070856)
- [Author's PDF at the Denning Institute](https://denninginstitute.com/pjd/PUBS/CACMcols/cacmJul05.pdf)

## Related notes

- [[systems/research/barrelfish|The Multikernel]]
- [[systems/research/hints-for-computer-system-design|Hints for Computer System Design]]
