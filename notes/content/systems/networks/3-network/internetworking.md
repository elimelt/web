---
title: Internetworking
aliases:
  - networks/3-network/internetworking
category: Networks
tags:
  - networks
  - internetworking
  - ip-addressing
  - forwarding
  - arp
  - icmp
  - ttl
date: 2024-02-16
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: The interconnection by IP of networks that differ in service model, addressing, and packet size, covering IPv4 addressing, prefixes and CIDR, and datagram forwarding with longest prefix match.
sources:
  - title: "RFC 791: Internet Protocol"
    url: https://datatracker.ietf.org/doc/html/rfc791
    type: rfc
  - title: "RFC 4632: Classless Inter-domain Routing (CIDR)"
    url: https://datatracker.ietf.org/doc/html/rfc4632
    type: rfc
  - title: "Computer Networks: A Systems Approach"
    url: https://book.systemsapproach.org/
    type: textbook
---

Internetworking is the interconnection of networks built on different technologies into a single internet. Routers join the networks and forward datagrams between them using a common protocol, IP, and a common address space.

The constituent networks may differ in service model, addressing, quality of service, packet size and security. IP requires little of each and defines a global addressing scheme in which blocks of addresses, called prefixes, determine how routers forward each datagram.

## How networks may differ

- Service model (datagrams vs virtual circuits, see [[systems/networks/3-network/networking-services|networking services]])
- Addressing
- QoS (priorities)
- Packet size
- Security (encryption, authentication)

Internetworking hides these differences behind a common protocol (IP) and a common addressing scheme (IP addresses).

### Connecting datagram and virtual circuit networks

Sending a datagram across a virtual circuit network requires mapping a destination address to a VC and back. One method is to set up a VC between two routers and carry datagrams over that circuit:

```plaintext
+--------+   802.11   +--------+ <---- MPLS ----> +--------+  Ethernet  +--------+
|  host  |------------| Router |                  | Router |------------|  host  |
+--------+            +--------+ <--------------> +--------+            +--------+
 source                            VC network                           destination
```

## IP addressing

IP is the single protocol that every network in the internet supports. It allows networks that offer entirely different services to communicate, by requiring very little of the underlying network and providing very little in return.

- IPv4 uses 32-bit addresses written in "dotted quad" notation, four 8-bit numbers separated by dots.
  - Ex: `192.168.1.1`
- IPv6 uses 128-bit addresses written in hexadecimal notation.
  - Ex: `2001:0db8:85a3:0000:0000:8a2e:0370:7334`

### IPv4 header

The header format below is from [RFC 791](https://datatracker.ietf.org/doc/html/rfc791). TTL expiry is the event that [[systems/networks/3-network/ICMP|ICMP]] Time Exceeded messages report, and the protocol field identifies the payload as TCP, UDP, or another protocol.

```plaintext
<--------------------------------------- 32 bits --------------------------------------->

+---------------------+---------------------+---------------------+---------------------+
| Version |    IHL    |   Dif. Services     |         Total Length (bytes)              |
+---------------------+---------------------+---------------------+---------------------+
|              Identification               |    | DF | MF |  Fragment Offset (13 bits) |
+---------------------+---------------------+---------------------+---------------------+
|  Time to Live (TTL) | Protocol (TCP, UDP) |            Header Checksum                |
+---------------------+---------------------+---------------------+---------------------+
|                               Source IP Address (32 bits)                             |
+---------------------+---------------------+---------------------+---------------------+
|                            Destination IP Address (32 bits)                           |
+---------------------+---------------------+---------------------+---------------------+
|                                  Options (0 or more words)                            |
|                                        ....                                           |
+---------------------+---------------------+---------------------+---------------------+
|                                       Payload                                         |
|                                        ....                                           |
+---------------------+---------------------+---------------------+---------------------+
```

### IP prefixes

Addresses are allocated in blocks called prefixes. Addresses in an $L$-bit prefix share their first $L$ bits, which leaves $2^{32-L}$ addresses in the block. Prefixes are written in "addr/prefix" notation. For example, `128.13.0.0/16` is a 16-bit prefix containing $2^{32-16} = 65536$ addresses.

Originally IP addresses came in fixed-size class blocks:

- Class A: $2^{24}$ addresses
- Class B: $2^{16}$ addresses
- Class C: $2^{8}$ addresses

Allocation still works in blocks, but class boundaries are ignored in favor of CIDR, Classless Inter-Domain Routing ([RFC 4632](https://datatracker.ietf.org/doc/html/rfc4632)), which allows prefixes of any length.

For `128.13.0.0/16`, the first 16 bits name the network and the rest name the host:

```plaintext
        Network                Host
+----------+----------+----------+----------+
| 10000000 | 00001101 |   ....   |   ....   |
+----------+----------+----------+----------+
```

## IP datagram forwarding

Before sending a packet, a host checks whether the destination IP is on the same network by matching the subnet. If it is, the host sends the packet directly over the link layer, using [[systems/networks/3-network/ARP|ARP]] to resolve the IP address to a MAC address. Otherwise it sends the packet to its default gateway, a router.

The router then forwards the packet to its next hop based on the destination IP and the router's forwarding table. In pseudocode:

```text
if NetworkNum of destination == NetworkNum of one of my interfaces:
    deliver packet to destination over that interface (using ARP)
else if NetworkNum of destination is in my forwarding table:
    deliver packet to the NextHop router for that entry
else:
    deliver packet to default router
```

### Longest prefix match

With CIDR, several forwarding table entries can match the same destination. A `/16` and a more specific `/24` inside it can both contain the address. The router selects the longest matching prefix, which is the most specific one, and forwards to its next hop:

```text
best = default route
for each entry in the forwarding table:
    if (destination & entry.Mask) == entry.NetworkNum:
        if entry.Mask is longer than best.Mask:
            best = entry
deliver packet to best.NextHop
```

> [!example] Longest prefix match
> Suppose the table holds `128.13.0.0/16 -> A` and `128.13.42.0/24 -> B`. A packet for `128.13.42.7` matches both entries, and the `/24` is selected because it is more specific, so the packet goes to B. A packet for `128.13.7.9` matches only the `/16` and goes to A.

## Related notes

- [[systems/networks/3-network/routing|routing]]
- [[systems/networks/3-network/ARP|ARP]]
- [[systems/networks/3-network/ICMP|ICMP]]
- [[systems/networks/3-network/networking-services|networking services]]
