---
title: Scalable Distributed Data Systems
aliases:
  - designing-data-intensive-applications/part-2-distributed-data/preface
category: Database Systems
tags:
  - distributed-systems
  - scalability
  - fault-tolerance
  - shared-nothing-architecture
date: 2023-12-26
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: The preface to part 2 of Designing Data-Intensive Applications, which gives the reasons for distributing data across machines and contrasts shared memory, shared disk, and shared nothing architectures.
sources:
  - title: Designing Data-Intensive Applications, Martin Kleppmann
    url: https://dataintensive.net/
    type: book
---

Part 2 of [Designing Data-Intensive Applications](https://dataintensive.net/) by Martin Kleppmann treats data systems that run on multiple machines. Its preface gives the reasons for distributing data and contrasts three hardware architectures for doing so, of which the rest of the part assumes the shared nothing architecture.

## Why distribute data

The motivations for running a data system on multiple machines parallel the concerns of a single-machine system:

- **Scalability.** Load is split between multiple machines.
- **Fault tolerance.** The system continues to serve requests when one or more machines fail.
- **Latency.** Data is placed geographically close to users, via CDNs, caching, and regional replicas.

## Scaling up

A **[[systems/research/barrelfish|shared memory architecture]]** is a single computer with many CPUs sharing memory over a common bus. Its cost grows faster than linearly with capacity, since a machine with twice the resources costs more than twice as much, and the shared bus becomes a bottleneck regardless of cost.

A **shared disk architecture** gives each machine its own CPU and memory while all machines access the same disks over the network. It scales further than shared memory, until the shared disks and the locking needed to coordinate access to them become the bottleneck.

## Scaling out

In a **shared nothing architecture**, each machine has its own CPU, memory, and disk. Each machine, physical or virtual, is a **node**, and nodes coordinate purely by sending messages over the network in software. Of the three architectures it is the most [[systems/databases/foundations/ch1-reliable-scalable-and-maintainable-applications|scalable]], and it moves every coordination problem into software.

Part 2 of the book focuses on shared nothing architectures.

## Sources

- [Designing Data-Intensive Applications](https://dataintensive.net/), Martin Kleppmann, part 2 preface

## Related notes

- [[systems/databases/distributed-data/ch5-replication|replication]]
- [[systems/research/barrelfish|The Multikernel, A new OS architecture for scalable multicore systems]]
- [[systems/databases/foundations/ch1-reliable-scalable-and-maintainable-applications|Fundamentals of Data-Intensive Application Design and Scalability]]
- [[ml/recommender-systems/intro-mapreduce-spark|Distributed Computing for Data Mining]]
- [[systems/research/development-of-the-dns|Development of the Domain Name System]]
