---
title: Fundamentals of Data-Intensive Application Design and Scalability
aliases:
  - designing-data-intensive-applications/part-1-foundations-of-data-systems/ch1-reliable-scalable-and-maintainable-applications
category: Database Systems
tags:
  - reliability
  - scalability
  - maintainability
  - data-systems
  - performance
date: 2023-12-19
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: Chapter 1 of Designing Data-Intensive Applications on reliability, scalability and maintainability, covering the distinction between faults and failures, load parameters and response-time percentiles, and the three components of maintainability.
sources:
  - title: Designing Data-Intensive Applications, Martin Kleppmann
    url: https://dataintensive.net/
    type: book
---

Chapter 1 of [Designing Data-Intensive Applications](https://dataintensive.net/) by Martin Kleppmann defines reliability, scalability, and maintainability, the three properties of a data system on which the rest of the book relies, and describes how each is reasoned about.

> [!abstract] Reliability, scalability, maintainability
> **Reliability**: the system continues working correctly even when faults occur. **Scalability**: as load grows, there are reasonable ways of coping with it. **Maintainability**: engineers and operators can work on the system productively over time.

## Data intensive vs. compute intensive

An application is data-intensive when its principal difficulty lies in the volume, complexity, or rate of change of its data rather than in CPU work. Kleppmann observes that such applications are assembled from a small set of common components:

- Databases, which store data so it can be found again later
- Caches, which store the result of an expensive operation to speed up reads
- Search indexes, which let users search or filter data by keyword
- Stream processing, which sends messages to other processes for asynchronous handling
- Batch processing, which periodically processes a large amount of accumulated data

## Reliability

A fault is one component of the system deviating from its spec. A failure is the system as a whole no longer providing the service the user needs. The design goal is to keep faults from turning into failures.

> [!tip] Containing faults
> Fault-tolerant design assumes that components **will** deviate from spec and limits the consequences. Faults can also be induced deliberately, as Netflix's Chaos Monkey does, to verify that the fault-handling mechanisms work.

### Hardware faults

Hardware faults include disk crashes, corrupted RAM, and failed power supplies. The traditional response is hardware redundancy, for example RAID for disks and dual power supplies. In systems of many machines, hardware faults occur regularly, so the book argues for tolerating the loss of whole machines in software in addition to hardware redundancy.

### Software faults

Crashes, runaway processes, slowdowns, and cascading failures tend to be correlated across machines, which makes them more difficult to tolerate than hardware faults. The mitigations are a collection of small measures: thinking carefully about assumptions and interactions in the system, thorough testing, process isolation, letting processes crash and restart, and measuring system behavior in production. If a system is expected to provide some guarantee, for example that a message queue emits as many messages as it ingests, it can check that invariant while running and alert on any discrepancy.

### Human errors

Operators and engineers make configuration errors, and the mitigations Kleppmann lists are structural:

- Design systems in a way that minimizes opportunities for error
- Decouple the places where people make the most mistakes from the places where mistakes cause failures
- Test thoroughly at all levels
- Allow quick and easy recovery
- Set up detailed and clear monitoring

## Scalability

Scalability describes a system's ability to cope with increased load. Load is described with a few numbers that are easy to measure, called load parameters:

- Requests per second
- Read-write ratio
- Cache hit rate
- Concurrent users

Kleppmann frames scalability with two questions. When a load parameter increases and resources (CPU, memory, network bandwidth) are held fixed, how does performance degrade? When a load parameter increases, by how much must resources increase to keep performance unchanged?

### Latency and response time

Latency is the duration a request waits to be handled, during which it is latent, awaiting service. Response time is the delay between a client sending a request and receiving a response, so it includes network delays and queueing on top of service time.

### Measuring response time

Response time is described by percentiles rather than by the mean, with the median (p50) reported alongside the tail percentiles p95 and p99. When a single user request fans out into multiple backend calls, the relevant measure is the p99 of the overall request, since the slowest backend call determines its response time. Kleppmann calls this tail latency amplification: the more backend calls a request makes, the higher the probability that at least one of them is slow.

> [!warning] Averages hide the tail
> A mean response time gives no indication of how many users experience slow responses. The customers with the slowest requests are often those with the most data, so the tail of the distribution often describes the experience of the customers with the most data.

### Coping with load

Scaling up (vertical scaling) means moving to a more powerful machine. Scaling out (horizontal scaling) means distributing the load across multiple smaller machines. Elastic systems add computing resources automatically when they detect a load increase and remove them when load drops. Kleppmann argues that no architecture scales for every application, and that a scalable design follows from the application's access patterns rather than from its data size.

## Maintainability

Operability means making it easy for operations teams to keep the system running smoothly, by making common tasks easy and preferably automatic, and by providing thorough monitoring.

Simplicity means making it easy for new engineers to understand the system by removing as much accidental complexity as possible. Kleppmann identifies abstraction as the principal tool for managing complexity.

Evolvability means making it easy for engineers to change the system in the future as requirements change. Well-chosen abstractions and modularity allow components to be replaced and the overall architecture to be modified without a complete reimplementation.

## Sources

- [Designing Data-Intensive Applications](https://dataintensive.net/), Martin Kleppmann, chapter 1

## Related notes

- [[systems/databases/foundations/ch2-data-models-and-query-languages|data models and query languages]]
- [[systems/databases/foundations/ch3-storage-and-retrieval|storage and retrieval]]
