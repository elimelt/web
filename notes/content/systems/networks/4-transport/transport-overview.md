---
title: Transport Layer Overview
aliases:
  - networks/4-transport/transport-overview
category: Networks
tags:
  - transport-layer
  - tcp
  - udp
  - datagrams
  - bytestreams
  - encapsulation
date: 2024-02-25
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: What the transport layer provides on top of the network layer, and the two service models it exposes, datagrams via UDP and bytestreams via TCP.
sources:
  - title: "CSE 461: Computer Networks, University of Washington"
    url: https://courses.cs.washington.edu/courses/cse461/
    type: lecture
  - title: "Computer Networks: A Systems Approach"
    url: https://book.systemsapproach.org/
    type: textbook
---

The transport layer provides end-to-end communication between application processes on different hosts, built on the network layer's delivery of packets between hosts. In terms of encapsulation, application data is carried in segments, segments in packets, and packets in frames.

```mermaid
flowchart LR
    A[Application data] --> S[Segment, transport layer]
    S --> P[Packet, network layer]
    P --> F[Frame, link layer]

    style S fill:#e3f2fd
```

The layer exposes two service models. Messages, also called datagrams, are discrete units of data delivered independently, and UDP provides them with no delivery guarantees. Bytestreams are continuous ordered streams of bytes, and TCP provides them with reliability, flow control, and congestion control layered on top of the network's best-effort delivery.

The choice between them depends on whether an application requires delivery guarantees more than low overhead. [[systems/networks/4-transport/TCP|TCP]] and [[systems/networks/4-transport/UDP|UDP]] treat the two protocols in detail.

## Related notes

- [[systems/networks/4-transport/TCP|TCP]]
- [[systems/networks/4-transport/UDP|UDP]]
- [[systems/networks/4-transport/flow-control|flow control]]
- [[systems/networks/0-foundation/3-performance|network performance]]
