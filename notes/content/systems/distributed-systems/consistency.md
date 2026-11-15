---
title: Distributed Systems Consistency Models
aliases:
  - distributed-systems/consistency
category: Distributed Systems
tags:
  - consistency-models
  - linearizability
  - sequential-consistency
  - causal-consistency
  - paxos
date: 2024-05-06
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: Definitions of consistency models from strong to eventual, a comparison table, operation histories that separate linearizability, sequential and causal consistency, and serializability, session guarantees, Lamport's register semantics, and the coordination that stronger models require.
sources:
  - title: "On Interprocess Communication (Lamport, 1986)"
    url: https://lamport.azurewebsites.net/pubs/interprocess.pdf
    type: paper
  - title: Herlihy and Wing (1990), Linearizability - A Correctness Condition for Concurrent Objects
    url: https://cs.brown.edu/~mph/HerlihyW90/p463-herlihy.pdf
    type: paper
  - title: Jepsen, Consistency Models
    url: https://jepsen.io/consistency
    type: docs
---

**Consistency** is the allowed semantics of operations that mutate a data store or shared object. A consistency model specifies the interface of a system rather than its implementation, and serves as a contract between the programmer and the implementer. An **anomaly** is a violation of the consistency semantics of the system.

| Type                 | Description                               |
|----------------------|-------------------------------------------|
| Strong Consistency   | The system behaves as if there is a single server. Systems that maintain a single consistent log of operations are often strongly consistent. |
| Weak Consistency     | Definitions vary; broadly, any model weaker than strong consistency.  |
| Eventual Consistency | Weak consistency with any anomalies guaranteed to be temporary. |

