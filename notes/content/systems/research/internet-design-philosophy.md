---
title: Design Philosophy of DARPA Internet Protocols
aliases:
  - systems-research/internet-design-philosophy
category: Systems Research
tags:
  - internet
  - design
  - systems
  - networking
  - paper-notes
  - packet-switching
  - datagrams
date: 2025-01-14
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: Review notes on Clark's paper explaining the goals behind the DARPA internet protocols, covering packet switching, datagrams, the thin waist, and fate sharing.
sources:
  - title: The Design Philosophy of the DARPA Internet Protocols (SIGCOMM 1988)
    url: http://ccr.sigcomm.org/archive/1995/jan95/ccr-9501-clark.pdf
    type: paper
---

[The Design Philosophy of the DARPA Internet Protocols](http://ccr.sigcomm.org/archive/1995/jan95/ccr-9501-clark.pdf) (David D. Clark, SIGCOMM 1988) is a retrospective that states, in priority order, the goals against which the internet protocols were designed, and relates the principal design decisions to them: packet switching, the datagram, the narrow interface of IP, and fate sharing.

## Citation

- [The Design Philosophy of the DARPA Internet Protocols](http://ccr.sigcomm.org/archive/1995/jan95/ccr-9501-clark.pdf), David D. Clark.

## Problem

The structure of TCP/IP appears arbitrary without knowledge of the goals it was designed to meet. Clark states those goals in priority order and shows how each design decision follows from them. The ordering matters as much as the list; a network built for commercial operation instead of military survivability would have made different tradeoffs from the same catalog.

## Main idea

The fundamental goal was an effective technique for multiplexed utilization of interconnected networks. Both terms, multiplexing and interconnection, are significant.

Multiplexing means many communicating parties share a channel. Circuit switching dedicates a channel per pair of parties, which gives predictable performance because resources are reserved, but wastes capacity and scales poorly; connecting $N$ parties pairwise needs $N(N-1)/2$ channels. Packet switching lets packets from many parties share one channel. Utilization improves, and in exchange packets can be lost, delayed, or reordered. Packet switching also exploits redundant paths between hosts. A transport-layer connection survives as long as some path exists, regardless of changes in the underlying topology.

Interconnection means joining heterogeneous networks, each with its own protocols and addressing, into one internet that moves data between them.

The secondary goals, in the paper's order of importance:

- Continue despite failure
- Support multiple types of communication service
- Accommodate a variety of networks
- Distributed management of resources, since centralized control would become a bottleneck and each network should manage its own
- Cost effectiveness
- Easy host attachment, without requiring changes to the network
- Accountability, so hosts can identify themselves and quality of service can be enforced

## Datagrams

The [[systems/networks/3-network/networking-services|datagram]] is the key building block. It is a connectionless service with no state established ahead of time, and each packet is independent. UDP is the application-level interface to the internet's datagram service, and other protocols build on top of it conceptually; TCP adds connections, reliability, and in-order delivery, while UDP itself stays unreliable and unordered, with no QoS guarantees from the lower level.

## Supporting a variety of networks

Support for a variety of networks rests on the "thin waist" of the hourglass model. IP at the network layer gives all networks a common interface, and TCP/UDP at the transport layer give all applications one. The abstraction hides the details of the lower layers, so their behavior can change without any effect visible to applications.

The same hiding has costs. Applications cannot use hints from the lower level for optimization, and the workarounds (ECN, kernel-bypass systems like DPDK, with parallels in storage like SPDK and direct access) exist precisely to bypass the abstraction. The IP interface itself also cannot evolve without changes to everything above it.

## Fate sharing

Fate sharing places connection state at the endpoints for survivability. The state shares fate with the endpoint that depends on it, so if a network element fails, the endpoints still hold everything needed to reestablish the connection. This is the [[systems/research/end-to-end-arguments-in-sys-design|end-to-end argument]] applied to network resilience.

> [!tip] Fate sharing
> Connection state is kept at the endpoint that depends on it, so a failure can destroy only state belonging to the party that failed.

## Strengths and weaknesses

The datagram is a simple abstraction that scales and distributes well, and the strongest evidence for the design is its operation at internet scale. Conversely, the narrow IP interface impedes innovation at the IP level, and hiding the lower layers can reduce efficiency.

## Further reading

- [Principles of Computer System Design](https://ocw.mit.edu/courses/res-6-004-principles-of-computer-system-design-an-introduction-spring-2009/pages/online-textbook/)

## Sources

- [The Design Philosophy of the DARPA Internet Protocols](http://ccr.sigcomm.org/archive/1995/jan95/ccr-9501-clark.pdf)

## Related notes

- [[systems/research/end-to-end-arguments-in-sys-design|End-to-End Arguments in System Design]]
- [[systems/research/development-of-the-dns|Development of the Domain Name System]]
- [[systems/networks/3-network/networking-services|Networking Services]]
- [[systems/networks/0-foundation/1-network-components-and-protocols|Network Components and Protocols]]
- [[systems/networks/2-direct-links/multiple-access|Multiple Access]]
- [[systems/networks/5-application/overview|Application Layer Overview]]
- [[systems/networks/3-network/motivation|Motivation behind the Network Layer]]
