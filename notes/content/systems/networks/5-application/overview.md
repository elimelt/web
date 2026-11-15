---
title: Application Layer Overview
aliases:
  - networks/5-application/overview
category: Networks
tags:
  - application-layer
  - http
  - tcp
  - udp
  - reliability
date: 2024-03-04
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: draft
description: How applications choose between TCP and UDP as the substrate for application-layer protocols.
sources:
  - title: "CSE 461: Computer Networks, University of Washington"
    url: https://courses.cs.washington.edu/courses/cse461/
    type: lecture
  - title: "Computer Networks: A Systems Approach"
    url: https://book.systemsapproach.org/
    type: textbook
---

Every application-layer protocol runs over a transport protocol, in practice TCP or UDP, and the choice determines which delivery guarantees the application receives.

Applications built on [[systems/networks/4-transport/TCP|TCP]] can transfer data of arbitrary length and receive reliability and flow control from the transport layer without implementing them. Some applications do not require those guarantees, and for some the guarantees are harmful. Internet telephony and online games run on [[systems/networks/4-transport/UDP|UDP]] because a retransmitted packet arrives too late to be useful, and the delay TCP introduces to enforce in-order delivery degrades them more than the losses do. Among application-layer protocols, [[systems/networks/5-application/HTTP|HTTP]] runs over TCP because pages must arrive intact, and [[systems/networks/5-application/DNS|DNS]] runs over UDP because a lookup is one small message and a retry adds little overhead.

## Related notes

- [[systems/networks/5-application/HTTP|HTTP]]
- [[systems/networks/5-application/DNS|DNS]]
- [[systems/networks/5-application/CDNs|content delivery networks]]
- [[systems/networks/4-transport/transport-overview|transport layer overview]]
- [[systems/research/end-to-end-arguments-in-sys-design|End-to-End Arguments in System Design]]