Database transaction isolation levels use the same vocabulary with different definitions. The correspondence is given under [Sequential consistency](#sequential-consistency), and the isolation levels themselves are treated in [[systems/databases/transactions-serializability-isolation|Transactions, Serializability, and Isolation Levels]].

## The models at a glance

Each model is a set of histories the system may exhibit; stronger models permit fewer. The [Jepsen hierarchy](https://jepsen.io/consistency) maps the containment relations among them. The table compares the models most often encountered in practice.

| Model | Real-time order? | Single total order? | Respects causality? | Multi-object? | Coordination needed |
|---|---|---|---|---|---|
| Linearizability | yes | yes (per object) | yes | no | quorum per operation |
| Sequential | no | yes | yes | no | total order broadcast |
| Serializability | no | yes (of transactions) | not necessarily | yes | concurrency control |
| Strict serializability | yes | yes (of transactions) | yes | yes | both of the above |
| Causal | no | no | yes | can be | metadata only (vector clocks) |
| Session guarantees | no | no | per-session only | no | sticky sessions / versions |
| Eventual | no | no | no | no | none (anomalies temporary) |

Two of the names are misleading. **Serializability is not "sequential consistency for databases".** It permits executing transactions in an order that contradicts real time (a transaction started *after* another committed may serialize *before* it), unless the stronger and more costly strict serializability is provided. **Linearizability is per-object.** A system can be linearizable on every key yet exhibit non-serializable multi-key behavior, which includes the write skew described in [[systems/databases/mvcc-snapshot-isolation|MVCC and Snapshot Isolation]].

## Histories that separate the models

Notation: `P1: w(x,1)` means process P1 writes 1 to x; time runs left to right; `|--|` spans are operation durations. Following [Herlihy and Wing](https://cs.brown.edu/~mph/HerlihyW90/p463-herlihy.pdf), a history is linearizable if each operation appears to take effect atomically at some point between its start and end.

**Linearizable vs. not.** x starts at 0:

```plaintext
P1:  |-- w(x,1) --|
P2:                  |-- r(x) -> 0 --|
```

P2's read *begins after* P1's write completes, yet returns the old value. No assignment of linearization points can explain this, because the write's point must precede the read's, so the history is not linearizable. It **is** sequentially consistent, because the total order `r(x)->0, w(x,1)` respects each process's program order. The history isolates the difference between the two models. Sequential consistency permits an order that contradicts real time, and linearizability does not. A stale read from a replica produces exactly this history.

**Sequentially consistent vs. not.** Both start at 0:

```plaintext
P1: w(x,1)         P3: r(x)->1, r(y)->0
P2: w(y,1)         P4: r(y)->1, r(x)->0
```

P3 observes x's write before y's; P4 observes y's write before x's. Any single total order puts one of the writes first, contradicting one reader, so the history is not sequentially consistent. The two writes are concurrent, so *causal* consistency permits this history, which marks the gap between causal and sequential consistency.

**Causal vs. eventual.** The reply-before-post anomaly:

```plaintext
P1: w(post, "question")
P2: r(post)->"question", w(reply, "answer")     (reply caused by post)
P3: r(reply)->"answer", r(post)->null           (!!)
```

P2's reply is causally downstream of P1's post (P2 read it first). Causal consistency forbids P3 seeing the reply without the post; eventual consistency permits it, promising only that P3 *eventually* sees both. This anomaly complicates programming against eventually consistent systems. Causal systems prevent it by tracking the happens-before relation of [[systems/distributed-systems/ordering-events-in-distributed-systems|ordering events]], which requires metadata but no coordination.

**Serializable vs. strictly serializable.** T1 reads x then writes y; T2 writes x. T2 commits at 10:00; T1 starts at 10:05 and reads the *pre-T2* value of x. The serial order "T1 then T2" explains the reads, so the execution is serializable, even though T1 started after T2 committed in real time. Under strict serializability the real-time commit order applies, and T1's read would be an anomaly. Backup restores and reads from snapshots produce this pattern, which plain serializability permits.

## Why the model matters

Consider coordinating two processes through a KV store:

```python
def Produce(key, lock, command):
  result = application.execute(command)
  storage.put(key, result)
  storage.put(lock, True)

def Consume(key, lock):
  while storage.get(lock) is False:
    pass
  return storage.get(key)
```

Under strong consistency this protocol is correct. Under eventual consistency, and in particular in any system without multi-key transactions, the consumer might observe the write to `lock` before the write to `key`, and read a stale or missing result.

## Formalization

Lamport's [On Interprocess Communication](https://lamport.azurewebsites.net/pubs/interprocess.pdf) develops the theory. For a given RPC, the request starts at time $t$ and the reply returns at $t + x$. What happens during $(t, t + x)$ is unknown to the client, since the request or reply could be lost and retransmitted, and intermediate coordination sometimes has to take place.

With a single server the exact time at which the operation takes effect is still unknown, but it lies at some point within $(t, t + x)$. Weaker models relax this, sometimes allowing different readers to see different results concurrently.

Systems adopt weaker models because of the following tradeoffs.

- Performance: consistency requires coordination, so stronger consistency generally increases latency and reduces throughput
- Availability: if a client is offline or the network partitions, strong consistency may be impossible to serve
- Programmability: weaker models are harder to reason about and program against

### Lamport's register semantics

Registers hold a single value. Define $r_i$ as the $i$th read and $w(v)$ as a write of value $v$. Each operation has a start time and an end time.

- A read is **safe** if it is not concurrent with any write, and thus obtains the previously written value.
- A read is **regular** if it is either safe, or, when concurrent with a write, obtains either the old or the new value.
- Reads and writes are **atomic** if operations are safe, or if reads and writes behave as if they occur in some definite order.

| Semantics | Constraints          |
|-----------|----------------------|
| safe      | $r_1 \to v_1$         |
| regular   | $r_1 \to v_1 \land (r_2 \to v_1 \lor r_2 \to v_2) \land (r_3 \to v_1 \lor r_3 \to v_2)$ |
| atomic    | $r_1 \to v_1 \land (r_2 \to v_1 \lor r_2 \to v_2) \land (r_3 \to v_1 \lor r_3 \to v_2) \land (r_2 \to v_2 \implies r_3 \to v_2)$ |

```plaintext
            r1           r2     r3
          |----|       |----| |----|
   w(v1)                w(v2)
|------|             |---------|
```

## Linearizability

A **linearizable** system is one in which operations appear to occur in a single global order consistent with real time. Not all systems enforce linearizability.

To serve a linearizable read from a Paxos leader, the leader must first verify it is still the leader at the time of the read. Otherwise another leader may have taken over and committed writes with a majority that excludes the old leader. One way to verify is to wait for the leader to successfully execute some other request, which only succeeds while it holds leadership.

### Linearizable sharding with Paxos

Linearizability across shards requires the following.

- All operations from the same node occur in order
- All operations to the same shard occur in order
- All operations complete between the request send and the response receive

Batched requests complicate these conditions. Splitting a batch into a pipeline across shards discards the original order of the batch, so preserving linearizability eliminates the parallelism of the pipeline. This cost is one reason systems adopt weaker models.

## Weaker models

### Sequential consistency

**Sequential consistency** requires all operations to execute in some total order consistent with the order each process issued them, without requiring that order to match real time. It permits stale reads, while still guaranteeing every reader sees some prefix-consistent view of the system.

Sequential consistency and **serializability** are frequently conflated, but they differ in two respects. Sequential consistency concerns single operations on single objects and preserves per-process program order; serializability concerns multi-operation transactions over many objects and does *not* by itself impose any real-time constraint. The combination of serializability with a real-time constraint is strict serializability, which Spanner calls "external consistency." The database isolation levels (read committed, snapshot isolation, serializable) describe a different property, the set of anomalies that transactions may observe, and are treated in [[systems/databases/transactions-serializability-isolation|Transactions, Serializability, and Isolation Levels]].

### Snapshot reads

Snapshot reads give a consistent view of global state at some point, while allowing that point to lag the present. Operations must still be serializable, but reads may return stale data.

- All reads in a transaction come from the same snapshot
- The client can define how stale is too stale for its use case

One implementation on top of Paxos, ignoring sharding:

1. The primary defines the update order in the log
2. Shadow replicas apply changes in that order
3. Each replica lags the primary by some variable amount
4. A snapshot read executes entirely at a single replica
5. If a replica crashes mid-transaction, the transaction restarts at another snapshot replica

### Causal consistency

- Causally related reads and writes (ordered by the happens-before relation) must be observed in that order
- Concurrent writes can be seen in different orders on different nodes
- Linearizability implies causal consistency

### Processor consistency

- Writes done by the same process are seen in that order
- Writes by different processors can be seen in different orders by different readers

### Memory barrier / fence

A **fence** marks a point such that all preceding operations happen before it and all subsequent operations happen after it. On either side of the fence, order is not enforced. If every operation is fenced, the system is linearizable. POSIX file operations follow this model, and multi-cache systems use fences to enforce coherence at chosen points.

## Session guarantees

Between causal and eventual sits a family of client-centric guarantees (Terry et al., from the Bayou project) that constrain only what *one session* observes, saying nothing about agreement across clients:

- **Read your writes**: a session's reads reflect its own earlier writes. A typical violation occurs when a user saves a profile edit, refreshes, and sees the old profile, because the write went to the primary and the read went to a stale replica.
- **Monotonic reads**: once a session has seen a value, later reads see it or something newer, so the state a session observes never moves backward.
- **Monotonic writes**: a session's writes apply everywhere in issue order.
- **Writes follow reads**: a write issued after reading some value is ordered after that value everywhere; this is the per-session part of the reply-before-post guarantee.

All four together are equivalent to causal consistency for that session's operations. They can be implemented with little overhead, by routing a session stickily to one replica or by having clients carry version vectors and skip replicas that lag their high-water mark. Several products described as eventually consistent provide session guarantees, for example Azure Cosmos DB's session consistency level, which tracks a session token per client. In such systems users observe far fewer anomalies than raw eventual consistency permits.

## Why stronger models cost coordination

The coordination listed in the table's rightmost column follows from the definitions of the models, not from particular implementations.

- **Linearizability requires contacting a quorum on the critical path.** A read served locally, without checking that no newer write committed elsewhere, can produce the stale-read history above; hence leader reads with leases, read-index rounds in Raft, or quorum reads in Dynamo-style systems. Each adds a round trip that an eventually consistent read does not incur. The CAP theorem is the partition-time corner of this: a partitioned minority cannot serve linearizable operations at all, and the attainable-performance version (Attiya and Welch) shows latency proportional to network delay bounds even *without* partitions.
- **Sequential consistency requires agreement on one order**, through total order broadcast, which is equivalent to consensus, but not on real-time freshness, so reads can be stale but are ordered.
- **Causal consistency is the strongest model attainable without giving up availability under partition**: it requires only that metadata (version vectors) travel with the data, with no synchronous coordination. Its cost is the growth of that metadata.
- **Eventual consistency requires no coordination** and leaves the handling of anomalies to the application. [[systems/distributed-systems/crdts|CRDTs]] retain the absence of coordination and make convergence automatic instead of ad hoc.

Mixed-consistency systems follow from these costs. They provide linearizable operations for the few paths that require them (uniqueness, counters that gate real resources, leader election through [[systems/distributed-systems/failure-detectors-leases-leader-election|leases and fencing]]), session or causal guarantees for user-facing reads, and eventual consistency for bulk data. In such systems the consistency model is chosen per operation.

## Related notes

- [[systems/distributed-systems/clocks|clocks]]
- [[systems/distributed-systems/ordering-events-in-distributed-systems|ordering events in distributed systems]]
- [[systems/distributed-systems/distributed-cache-coherence|distributed cache coherence]]
- [[systems/distributed-systems/managing-critical-state|managing critical state]]
- [[systems/distributed-systems/crdts|CRDTs and conflict-free replication]]
- [[systems/databases/transactions-serializability-isolation|transactions, serializability, and isolation levels]]
- [[ml/serving-systems/distributed-ml-runtimes|distributed ML runtime architecture]] (staleness in asynchronous parameter servers)
