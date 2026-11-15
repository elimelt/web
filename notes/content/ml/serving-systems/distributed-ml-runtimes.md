---
title: Distributed Machine Learning Runtime Architecture
aliases:
  - llm-serving-systems/distributed-ml-runtimes
category: Machine Learning Systems
tags:
  - distributed-training
  - parameter-server
  - dataflow
  - collectives
  - machine-learning
date: 2026-08-01
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: draft
description: The runtime abstractions underlying LLM training frameworks (parameter servers, dataflow-graph runtimes with device placement, and collective-based runtimes), compared by communication pattern, staleness and fault recovery.
sources:
  - title: "Large Scale Distributed Deep Networks (DistBelief)"
    url: https://papers.neurips.cc/paper/4687-large-scale-distributed-deep-networks.pdf
    type: paper
  - title: "TensorFlow: A System for Large-Scale Machine Learning"
    url: https://arxiv.org/abs/1605.08695
    type: paper
  - title: "Horovod: fast and easy distributed deep learning in TensorFlow"
    url: https://arxiv.org/abs/1802.05799
    type: paper
  - title: "Megatron-LM: Training Multi-Billion Parameter Language Models Using Model Parallelism"
    url: https://arxiv.org/abs/1909.08053
    type: paper
---

The runtime of a distributed training system determines where model state is stored, how computation is placed on devices, and how updates are communicated between workers. Three runtime abstractions have been used for neural network training: parameter servers, dataflow-graph execution with device placement, and collective-based runtimes.

Current LLM training frameworks (Megatron-LM, DeepSpeed, PyTorch FSDP) are built on collective-based runtimes, and the abstractions they replaced predate them by up to a decade. For dense-model training the field moved from the first two abstractions to the third. The earlier ideas remain in use (parameter servers for embeddings, dataflow graphs for compilers) inside the systems described in [[ml/serving-systems/distributed-training|Distributed Training of Large Language Models]].

## Parameter servers

