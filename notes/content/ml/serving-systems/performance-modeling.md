---
title: Performance Modeling for LLM Serving Systems
aliases:
  - llm-serving-systems/performance-modeling
category: Machine Learning Systems
tags:
  - batching
  - performance
  - roofline
  - arithmetic-intensity
  - gqa
  - kv-cache
  - machine-learning
date: 2025-05-10
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: needs-review
description: The roofline model applied to LLM serving, the critical operational intensity of the H100, and execution time models for memory, compute and network under which serving is mostly compute bound.
sources:
  - title: CSE 599K, LLM Serving Systems, University of Washington, Spring 2025 (lecture notes)
    type: lecture
  - title: "Roofline: An Insightful Visual Performance Model for Multicore Architectures (Williams, Waterman, Patterson, CACM 2009)"
    url: https://dl.acm.org/doi/10.1145/1498765.1498785
    type: paper
  - title: How to Scale Your Model, All About Rooflines
    url: https://jax-ml.github.io/scaling-book/roofline/
    type: book
---

A performance model for LLM serving estimates the execution time of a kernel or of a serving iteration from the work it performs and the hardware's peak rates of memory traffic, arithmetic and communication. The roofline model applies to a single kernel, and whole-system models give separate execution time estimates for memory, compute and network.

A compact version of the core model is in the [[ml/serving-systems/roofline-reference|Roofline reference]]. The same model guides [[ml/serving-systems/optimizing-gpu-kernels|kernel optimization]] and system-level choices such as [[ml/serving-systems/batching|batching]].

