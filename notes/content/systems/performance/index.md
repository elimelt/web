---
title: Performance Engineering
category: Performance Engineering
tags:
  - performance engineering
  - latency
  - throughput
  - bandwidth
date: 2026-07-31
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: Index of the performance engineering notes, with emphasis on bottleneck models and measurements.
---

Performance engineering is the measurement and modeling of a system's latency, throughput and resource utilization, with the aim of identifying the resource that limits them. The notes cover the basic bottleneck model as well as case studies. [[systems/performance/latency-throughput-and-utilization|Latency, throughput, and utilization]] introduces the queueing and bottleneck vocabulary that the other notes assume.

[[systems/performance/streaming|Streaming data]] treats a concrete bandwidth-bound workload, and the [[systems/performance/streaming_benchmarks/cache_line_efficiency/README|cache-line efficiency benchmark]] measures directly how the access pattern changes throughput.

## Notes

- Foundations: [[systems/performance/latency-throughput-and-utilization|latency, throughput, and utilization]], [[systems/performance/tail-latency-percentiles|tail latency, percentiles, and queueing distributions]], [[systems/performance/amdahl-gustafson-scalability|Amdahl, Gustafson, and scalability limits]]
- Measurement: [[systems/performance/profiling-tracing-flame-graphs|profiling, tracing, and flame graphs]]
- Bandwidth and streaming: [[systems/performance/streaming|streaming data]], [[systems/performance/streaming_benchmarks/cache_line_efficiency/README|cache-line efficiency benchmark]]
- Case study: [[systems/performance/efficiently-implementing-state-pattern-JVM|efficiently implementing the state pattern on the JVM]]
