---
title: Networks
category: Networks
tags:
  - networking
  - transport
  - routing
  - physical layer
date: 2026-07-31
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: Index of the networking notes, organized by layer from physical links up through application protocols.
---

Computer networks are systems of hosts, links and intermediate nodes that exchange data according to a layered set of protocols, from the transmission of bits over physical media up to the application protocols that use them. The networking notes are organized by layer. [[systems/networks/0-foundation/1-network-components-and-protocols|Network components and protocols]] and [[systems/networks/0-foundation/3-performance|network performance]] introduce the subject, and the remaining notes proceed through the stack in order: physical media, direct links, the network layer, transport, and application protocols.

Several notes apply outside networking. [[systems/networks/0-foundation/information-theory|Information theory]] derives the capacity bound behind the physical layer. [[systems/networks/4-transport/TCP|TCP]] and [[systems/networks/4-transport/ACK-clocking|ACK clocking]] apply wherever queues and feedback loops arise.

## Layers

- Foundations: [[systems/networks/0-foundation/1-network-components-and-protocols|components and protocols]], [[systems/networks/0-foundation/3-performance|performance]], [[systems/networks/0-foundation/information-theory|information theory]]
- Physical and link: [[systems/networks/1-physical/media|media]], [[systems/networks/1-physical/coding-and-modulation|coding and modulation]], [[systems/networks/2-direct-links/framing|framing]], [[systems/networks/2-direct-links/retransmission|retransmission]]
- Network layer: [[systems/networks/3-network/internetworking|internetworking]], [[systems/networks/3-network/routing|routing]], [[systems/networks/3-network/BGP|BGP]]
- Transport and applications: [[systems/networks/4-transport/TCP|TCP]], [[systems/networks/4-transport/UDP|UDP]], [[systems/networks/5-application/HTTP|HTTP]], [[systems/networks/5-application/quic-http2-http3|QUIC, HTTP/2, and HTTP/3]], [[systems/networks/5-application/DNS|DNS]]