The material began as notes for CSE 599K "LLM Serving Systems" at the University of Washington, Spring 2025, taught by Prof. Baris Kasikci with TA Kan Zhu. The framework throughput comparison in [Optimal throughput and the gap in practice](#optimal-throughput-and-the-gap-in-practice) is quoted from lecture slides without the underlying benchmark configuration, which is the reason for the needs-review status.

## The roofline model

The [roofline model](https://dl.acm.org/doi/10.1145/1498765.1498785) characterizes a kernel by its operational intensity:

$$\text{Operational Intensity} = \frac{\text{FLOPs performed}}{\text{Bytes moved}}$$

Achievable FLOPs/s plotted against intensity forms a roofline with two regions, a slanted region where performance is capped by memory bandwidth times intensity (memory bound) and a flat region capped by peak compute (compute bound). A kernel below the ridge point leaves compute idle while it waits on memory. A kernel past the ridge point can improve only by performing fewer FLOPs or by using higher-throughput arithmetic.

The ridge sits at the critical intensity, where the workload's demand matches the hardware's ratio:

$$\frac{\text{Computation FLOPs}}{\text{Communication Bytes}} = \frac{\text{Accelerator FLOPs/s}}{\text{Bandwidth Bytes/s}}$$

Above that ratio the kernel is compute bound, below it memory bound. In the memory-bound region, performance improves through more efficient data movement (coalescing, tiling, prefetching, NUMA-aware placement). In the compute-bound region, it improves through higher arithmetic throughput (multithreading, ILP, SIMD, tensor cores).

## H100 numbers

On the [H100 SXM](https://www.nvidia.com/en-us/data-center/h100/), peak dense FP16/BF16 tensor throughput is 989 TFLOPs (NVIDIA lists 1,979 with 2:4 structured sparsity) and HBM3 bandwidth is 3.35 TB/s, so the critical intensity is

$$\frac{989 \times 10^{12}}{3.35 \times 10^{12}} \approx 295 \text{ FLOPs/Byte}$$

Any kernel below about 295 FLOPs per byte moved is memory bound on this part. Rounding the inputs to 1,000 TFLOPs and 3 TB/s gives 333.

### Dot product

An FP32 dot product of length $N$ does $2N$ FLOPs ($N$ multiplies, $N$ adds) and moves $8N$ bytes in plus 4 bytes out:

$$\text{OI} = \frac{2N}{8N + 4} \approx \frac{1}{4}$$

The dot product is therefore memory bound, three orders of magnitude below the critical intensity. Counting FP16 data instead changes the constant and leaves the conclusion unchanged.

### Matrix multiplication

For FP16 matrices $[M,N] \times [N,K] \rightarrow [M,K]$: reads are $2MN + 2NK$ bytes, writes $2MK$ bytes, compute $2MNK$ FLOPs.

$$\text{OI} = \frac{2MNK}{2MN + 2NK + 2MK} \approx M \quad \text{when } N, K \gg M$$

For the batched GEMMs in LLM serving, $M$ is the batch dimension, so matmul on the H100 becomes compute bound at a batch size of about 295. This threshold motivates the large batch sizes pursued in [[ml/serving-systems/batching|Batching]].

In a cluster, bandwidth is not a single number, since the cluster is hierarchical. HBM bandwidth is measured in TB/s, while the network moves 25 GB/s (200 Gb/s), so the same roofline argument applies again at the cluster level with a different denominator, a NUMA effect at rack scale.

## System-level model

The whole-system estimates use the following notation.

- Hardware: $N_{GPU}$ GPUs, aggregate memory bandwidth $MemBW$, memory capacity $GPU_{mem}$, compute $Compute$, interconnect bandwidth $NetBW$.
- Model: hidden dim $D_{model}$, layers $L$, parameters $P_{model}$, GQA group size $R_{GQA}$, dtype size $S_{type}$.
- Workload: average prefill length $p$, decode length $d$, dense batch size $B_{dense}$. Per-request throughput is $\frac{\text{Throughput}_{total}}{p+d}$ and decode throughput is $d\frac{\text{Throughput}_{total}}{p+d}$.

The execution time of one iteration has three estimates.

For memory, one iteration streams nearly all of GPU memory (weights, KV cache) once, so

$$T_{memory} = \frac{GPU_{mem}}{MemBW}$$

For compute, dense operations cost 2 FLOPs per parameter per token, so

$$T_{compute} = \frac{2B_{dense}P_{model}}{Compute}$$

For the network, with tensor parallelism, each layer runs about 4 AllGather-equivalents over activations of shape $B_{dense} \times D_{model}$ (an AllReduce counts as roughly two AllGathers), each taking $N_{GPU}-1$ hops:

$$T_{net} = \frac{4(N_{GPU} - 1)\,D_{model}\,B_{dense}\,S_{type}\,L}{NetBW}$$

## Ratios between the estimates

The ratio of network time to compute time is

$$\frac{T_{net}}{T_{compute}} = 2(N_{GPU} - 1)\frac{D_{model}L}{P_{model}} \cdot \frac{S_{type} \cdot Compute}{NetBW}$$

Since $P_{model}$ grows like $D_{model}^2 L$ while the numerator grows like $D_{model} L$, the ratio decreases as models grow. For the model and hardware sizes considered in lecture, the ratio is below one, so serving is compute bound rather than network bound.

The ratio of memory time to compute time is

$$\frac{T_{memory}}{T_{compute}} = \frac{Compute \cdot GPU_{mem}}{MemBW \cdot 2B_{dense}P_{model}}$$

GQA reduces the size of the KV cache and permits a larger $B_{dense}$ (see [[ml/serving-systems/transformers|Transformers]]), which lowers the ratio toward the compute-bound regime. Larger models have the same effect. Batches dominated by long decodes raise the ratio, since decode attention reads the KV cache without a matching number of dense FLOPs. At realistic batch sizes the net result is that serving is compute bound by this ratio as well.

## Optimal throughput and the gap in practice

If compute is the limiting resource, peak throughput per GPU is

$$\text{Throughput} = \frac{B_{dense}}{T_{compute}} = \frac{Compute}{2P_{model}}$$

The lecture's example puts LLaMA 70B on an A100 at 1857 tokens/s/GPU by this bound, and quotes measured framework throughput far below it: vLLM around 494-552 tokens/s, DeepSpeed-FastGen 372-513, TensorRT-LLM 636-817. The slides do not record the benchmark setup (input/output lengths, hardware count, parallelism config), so the figures are a single snapshot and do not establish a ranking. The size of the gap is the conclusion that does not depend on the setup. Frameworks at the time achieved between about 20% and 44% of the compute-bound ceiling, so keeping tensor cores busy is a central engineering problem in serving.

## Related notes

- [[ml/serving-systems/roofline-reference|Roofline reference]]
- [[ml/serving-systems/batching|Batching]]
- [[ml/serving-systems/optimizing-gpu-kernels|Optimizing GPU Kernels]]
- [[ml/serving-systems/parallelism|Parallelism]]
