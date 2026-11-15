---
title: Routing
aliases:
  - networks/3-network/routing
category: Networks
tags:
  - networks
  - routing
  - bgp
  - distance-vector
  - link-state
  - rip
  - ospf
date: 2024-02-25
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: Intra-domain routing, covering the routing table vs. forwarding table distinction, the network-as-graph model, distance vector routing with RIP, and link state routing with reliable flooding, forward search, and OSPF.
sources:
  - title: "Computer Networks: A Systems Approach"
    url: https://book.systemsapproach.org/
    type: textbook
  - title: "RFC 2453: RIP Version 2"
    url: https://datatracker.ietf.org/doc/html/rfc2453
    type: rfc
  - title: "RFC 2328: OSPF Version 2"
    url: https://datatracker.ietf.org/doc/html/rfc2328
    type: rfc
---

Intra-domain routing is the computation, by the routers of a single administrative domain, of lowest-cost paths to the destinations in that domain. The routers model the network as a weighted graph and run a distributed protocol of one of two families, distance vector or link state, to build their routing tables.

Routing between domains is a different problem, treated in [[systems/networks/3-network/BGP|BGP]].

## Routing table vs. forwarding table

Routers forward packets toward destinations outside the local network. Two tables are involved, and the distinction between them follows [Peterson & Davie](https://book.systemsapproach.org/):

- The **routing table** is the data structure the routing protocol builds. It maps network prefixes to information about how to reach them, including the next hop router and the metric the protocol computed. It is used to make routing decisions.
- The **forwarding table** is the structure consulted for every packet, so it is optimized for fast lookup. It maps a network prefix to the outgoing interface and the link-level information the router needs to transmit the frame, such as the next hop's MAC address.

The routing table changes when the routing protocol learns something new about the topology. The forwarding table is derived from it. Routing protocols build the routing table.

## The network as a graph

The network is modeled as a graph of routers (nodes) and links (edges). For simplicity the graph is taken to be undirected and weighted, where the weight of an edge is the cost of sending a packet over that link. A directed graph is more accurate in practice, since the two directions of a link can have different costs, but the undirected model is simpler to analyze.

The basic problem of routing is finding lowest-cost paths between nodes. Running Dijkstra's algorithm once (see [[algorithms/graphs-intro|graph fundamentals]]) and storing the results as the routing table would be a static computation, which has several shortcomings:

- It does not adapt to node or link failures.
- It does not accommodate new nodes or links.
- Edge costs cannot change.
- It does not scale to large networks.

Routing protocols are therefore distributed and adaptive, running independently on each router.

> [!abstract] The two families
> In **distance vector** routing, each router advertises to its *neighbors* its cost to *every destination it can reach*, and each router adopts its neighbors' advertised costs. In **link state** routing, each router advertises to *every router* the state of *its own links*, and each router computes paths from the complete map. RIP is a distance vector protocol and OSPF a link state protocol.

## Distance vector routing (RIP)

The **Routing Information Protocol (RIP)** ([RFC 2453](https://datatracker.ietf.org/doc/html/rfc2453)) is a long-established distance vector protocol. Each router exchanges routing information with its neighbors, and the routers collectively build a distributed view of the network. The update rule is the same one used by **Bellman-Ford**.

RIP operates as follows:

- **Hop count metric**: RIP counts the routers a path traverses and prefers the path with the lowest hop count.
- **Routing table**: each router keeps an entry per reachable network with its hop count and the next hop on the path.
- **Periodic updates**: routers periodically advertise their routing table entries to their neighbors, even when nothing has changed.
- **Triggered updates**: a router also sends an update immediately whenever it changes its own table.
- **Failure detection**: if a router receives nothing from a neighbor within a timeout, it marks the neighbor as down. A router can also probe its neighbors with a control message.

RIP is simple to implement and understand, its updates propagate quickly, and it works well in small networks.

Its hop-count metric ignores bandwidth and delay, so the chosen path can have low bandwidth or high delay. Distance vector protocols are prone to the counting-to-infinity problem, in which two routers repeatedly increase each other's estimate of an unreachable route one hop at a time. Split horizon mitigates it (a router does not advertise a route back to the neighbor from which it learned the route). In large networks, frequent updates impose load on the routers and convergence is slow.

> [!warning] Count to infinity
> When a destination becomes unreachable, a router that has lost its route can receive a stale advertisement from a neighbor whose path runs *through the router itself*. The two then increase each other's estimate by one hop per update, and the route is removed only when the count reaches the protocol's infinity. RIP defines 16 as unreachable for this reason, since a small infinity bounds the duration of the counting.

### Implementation

A distance vector routing table merge, adapted from [Peterson & Davie](https://book.systemsapproach.org/):

```c
#define MAX_ROUTES      128     /* maximum size of routing table */
#define MAX_TTL         120     /* time (in seconds) until route expires */

typedef struct {
    NodeAddr  Destination;    /* address of destination */
    NodeAddr  NextHop;        /* address of next hop */
    int       Cost;           /* distance metric */
    u_short   TTL;            /* time to live */
} Route;

int      numRoutes = 0;
Route    routingTable[MAX_ROUTES];

void mergeRoute (Route *new) {
    int i;
    for (i = 0; i < numRoutes; ++i) {
        if (new->Destination == routingTable[i].Destination) {
            if (new->Cost + 1 < routingTable[i].Cost)
                break; /* found a better route */
            else if (new->NextHop == routingTable[i].NextHop)
                break; /* next hop may have changed */
            else
                return;
        }
    }
    if (i == numRoutes) {
        if (numRoutes < MAX_ROUTES)
            numRoutes++;
        else
            return; /* can't fit this route in table so give up */
    }
    routingTable[i] = *new;
    routingTable[i].TTL = MAX_TTL; /* reset TTL */
    routingTable[i].Cost++;
}

void updateRoutingTable (Route *newRoute, int numNewRoutes) {
    for (int i = 0; i < numNewRoutes; ++i)
        mergeRoute(&newRoute[i]);
}
```

RIP runs on UDP port 520, and its messages carry a list of route entries:

```text
RIP Message:
    Version
    Command (request, response, update)
    Number of entries
    RIP Entry (variable size)
        Address Family Identifier
        Route Tag
        IP Address
        Next Hop IP Address
        Metric
```

RIP is a limited implementation of distance vector routing. It assigns a cost of 1 to each hop, so it computes fewest-hop paths, and a metric of 16 means unreachable, which caps usable paths at 15 hops. Most modern networks use other protocols.

## Link state routing

A distance vector router advertises its reachable destinations only to its neighbors. A link state router instead advertises the state of its own links to every router, and each router computes paths from the full map. Each node creates a **Link State Packet (LSP)** containing:

- The ID of the node that created the LSP
- A list of that node's directly connected neighbors, with the cost of the link to each one
- A sequence number, incremented each time the LSP is updated
- A time to live, decremented at each hop

These packets are **flooded** through the network, meaning each node forwards them to all of its neighbors.

### Reliable flooding

The sequence number and TTL keep flooding consistent and bounded. Adjacent nodes use ACKs and retransmissions, so an LSP reliably crosses each link. When a node already has an LSP from the same origin, it keeps the one with the higher sequence number, so stale information is discarded. On receiving a new LSP, a node stores it and forwards it to all neighbors except the one it came from.

Nodes generate new LSPs at regular intervals and whenever an adjacent node goes down. Neighbors exchange "hello" packets to indicate that they are operational, and a node that stops receiving hellos from a neighbor declares it down and generates a new LSP. The periodic LSPs should be infrequent, so that the network converges quickly after failures without consuming resources when nothing changes.

When a node receives an LSP with TTL 0, it deletes that record from its own database and floods the expired LSP so every other node deletes it too.

### Route calculation

Each node runs a shortest-path computation over its LSP database. The algorithm is Dijkstra's. With $N$ the set of nodes, $s$ the node doing the computation, $l(w,n)$ the cost of the link between $w$ and $n$, $C(n)$ the current best cost from $s$ to $n$, and $M$ the set of nodes whose cost is settled:

```text
M = {s}
for each n in N - {s}:
    C(n) = l(s,n)
while N != M:
    M = M + {w} such that C(w) is the minimum for all w in (N - M)
    for each n in (N - M):
        C(n) = MIN(C(n), C(w) + l(w,n))
```

#### Forward search

Implementations use **Forward Search**, which restates Dijkstra's algorithm with two lists, `Confirmed` and `Tentative`, whose entries are `(Destination, Cost, NextHop)`:

1. Initialize the `Confirmed` list with an entry for the computing node itself, with cost 0.
2. Call the node just added to `Confirmed` in the previous step `Next`, and select its LSP.
3. For each neighbor of `Next`, calculate the cost to reach that neighbor as the cost from the computing node to `Next` plus the cost from `Next` to the neighbor. If the neighbor is on neither list, add `(Neighbor, Cost, NextHop)` to `Tentative`, where `NextHop` is the direction in which the computing node reaches `Next`.
4. If the neighbor is already on `Tentative` with a higher cost, replace its entry with `(Neighbor, Cost, NextHop)`.
5. If `Tentative` is empty, stop. Otherwise move the lowest-cost entry from `Tentative` to `Confirmed` and go back to step 2.

### Open Shortest Path First (OSPF)

**OSPF** ([RFC 2328](https://datatracker.ietf.org/doc/html/rfc2328)) is the widely deployed link state protocol. It adds several features to basic link state routing:

- Authentication: OSPF can authenticate its messages, so an unauthorized node cannot inject false routing information.
- Hierarchy: the network partitions into **areas**, and a router requires only the topology of its own area. This is the same scaling technique that [[systems/networks/3-network/global-internet|the global Internet]] applies with autonomous systems.
- Load balancing: OSPF can assign multiple paths to the same destination and split traffic between them.

Of the five OSPF message types, type 1 is the "hello" message a router sends to its peers to indicate that it is still operational and connected. The remaining types request, send, and acknowledge link-state messages.

OSPF floods Link State Advertisements (LSAs) rather than LSPs. An LSA carries per-link information: the Link ID (typically the router ID at the far end of the link), the Link Data, and the metric, meaning the cost of the link. Type of service (TOS) information lets OSPF choose different routes for packets based on the TOS field in the IP header.

#### Metrics

The ARPANET tested different approaches to link-cost calculation, and the history illustrates the risks of load-sensitive metrics (recounted in [Peterson & Davie](https://book.systemsapproach.org/)). The original metric measured queued packets on each link, which ignored bandwidth and latency. A later version used measured delay as the load signal, which accounted for both, but it was unstable under heavy load and produced a very wide range of link values. A third revision compressed the metric range, accounted for link type, and smoothed the variation over time.

In deployed networks, metrics change rarely, if at all, and only under the control of a network administrator. Static metrics are common, typically a constant times $1/\text{link bandwidth}$.

## Related notes

- [[systems/networks/3-network/BGP|BGP]]
- [[systems/networks/3-network/global-internet|the global Internet]]
- [[algorithms/graphs-intro|graph fundamentals]]
- [[systems/networks/2-direct-links/switching|Switched Ethernet]]
