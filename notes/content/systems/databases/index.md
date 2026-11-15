---
title: Databases and Data-Intensive Systems
category: Database Systems
tags:
  - database systems
  - storage
  - replication
  - data models
date: 2026-07-31
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: Index of the notes on database and data-intensive systems, covering storage, data models, transactions, query processing, replication, and batch processing.
---

Database systems store, retrieve and maintain data under concurrent access and failure, and data-intensive systems compose them with caches, indexes, logs and batch or stream processors. Much of the material here follows *Designing Data-Intensive Applications* (DDIA), and the section is organized by subject so that notes on storage engines, query processing and transactions sit beside the chapter notes.

A reading order for the DDIA material is [[systems/databases/foundations/ch1-reliable-scalable-and-maintainable-applications|reliable, scalable, maintainable applications]], then [[systems/databases/foundations/ch2-data-models-and-query-languages|data models and query languages]], then [[systems/databases/foundations/ch3-storage-and-retrieval|storage and retrieval]]. The material on distributed data continues with [[systems/databases/distributed-data/ch5-replication|replication]], and the dataflow material resumes in [[systems/databases/derived-data/ch10-batch-processing|batch processing]].

## Notes

- Foundations: [[systems/databases/foundations/ch1-reliable-scalable-and-maintainable-applications|chapter 1]], [[systems/databases/foundations/ch2-data-models-and-query-languages|chapter 2]], [[systems/databases/foundations/ch3-storage-and-retrieval|chapter 3]], [[systems/databases/foundations/ch4-encoding-and-evolution|chapter 4]]
- Transactions: [[systems/databases/transactions-serializability-isolation|transactions, serializability, and isolation levels]], [[systems/databases/mvcc-snapshot-isolation|MVCC and snapshot isolation]]
- Query processing: [[systems/databases/query-planning-and-joins|query planning and join execution]]
- Distributed data: [[systems/databases/distributed-data/preface|preface]], [[systems/databases/distributed-data/ch5-replication|chapter 5]]
- Derived data: [[systems/databases/derived-data/ch10-batch-processing|chapter 10]]
