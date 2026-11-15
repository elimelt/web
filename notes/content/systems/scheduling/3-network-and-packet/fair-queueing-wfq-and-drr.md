---
title: Fair Queueing, WFQ, and DRR
category: Scheduling
tags:
  - scheduling
  - packet scheduling
  - fair queueing
  - wfq
  - drr
  - fairness
date: 2026-07-31
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: Flow fairness in packet schedulers, from max-min fairness and bit-by-bit round robin through the virtual finish times of weighted fair queueing to deficit round robin, with worked traces, a verified simulation and a comparison of latency, fairness and complexity.
sources:
  - title: "Analysis and Simulation of a Fair Queueing Algorithm"
    url: https://dl.acm.org/doi/10.1145/75247.75248
    type: paper
  - title: "Efficient Fair Queueing Using Deficit Round Robin"
    url: https://dl.acm.org/doi/10.1145/217391.217453
    type: paper
  - title: "Computer Networks: A Systems Approach"
    url: https://book.systemsapproach.org/
    type: textbook
---

Fair queueing is a class of packet scheduling disciplines for an output link shared by several flows, in which each flow has its own queue and the scheduler selects packets so that the link's bandwidth is divided according to max-min fairness, optionally weighted. The reference is a fluid model, bit-by-bit round robin, in which every backlogged flow receives an equal share of the link at every instant.

