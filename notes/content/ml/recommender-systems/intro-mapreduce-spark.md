---
title: Distributed Computing for Data Mining
aliases:
  - recc-sys/intro-mapreduce-spark
category: Recommender Systems
tags:
  - data mining
  - distributed file systems
  - commodity hardware
  - mapreduce
  - hadoop
  - spark
  - batch-processing
date: 2024-03-26
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: How MapReduce and Spark process datasets too large for one machine, and their use in recommender systems for feature generation, joins, and large-scale preparation of training data.
sources:
  - title: Dean & Ghemawat (2004), MapReduce - Simplified Data Processing on Large Clusters
    url: https://static.googleusercontent.com/media/research.google.com/en//archive/mapreduce-osdi04.pdf
    type: paper
  - title: Zaharia et al. (2012), Resilient Distributed Datasets - A Fault-Tolerant Abstraction for In-Memory Cluster Computing
    url: https://www.usenix.org/conference/nsdi12/technical-sessions/presentation/zaharia
    type: paper
  - title: HDFS Architecture
    url: https://hadoop.apache.org/docs/stable/hadoop-project-dist/hadoop-hdfs/HdfsDesign.html
    type: docs
---

MapReduce and Spark are programming models, with their runtimes, for batch computation over datasets partitioned across a cluster of machines. The runtime handles scheduling, data locality and recovery from machine failures, and the program specifies only the transformations to apply.

Large recommender systems depend on such batch systems for log joins, feature aggregation, negative sampling, embedding preparation, and retraining at a scale that does not fit on one machine. Recommender papers often describe the model and omit the batch processing that produced its training table.

## The Setting

Data mining is the process of extracting useful structure from large datasets. In recommender systems it includes:

- aggregating user histories
- computing co-occurrence tables
- building candidate pools
- generating supervised training examples
- joining delayed labels back to impressions

The data is stored on clusters of commodity machines. At that scale machine failures occur routinely, so the system must tolerate them.

Replicating data across machines provides durability. Network bandwidth is the second constraint. Moving terabytes over the network is slow and costly, so these systems place the computation on or near the machines that hold the data.

The resulting systems have two layers:

- **Storage**: a distributed file system such as HDFS
- **Computation**: an execution model such as MapReduce or Spark

## Distributed File Systems

HDFS is designed for:

- very large files
- append-heavy workloads
- large streaming reads

Files are split into large blocks, typically replicated across machines and racks. A master node tracks metadata. Clients query the master for block locations and then read from the data nodes directly.

The design suits recommender workloads because offline jobs consist largely of full scans over logs and fact tables. It performs poorly for small random reads and well for jobs that read an entire dataset, aggregate it and write a new table.

## MapReduce

MapReduce is a programming pattern built around three logical steps:

1. map records into key-value pairs
2. group values by key
3. reduce each key's values into an output

The model is restrictive, and in exchange the runtime handles the details of distributed execution:

- scheduling
- retries
- locality
- fault recovery

### Example: Co-Occurrence Counts

A recommender job that computes item-item co-watch counts emits all co-occurring item pairs for each user session in the map step, shuffles by pair, and sums the counts in the reduce step. The job has the same structure as word count, with more severe key skew.

## Spark

Spark relaxes the restrictions of MapReduce. In place of one fixed map-shuffle-reduce pipeline, it supports a DAG of transformations over distributed datasets.

The core abstraction is the RDD, an immutable distributed collection whose lineage records how it was built. If a partition is lost, Spark can recompute it.

Several of its properties suit recommender workloads:

- in-memory caching for iterative jobs
- richer joins and filters
- easier expression of multi-stage pipelines
- built-in libraries for SQL, graph, and ML work

Recommender preprocessing is often iterative. A pipeline builds one table, joins it to another, filters, bucketizes and resamples, then repeats. Spark expresses such multi-stage pipelines more directly than classic MapReduce.

## Where Recommender Teams Use This

Batch jobs in recommender systems include the following:

- aggregate rolling user features
- build item popularity and freshness tables
- compute training examples for retrieval and ranking
- sample negatives
- backfill delayed conversions or watch time
- export item embeddings into an ANN index

Production failures in recommender systems originate in this layer more often than in the model definition.

## Spark Versus Hadoop MapReduce

- **MapReduce** is simpler and robust for pure one-pass batch aggregation.
- **Spark** is more expressive and usually faster for iterative pipelines and repeated reuse of intermediate state.

For recommender pipelines, Spark is generally the better fit, because feature pipelines, joins, and sampling logic are rarely single-pass jobs.

## Data Systems Behind Training

Training on billions of examples, as recommender papers report, requires a batch data system to produce those examples. In recommender systems, the model is often a small fraction of the total engineering effort.

## Related notes

- [[systems/distributed-systems/bigtable|Bigtable, A Distributed Storage System for Structured Data]]
- [[systems/databases/distributed-data/preface|Scalable Distributed Data Systems]]

## Sources

- [Dean & Ghemawat (2004), MapReduce: Simplified Data Processing on Large Clusters](https://static.googleusercontent.com/media/research.google.com/en//archive/mapreduce-osdi04.pdf)
- [Zaharia et al. (2012), Resilient Distributed Datasets: A Fault-Tolerant Abstraction for In-Memory Cluster Computing](https://www.usenix.org/conference/nsdi12/technical-sessions/presentation/zaharia)
- [HDFS Architecture](https://hadoop.apache.org/docs/stable/hadoop-project-dist/hadoop-hdfs/HdfsDesign.html)
