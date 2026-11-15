---
title: Motivation behind the Network Layer
aliases:
  - networks/3-network/motivation
category: Networks
tags:
  - networks
  - network-layer
  - link-layer
  - routing
  - forwarding
  - icmp
  - bgp
date: 2024-02-16
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: The limits of the link layer as a basis for the internet, the functions the network layer adds, and the distinction between routing and forwarding, with an index of the other network layer notes.
sources:
  - title: "Computer Networks: A Systems Approach"
    url: https://book.systemsapproach.org/
    type: textbook
---

The network layer delivers packets between hosts on different networks. The link layer with packet forwarding can build a single network, but it lacks the global addressing, scalable routing state and interoperation across technologies that an internet requires, and the network layer supplies each of these.

## Shortcomings of the link layer

- **No global addressing**: link layer addresses only mean something on the local network. Reaching hosts on other networks needs an address scheme that spans networks.
- **Limited scale**: no host can maintain a routing table with an entry for every other host on the internet.
- **Only one technology**: link layer technologies are not interoperable with each other. Ethernet and 802.11 frames cannot interoperate without a layer above them.
- **Limited traffic control**: the link layer has no mechanism for handling congestion, routing around failures, or controlling the bandwidth different applications use.

## Network layer approach

- **Scaling**: hierarchical addressing in the form of prefixes, so routers track networks instead of hosts.
- **Heterogeneity**: IP as a common protocol that any link layer technology can carry.
- **Bandwidth control**: congestion control and lowest-cost routing manage traffic, and the layer leaves room for quality of service (QoS).

## Routing vs. forwarding

**Routing** is the process of deciding which paths traffic should take. It happens on a global scale and involves routers exchanging information.

**Forwarding** is the process of sending a packet from one node to the next, one local table lookup per packet.

## Network layer topics

- Network service models, datagrams and virtual circuits: [[systems/networks/3-network/networking-services|networking services]]
- IP, addressing, and forwarding by longest prefix match: [[systems/networks/3-network/internetworking|internetworking]]
- The helper protocols: [[systems/networks/3-network/ARP|ARP]] and [[systems/networks/3-network/DHCP|DHCP]]
- Errors and diagnostics: [[systems/networks/3-network/ICMP|ICMP]]
- Routing algorithms: [[systems/networks/3-network/routing|routing]]
- Scaling routing to the world: [[systems/networks/3-network/global-internet|the global Internet]] and [[systems/networks/3-network/BGP|BGP]]