Implementations approximate the fluid model at different costs. [WFQ](https://dl.acm.org/doi/10.1145/75247.75248) simulates it and transmits packets in order of their virtual finish times, at $O(\log n)$ per packet; [DRR](https://dl.acm.org/doi/10.1145/217391.217453) approximates it with per-flow byte budgets at $O(1)$ per packet. FIFO, which keeps a single queue, has the lowest cost and provides no fairness between flows.

## Max-Min Fairness and FIFO

An allocation is **max-min fair** if no flow's share can be increased without decreasing the share of a flow that already has less: small demands are satisfied fully, and the remainder is divided evenly among the unsatisfied flows. On one link, three flows demanding (2, 4, 10) Mbps of a 9 Mbps link receive (2, 3.5, 3.5): the demand below the fair share is met exactly, and the remainder is divided equally.

FIFO does not allocate bandwidth in this way. Service order is arrival order, so **bandwidth is proportional to bytes enqueued**: a flow that sends faster, or with larger packets, receives more of the link, and the latency of a well-behaved flow is determined by the backlog that the most aggressive flow keeps in the shared queue. [Demers, Keshav, and Shenker](https://dl.acm.org/doi/10.1145/75247.75248) state the goal of fair queueing as this isolation: a source should not be able to increase its share at the expense of others. Nagle's earlier proposal, one queue per flow served packet by packet in round robin, provides isolation without fairness, since a flow sending 1000-byte packets receives 10x the bandwidth of one sending 100-byte packets when each "turn" is one packet regardless of size.

## Bit-by-Bit Round Robin and Virtual Time

The reference model removes the dependence on packet size by reducing the unit of service to one bit: **bit-by-bit round robin** sends one bit from flow 1, one from flow 2, and so on. In the fluid limit this is generalized processor sharing (GPS): each of the $n$ active flows progresses at rate $C/n$, which is the processor-sharing model of [[systems/operating-systems/v2-concurrency/7-uniprocessor-scheduling|CPU scheduling]] with packets for jobs.

GPS cannot be implemented on a link that transmits whole packets, but it can be *simulated*. **Virtual time** $V(t)$ is the number of bit-rounds completed by time $t$; it advances at rate $C / n(t)$, more slowly when more flows are active. A packet of length $L$ that the fluid system would begin serving at virtual time $S$ finishes at virtual time $S + L$. This is the packet's **virtual finish time**, which can be computed on arrival.

## Weighted Fair Queueing

WFQ transmits packets in increasing order of virtual finish time, giving flow $i$ weight $w_i$. For packet $k$ of flow $i$:

$$
F_i^k = \max(F_i^{k-1}, V(a_i^k)) + \frac{L_i^k}{w_i}
$$

where $a_i^k$ is arrival time and $L_i^k$ packet length. The $\max$ selects between the case of a backlogged flow, whose packet starts when its previous packet finishes, and that of an idle flow, whose packet starts at the current virtual time. Division by $w_i$ makes the packets of a weight-2 flow complete virtual rounds twice as fast, so bandwidth is proportional to weight.

Worked trace (computed in the repo venv): flows A (3 x 1000 B), B (3 x 600 B), C (10 x 100 B) all backlogged at $V = 0$, equal weights. Finish times: A = 1000, 2000, 3000; B = 600, 1200, 1800; C = 100, 200, ..., 1000. Transmission order: C's first five packets (F = 100-500), then B's first (600) and C's sixth (600), interleaving so that after any prefix each flow has received nearly equal *bytes*; all ten of C's small packets are sent before A's second large packet. Under FIFO with A enqueued first, C's entire flow waits behind 3000 bytes of A.

A WFQ packet finishes at most $L_{\max}/C$ later than it would under fluid GPS (the Parekh-Gallager bound). For weighted flows this gives per-flow worst-case delay bounds, on which link-level QoS guarantees are built.

The cost lies in the sorted structure: a priority queue over the next finish times of active flows costs $O(\log n)$ per packet, plus virtual-time bookkeeping ($n(t)$ changes on every arrival/departure). At line rate, with a minimum-size packet every ~50 ns, this cost exceeded the capacity of 1990s router hardware, and for this reason pure WFQ is implemented in software schedulers and not in hardware fast paths.

## DRR

[Deficit Round Robin](https://dl.acm.org/doi/10.1145/217391.217453) approximates fair queueing at $O(1)$ per packet. Each flow has a quantum $Q_i$ (its per-round byte budget) and a deficit counter $D_i$ (unspent budget). Each round, for each active flow:

1. add $Q_i$ to $D_i$
2. while the head packet fits ($L \le D_i$): send it, subtract its size
3. move to the next flow; keep the leftover deficit **only if the queue is nonempty** (reset to 0 on empty, so idle flows cannot accumulate credit)

```python
for flow in active_flows:
    flow.deficit += flow.quantum
    while flow.queue and flow.queue[0].size <= flow.deficit:
        pkt = flow.queue.pop(0)
        send(pkt)
        flow.deficit -= pkt.size
    if not flow.queue:
        flow.deficit = 0
```

The carried-over deficit is the essential mechanism. A flow with large packets accumulates credit across rounds until a packet fits, so its share does not depend on packet size; DRR is Nagle's round robin with the size bias removed.

Trace with the same three flows, $Q = 500$ (simulated in the repo venv, the loop above verbatim). Round 1: A accumulates 500 (< 1000, sends nothing), B accumulates 500 (< 600), and C sends five 100 B packets, which exhausts its deficit. Round 2: A's deficit reaches 1000 and its first 1000 B packet is sent; B sends its first 600 B packet (deficit 400); C sends its remaining five. Round 3: B's second packet (deficit 300). By round 6 all 5800 bytes are out, and cumulative bytes per round track the equal-share line to within one packet. The Shreedhar-Varghese fairness theorem states this precisely: over any interval in which two flows are both backlogged, their normalized service differs by $O(L_{\max} + Q)$, a constant, whereas under FIFO the difference is unbounded, provided $Q \ge L_{\max}$, which is also the condition for $O(1)$ work per packet (every visited flow sends at least one packet per round).

DRR remains bursty at the granularity of a round: a flow can receive its whole allocation for a round back-to-back rather than interleaved, so its short-term delay jitter is higher than under WFQ. This is the cost of removing the sorted queue.

## FIFO vs WFQ vs DRR

| | FIFO | WFQ | DRR |
| --- | --- | --- | --- |
| Fairness | none; proportional to aggression | weighted max-min, tight bound | max-min within $O(L_{\max}+Q)$ per interval |
| Delay for mice | unbounded (behind elephants) | near-GPS, per-flow bounds | good, but round-granularity jitter |
| Isolation | none | per-flow | per-flow |
| Per-packet cost | $O(1)$ | $O(\log n)$ + virtual clock | $O(1)$ if $Q \ge L_{\max}$ |
| State | one queue | per-flow queue + sorted finish times | per-flow queue + one counter |
| Used in | default everywhere | software qdiscs, QoS edges, Linux CFS (as virtual runtime over threads) | hardware routers, `fq_codel`-family schedulers |

When per-flow state is too large, **stochastic fair queueing** hashes flows into a fixed set of queues, accepting occasional collisions; Linux's `fq_codel` combines that with per-queue [[systems/scheduling/4-cluster-and-datacenter/stragglers-speculation-and-overload|overload-aware]] dropping.

## Summary

- Max-min fairness is the objective; FIFO does not achieve it because its service order follows the rate at which each flow enqueues data.
- WFQ simulates the fluid system and transmits packets by virtual finish time, at $O(\log n)$ per packet.
- DRR uses a byte budget and a carry-over counter to achieve fairness within a constant at $O(1)$ per packet.
- The same sequence of fluid model, virtual-time simulation and quantized approximation appears in CPU scheduling as processor sharing, stride scheduling/CFS and round robin.

## Related Notes

- [[systems/networks/4-transport/TCP|TCP]]
- [[systems/networks/2-direct-links/multiple-access|Multiple Access]]
- [[systems/scheduling/4-cluster-and-datacenter/cluster-scheduling-and-dominant-resource-fairness|Cluster Scheduling and DRF]]

