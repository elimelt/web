---
title: Internet Control Message Protocol (ICMP)
aliases:
  - networks/3-network/ICMP
category: Networks
tags:
  - networks
  - icmp
  - ping
  - traceroute
  - ttl
date: 2024-02-25
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: The role of ICMP at the network layer, covering error reporting, ICMP redirects, and the construction of traceroute and ping on top of it.
sources:
  - title: "RFC 792: Internet Control Message Protocol"
    url: https://datatracker.ietf.org/doc/html/rfc792
    type: rfc
  - title: "Computer Networks: A Systems Approach"
    url: https://book.systemsapproach.org/
    type: textbook
---

The Internet Control Message Protocol (ICMP, [RFC 792](https://datatracker.ietf.org/doc/html/rfc792)) is a network-layer protocol for reporting errors and exchanging control messages. IP itself provides no feedback when a packet is dropped in the network, so ICMP carries error reports and control messages back to the sender. The diagnostic tools `ping` and `traceroute` are built on ICMP messages.

## Core idea

When a router drops a datagram or a TTL expires (see [[systems/networks/3-network/internetworking|internetworking]] for the TTL field in the IP header), an ICMP message informs the source of the event.

The **ICMP Redirect** control message informs a host that a better route exists for a given destination. A host that receives one updates its routing table to use the new route.

## Traceroute

`traceroute` sends packets with increasing TTLs and listens for ICMP Time Exceeded messages. Each router along the path decrements the TTL, and the router at which it reaches 0 sends a Time Exceeded message back to the source. That message carries the router's IP address as its source, so a packet with TTL $n$ identifies the $n$-th router on the path. `traceroute` records the round-trip time to each router itself, prints the router's address and the timing, and continues to increase the TTL until packets reach the destination.

```mermaid
sequenceDiagram
    participant S as Source
    participant R1 as Router 1
    participant R2 as Router 2
    participant D as Destination

    S->>R1: probe, TTL 1
    Note over R1: TTL hits 0, drop
    R1-->>S: ICMP Time Exceeded (reveals Router 1)
    S->>R2: probe, TTL 2 (forwarded by Router 1)
    Note over R2: TTL hits 0, drop
    R2-->>S: ICMP Time Exceeded (reveals Router 2)
    S->>D: probe, TTL 3
    D-->>S: reply (destination reached, stop)
```

## Ping

`ping` sends ICMP Echo Request messages to the destination and listens for ICMP Echo Reply messages. A host that receives an Echo Request answers with an Echo Reply, which gives the sender a connectivity check and a round-trip time. `ping` repeats until the user stops the command.

## Related notes

- [[systems/networks/3-network/internetworking|internetworking]]
- [[systems/networks/3-network/routing|routing]]