[DistBelief](https://papers.neurips.cc/paper/4687-large-scale-distributed-deep-networks.pdf) (Dean et al., NeurIPS 2012) introduced the parameter server pattern for training with "tens of thousands of CPU cores": a set of server machines holds the authoritative copy of the model's parameters, and worker machines pull parameters, compute gradients on a data shard, and push gradient updates back.

**Synchronous** parameter-server training waits for all workers to report gradients each step before updating, equivalent in effect to a centralized AllReduce; it makes progress deterministic but ties throughput to the slowest worker. **Asynchronous** training (DistBelief's Downpour SGD) lets workers pull and push whenever ready, with no barrier, so a fast worker can compute several gradients using a parameter version that later workers already made stale. This effect is **staleness**, in which a worker's gradient step is applied to parameters that have changed since the worker read them. DistBelief tolerated staleness in exchange for throughput. It reported training a network 30x larger than previously reported in the literature, with state-of-the-art performance on ImageNet, and substantially faster training of a production speech model. Bounded-staleness variants lie between the two. They allow asynchronous updates but block a worker that falls more than $k$ versions behind the server's current parameter version, giving up part of the throughput gain in exchange for a bound on the staleness of any single gradient.

DistBelief's second algorithm, Sandblaster, generalizes the same server/worker split to batch optimization methods like L-BFGS rather than only SGD, which shows that the parameter-server abstraction concerns *where state lives and how updates flow* and is independent of the optimizer.

The parameter server's structural weakness, inherited by the "centralized" implementation described in [[ml/serving-systems/parallelism|Parallelism]], is that the server set is both a bandwidth bottleneck (every worker's gradients funnel through it) and a single point of failure unless replicated. It scales well when parameters are sparse and updates touch only a slice of them (embedding tables, where each worker only pulls/pushes the rows it needs), which is why parameter servers persisted in recommendation-system training long after dense-model training moved to collectives.

## Dataflow-graph runtimes

[TensorFlow](https://arxiv.org/abs/1605.08695) (Abadi et al., 2016) generalizes further. It represents the whole computation, including parameter updates, as a dataflow graph of operators and tensors, and the runtime places graph nodes onto the available devices (CPU, GPU, TPU), inserting communication ops automatically at placement boundaries. The paper presents this design as a response to the parameter-server model: "whereas in previous 'parameter server' designs the management of shared state is built into the system, TensorFlow enables developers to experiment with novel optimizations and training algorithms." Shared state (variables) becomes an ordinary node in the graph rather than a privileged server-side abstraction, so a user can express a parameter server, an AllReduce-style scheme or another scheme entirely as graph structure.

Device placement is a scheduling problem. Given a graph, a set of heterogeneous devices, and per-op cost and communication estimates, the placer decides which device runs which op so as to minimize execution time or communication volume. TensorFlow's default placer used greedy heuristics, and the design's contribution is the ability to express *any* placement policy rather than an optimal placement algorithm. The flexibility has an overhead. Building and dispatching a general dataflow graph on every device requires more machinery than a fixed collective pattern, which is one reason later systems adopted more specialized designs.

## Collective-based runtimes

[Horovod](https://arxiv.org/abs/1802.05799) (Sergeev and Del Balso, 2018) narrows the abstraction deliberately. In place of general dataflow placement, it wraps each worker's existing single-GPU training script with a thin library that inserts a ring-AllReduce over gradients at each step, using NCCL for the communication. The motivation stated in the paper is that TensorFlow's default distributed mode required substantial code changes and incurred non-negligible communication overhead. Horovod is designed so that single-GPU training code needs only a small addition for gradient synchronization. Ring AllReduce splits each device's gradient tensor into $N$ chunks (for $N$ devices) and passes chunks around a ring in two phases, ReduceScatter then AllGather, so total data moved per device is independent of $N$ and each device communicates only with its two ring neighbors. This is the same AllReduce = ReduceScatter + AllGather decomposition used throughout [[ml/serving-systems/parallelism|Parallelism]].

Megatron-LM ([Shoeybi et al. 2019](https://arxiv.org/abs/1909.08053)) builds directly on this collective-based model rather than either parameter servers or general dataflow placement: tensor parallelism inserts a handful of AllReduce calls per transformer layer directly into native PyTorch code, "with the insertion of a few communication operations," and pipeline parallelism moves activations point-to-point between adjacent stages. Both are fixed, hand-chosen communication patterns rather than a placer's decision, This is the tradeoff collective-based runtimes make relative to TensorFlow-style generality. They offer less flexibility, much lower per-op dispatch overhead, and a communication pattern that a systems engineer can analyze and tune directly.

## Comparing the three for dense model training

| Property | Parameter server | Dataflow graph (TensorFlow) | Collective-based (Horovod, Megatron) |
| --- | --- | --- | --- |
| Where shared state lives | dedicated server processes | graph node like any other | replicated across workers, synced via collective |
| Communication pattern | worker <-> server, star topology | placer-chosen, can be anything | fixed collective (ring/tree AllReduce), peer-to-peer |
| Bottleneck risk | server bandwidth / single point of failure | dispatch overhead, placement quality | none structural; bounded by slowest peer at the barrier |
| Staleness options | sync, async, bounded-staleness | whatever the graph encodes | effectively synchronous (barrier at each AllReduce) |
| Best fit | sparse parameters (embeddings) | heterogeneous devices, research flexibility | dense, homogeneous GPU clusters |

Dense transformer training falls in the "dense, homogeneous GPU clusters" cell. Every parameter is used and updated on every step, so a parameter server has no sparsity to exploit, and the hardware is nearly identical across workers, so a fixed collective pattern tuned once (ring topology matched to the physical interconnect) has lower overhead than a general placer that decides placement anew for every graph. For these reasons Megatron-, DeepSpeed- and FSDP-style frameworks all adopted collectives in place of either predecessor. The choice connects directly to the tensor/pipeline/data parallelism composition in [[ml/serving-systems/distributed-training|Distributed Training of Large Language Models]].

## Checkpointing, restart, and stragglers

The runtime abstraction shapes how fault recovery works. A parameter-server system can often restart a single failed worker without disturbing others, since workers don't coordinate directly; async or bounded-staleness updates already tolerate a worker being briefly unavailable. A collective-based runtime has the opposite property: a synchronous AllReduce requires every participant, so one failed or slow GPU stalls the entire step (the straggler problem, treated generally in [[systems/scheduling/4-cluster-and-datacenter/stragglers-speculation-and-overload|Stragglers, Speculation, and Overload]]), and a hard failure requires either restarting the whole collective group from the last checkpoint or a resize-and-continue mechanism that reconstructs the process group with one fewer (or a replacement) member. This is why long collective-based training runs checkpoint frequently and treat the restart path as a first-class part of the system rather than an edge case, a tradeoff also discussed in [[ml/serving-systems/distributed-training|Distributed Training of Large Language Models]].

## An analytic trace of one step

Consider $N$ workers running collective-based synchronous data parallelism with per-worker compute time $T_{compute}$ and ring-AllReduce time $T_{comm} \approx \frac{2(N-1)}{N} \cdot \frac{|\theta|}{BW}$ for gradient tensor size $|\theta|$ bytes and per-link bandwidth $BW$ (the bandwidth term of the ring-AllReduce cost model, matching the AllReduce decomposition in [[ml/serving-systems/parallelism|Parallelism]]).

```text
worker 0: [--- compute T_c ---][-- allreduce chunk exchange (ring) --][optimizer step]
worker 1: [--- compute T_c ---][-- allreduce chunk exchange (ring) --][optimizer step]
...
worker N-1: [-compute T_c (straggler: 1.3x)-][-- waits, then allreduce --][optimizer step]
```

If every worker's compute time is identical, step time is $T_{compute} + T_{comm}$ regardless of $N$ (ring AllReduce's defining property: communication volume per device does not grow with worker count). If one worker runs at $1.3\times T_{compute}$, every other worker idles at the AllReduce barrier until it arrives, and step time becomes $1.3\,T_{compute} + T_{comm}$, so the straggler's delay lengthens the step for every worker in the cluster. The trace is analytic and not a measurement. It explains why straggler mitigation becomes more important as $N$ grows, since the probability that at least one of $N$ workers is a straggler on a given step increases with $N$ even if each worker's per-step straggler probability is fixed.

## Related notes

- [[ml/serving-systems/parallelism|Parallelism]]
- [[ml/serving-systems/distributed-training|Distributed Training of Large Language Models]]
- [[systems/distributed-systems/index|Distributed Systems]]
- [[systems/distributed-systems/consistency|Consistency Models]]
- [[systems/scheduling/index|Scheduling]]
- [[systems/performance/latency-throughput-and-utilization|Latency, Throughput, and Utilization]]
