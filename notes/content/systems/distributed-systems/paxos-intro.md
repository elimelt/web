---
title: Paxos Introduction
aliases:
  - distributed-systems/paxos-intro
category: Distributed Systems
tags:
  - paxos
  - consensus
  - distributed-systems
  - state-machine-replication
date: 2024-04-24
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: draft
description: An introduction to Paxos covering the tradeoff between safety and progress that the FLP result imposes, state machine replication as the setting for consensus, and the two phases of the core protocol.
sources:
  - title: Impossibility of Distributed Consensus with One Faulty Process (Fischer, Lynch, Paterson, 1985)
    url: https://groups.csail.mit.edu/tds/papers/Lynch/jacm85.pdf
    type: paper
  - title: Paxos Made Simple (Lamport, 2001)
    url: https://lamport.azurewebsites.net/pubs/paxos-simple.pdf
    type: paper
---

Paxos is a consensus protocol for processes that communicate over an asynchronous network and may crash. It guarantees that at most one value is chosen, and it chooses a value whenever a majority of its acceptors can communicate for long enough.

The protocol is used chiefly for state machine replication, in which a separate instance of Paxos chooses the command in each slot of a replicated log. The full derivation is given in [[systems/distributed-systems/paxos-made-simple|Paxos Made Simple]].

## FLP impossibility result

The [FLP result](https://groups.csail.mit.edu/tds/papers/Lynch/jacm85.pdf) shows that in an asynchronous system where even one process may fail, no deterministic protocol can guarantee consensus terminates. A consensus protocol therefore cannot guarantee both safety and progress, and its design must choose which of the two it preserves under all conditions.

Paxos preserves safety under all conditions. It makes progress in practice as long as a majority of nodes are available and failures cease for long enough for a round to complete.

> [!abstract] FLP in one sentence
> No deterministic protocol can guarantee both safety and liveness in an asynchronous system with even one faulty process, so every such consensus protocol must choose which property it sacrifices under adversarial conditions.

## State machine replication

State machine replication orders client operations into an append-only log, and every replica applies the log in order. Consensus is simpler when only one request is in flight at a time, so a common structure elects a leader, sends all client requests to it, and lets the leader define the ordering. If the leader fails or becomes slow, a new leader is elected, as many times as necessary. Each log slot then requires all nodes to agree on one value, and Paxos provides that per-slot agreement. Paxos also makes leader election safe, since competing would-be leaders cannot commit conflicting values.

> [!info] State machine replication
> Each log slot is decided by its own Paxos instance. The value chosen for slot i is the ith command that every replica executes.

## Paxos, the algorithm

```mermaid
sequenceDiagram
    participant P as Proposer
    participant A1 as Acceptor 1
    participant A2 as Acceptor 2
    participant A3 as Acceptor 3

    Note over P,A3: Phase 1: Prepare/Promise
    P->>A1: Prepare(n=1)
    P->>A2: Prepare(n=1)
    P->>A3: Prepare(n=1)
    A1-->>P: Promise(n=1, ⊥)
    A2-->>P: Promise(n=1, ⊥)
    A3-->>P: Promise(n=1, ⊥)
    Note over P: Majority promised, no prior value

    Note over P,A3: Phase 2: Accept/Accepted
    P->>A1: Accept(n=1, v="X")
    P->>A2: Accept(n=1, v="X")
    P->>A3: Accept(n=1, v="X")
    A1-->>P: Accepted(n=1, v="X")
    A2-->>P: Accepted(n=1, v="X")
    A3-->>P: Accepted(n=1, v="X")
    Note over P,A3: Value "X" is chosen (majority accepted)
```

```plaintext
Proposer:
  Prepare(n) -> Promise(n, n', v')
  Accept(n, v) -> Accepted(n, v)

Acceptor:
  Promise(n, n', v') -> Prepare(n)
  Accepted(n, v) -> Accept(n, v)
```

### Phase 1: Prepare

- The proposer selects a proposal number $n$ and sends `Prepare(n)` to all (or a majority) of the acceptors.
- An acceptor that has seen nothing higher than $n$ responds with `Promise(n, n', v')`, where $n'$ is the highest proposal number it has accepted and $v'$ is the value of that proposal. The promise means the acceptor will never accept a proposal numbered less than $n$.
- The proposer waits for a majority of promises before proceeding.

### Phase 2: Accept

- Once the proposer has a majority of promises, it sends `Accept(n, v)` to the acceptors, where $v$ is the value of the highest-numbered proposal reported in the promises, or the proposer's own value if no promise reported one. Adopting the highest-numbered reported value prevents an already-chosen value from being overwritten.
- Each acceptor that has not promised a higher number accepts and responds with `Accepted(n, v)`.
- Once a majority of acceptors accept, the value is chosen.

## Related notes

- [[systems/distributed-systems/paxos-made-simple|Paxos Made Simple]]
- [[systems/distributed-systems/paxos-architecture|Paxos architecture]]
- [[systems/distributed-systems/ordering-events-in-distributed-systems|event ordering]]
