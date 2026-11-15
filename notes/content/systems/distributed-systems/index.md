---
title: Distributed Systems
category: Distributed Systems
tags:
  - distributed systems
  - replication
  - consensus
  - sharding
date: 2026-07-31
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: Overview of the distributed systems notes, from ordering and consistency to replication, consensus, and scalable services.
sources:
  - title: "Large Scale Distributed Deep Networks"
    url: https://papers.neurips.cc/paper/4687-large-scale-distributed-deep-networks.pdf
    type: paper
---

A distributed system is a set of machines that communicate over a network and coordinate to provide a service, with no machine able to observe the whole system at once. The central question in its design is how to maintain useful global behavior under that limitation. A suggested reading order begins with [[systems/distributed-systems/clocks|clocks]], then [[systems/distributed-systems/ordering-events-in-distributed-systems|event ordering]], then [[systems/distributed-systems/consistency|consistency]], which together supply the vocabulary of the replication and consensus notes.

Later topics include system-building patterns such as [[systems/distributed-systems/primary-backup|primary backup]], [[systems/distributed-systems/sharding|sharding]], and [[systems/distributed-systems/load-balancing|load balancing]], plus consensus notes such as [[systems/distributed-systems/paxos-intro|Paxos introduction]] and [[systems/distributed-systems/paxos-made-simple|Paxos Made Simple]].

## Entry points

- Time and ordering: [[systems/distributed-systems/clocks|clocks]], [[systems/distributed-systems/ordering-events-in-distributed-systems|ordering events]], [[systems/distributed-systems/consistent-global-state|consistent global state]]
- Replication and consistency: [[systems/distributed-systems/consistency|consistency]], [[systems/distributed-systems/crdts|CRDTs]], [[systems/distributed-systems/primary-backup|primary backup]], [[systems/distributed-systems/non-blocking-two-phase-commit|non-blocking two-phase commit]]
- Coordination: [[systems/distributed-systems/failure-detectors-leases-leader-election|failure detectors, leases, and leader election]], [[systems/distributed-systems/mutual-exclusion|mutual exclusion]]
- Scalable services: [[systems/distributed-systems/load-balancing|load balancing]], [[systems/distributed-systems/sharding|sharding]], [[systems/distributed-systems/scaling-web-services|scaling web services]]
- Case studies: [[systems/distributed-systems/google-file-system|Google File System]], [[systems/distributed-systems/bigtable|Bigtable]], [[systems/distributed-systems/dynamo-db|Dynamo]]
- ML training runtimes: [[ml/serving-systems/distributed-ml-runtimes|distributed ML runtime architecture]], [[ml/serving-systems/distributed-training|distributed training of LLMs]]
