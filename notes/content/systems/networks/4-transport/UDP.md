---
title: UDP
aliases:
  - networks/4-transport/UDP
category: Networks
tags:
  - udp
  - transport-layer
  - datagrams
  - demultiplexing
  - checksum
date: 2024-02-25
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: draft
description: The service UDP provides and the services it omits, the datagram header, and the conditions under which an application should choose it over TCP.
sources:
  - title: "RFC 768: User Datagram Protocol"
    url: https://datatracker.ietf.org/doc/html/rfc768
    type: spec
  - title: "Computer Networks: A Systems Approach"
    url: https://book.systemsapproach.org/
    type: textbook
---

The User Datagram Protocol (UDP, [RFC 768](https://datatracker.ietf.org/doc/html/rfc768)) is a connectionless transport protocol that delivers discrete messages, called datagrams, between application processes. To the service of the network layer it adds only process-to-process demultiplexing via ports and an optional checksum.

## Core idea

UDP provides no connection setup, no ordering, no retransmission, no flow control, and no congestion control. A datagram arrives once, arrives duplicated, or does not arrive, and the application must handle each case.

The header is 8 bytes with four 16-bit fields.

| Field | Meaning |
| --- | --- |
| Source port | Sending process, so the peer can reply |
| Destination port | Receiving process |
| Length | Header plus data, in bytes |
| Checksum | Integrity check over header and data |

## When to use it

TCP's guarantees come at the cost of connection setup latency, retransmission delays, and stalls for in-order delivery. Applications for which a late message is of no more use than a lost one run on UDP. Real-time audio and video and online games are in this category, since a retransmitted frame arrives too late to be used. DNS uses UDP because a full TCP handshake per lookup would dominate the cost of the small query (see [[systems/networks/5-application/DNS|DNS]]). An application that requires reliability over UDP must implement it itself.

## Related notes

- [[systems/networks/4-transport/TCP|TCP]]
- [[systems/networks/4-transport/transport-overview|transport layer overview]]
- [[systems/networks/5-application/DNS|DNS]]
