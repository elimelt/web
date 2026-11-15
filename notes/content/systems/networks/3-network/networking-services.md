---
title: "Networking Services: Store-and-Forward Packet Switching and Datagrams vs. Virtual Circuits"
aliases:
  - networks/3-network/networking-services
category: Networks
tags:
  - networks
  - packet-switching
  - datagrams
  - virtual-circuits
  - forwarding
date: 2024-02-16
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: The two service models a packet-switched network can offer, connectionless datagrams and connection-oriented virtual circuits, and the tradeoffs between them.
sources:
  - title: "Computer Networks: A Systems Approach"
    url: https://book.systemsapproach.org/
    type: textbook
---

A packet-switched network offers the layers above it one of two service models. In the connectionless datagram model each packet carries its full destination address and is forwarded independently. In the connection-oriented virtual circuit model the network sets up a path before data flows, and packets carry a short connection identifier.

Both models run on store-and-forward packet switching, and the choice between them determines router state, addressing, and the effect of failures. The role of the network layer itself is discussed in [[systems/networks/3-network/motivation|motivation behind the network layer]].

## Store-and-forward packet switching

A router receives a complete packet, stores it temporarily if necessary, and then forwards it toward the next hop. Links are shared over time by statistical multiplexing. Each switching element has internal buffering to absorb contention, typically a FIFO queue, and when the buffer fills, packets are dropped.

## Datagrams

Datagrams are a connectionless service. Each packet is independent, carries the full destination address, and can take a different route to the destination, like postal letters. A router forwards a datagram by looking up its destination address in a forwarding table that maps destinations to next hops, and the entries change over time as the network topology changes. Consecutive packets to the same destination may follow different paths. This is the model IP uses, and it is the predominant model in the internet (see [[systems/networks/3-network/internetworking|internetworking]]).

## Virtual circuits

Virtual circuits are a connection-oriented service. The network sets up a path between source and destination before any data flows, like a phone call. Every packet follows that path and carries a short connection ID instead of a full address. Routers hold per-connection state. The internet does not generally use this model, but ATM and Frame Relay do.

## Tradeoffs

| Issue | Datagram | Virtual Circuit |
|-------|----------|-----------------|
| Setup phase | Not needed | Required |
| Router state | Per destination | Per connection |
| Addresses | Packet carries full destination address | Short connection ID as label |
| Routing | Per packet | Per circuit |
| Failures | Easy to mask | Hard to mask |
| QoS | Hard to provide | Easier to provide |

When a link fails under a datagram service, routing updates the forwarding tables and later packets take another path. Under a virtual circuit service, every circuit through the failed link is broken and must be set up again. Per-connection state is also what makes QoS easier for circuits, since the network can reserve resources per connection at setup time.

## Related notes

- [[systems/networks/3-network/motivation|motivation behind the network layer]]
- [[systems/networks/3-network/internetworking|internetworking]]
- [[systems/networks/4-transport/transport-overview|Transport Layer Overview]]
- [[systems/networks/2-direct-links/switching|Switched Ethernet]]
