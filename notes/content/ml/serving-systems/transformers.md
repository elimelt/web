---
title: Transformer Architecture and Implementation
aliases:
  - llm-serving-systems/transformers
category: Machine Learning Systems
tags:
  - transformers
  - architecture
  - attention
  - gqa
  - kv-cache
  - flashattention
  - batching
  - prefill
  - decode
  - feedforward
  - normalization
  - machine-learning
date: 2025-05-25
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: The Llama-style decoder-only transformer from a serving perspective, with prefill and decode, attention with GQA, the FFN, normalization, and the operations bound by compute, memory or network.
sources:
  - title: CSE 599K, LLM Serving Systems, University of Washington, Spring 2025 (lecture notes)
    type: lecture
  - title: Attention Is All You Need
    url: https://arxiv.org/abs/1706.03762
    type: paper
  - title: "Llama 2: Open Foundation and Fine-Tuned Chat Models"
    url: https://arxiv.org/abs/2307.09288
    type: paper
  - title: "GQA: Training Generalized Multi-Query Transformer Models from Multi-Head Checkpoints"
    url: https://arxiv.org/abs/2305.13245
    type: paper
  - title: "RoFormer: Enhanced Transformer with Rotary Position Embedding"
    url: https://arxiv.org/abs/2104.09864
    type: paper
---

A decoder-only transformer maps a token sequence to a next-token distribution at every position through a stack of layers, each consisting of causal self-attention and a feed-forward network joined by residual connections and normalization. Llama-style models use RMSNorm, a gated SwiGLU feed-forward network, rotary position encoding and grouped-query attention.

For serving, the relevant properties of each component are what it computes and whether its execution is bound by compute, memory or network. The attention and KV-cache material supports [[ml/serving-systems/memory-management|Memory Management]], [[ml/serving-systems/quantization|Quantization]], and [[ml/serving-systems/speculative-decoding|Speculative Decoding]].

The material began as notes for CSE 599K "LLM Serving Systems" at the University of Washington, Spring 2025, taught by Prof. Baris Kasikci with TA Kan Zhu.

## Prefill and decode

Inference has two phases with opposite performance characteristics. Prefill processes the whole input prompt at once, all tokens in parallel, which makes it compute bound. Decode generates one token at a time, each step reading the accumulated KV cache, which makes it memory bound. Most serving techniques are designed for one of these two regimes.

An inference iteration is one full forward pass through all layers that produces one output token (or, during prefill, processes the prompt). Activations are the intermediate tensors passed between layers.

## Components

### Embedding layer

The embedding layer maps each token ID to a dense learned vector, 4096 dimensions in Llama-scale models. It is a table lookup with one row per vocabulary entry.

### Self-attention

$$\text{Attention}(Q, K, V) = \text{softmax}\left(\frac{QK^T}{\sqrt{d_k}}\right)V$$

from [Attention Is All You Need](https://arxiv.org/abs/1706.03762). Each query in $Q$ is compared with the keys $K$ of all positions, the resulting weights mix the values $V$, and the factor $\sqrt{d_k}$ keeps dot products from growing with head dimension and saturating the softmax.

Decoder-only models use causal attention, in which each position attends only to itself and earlier positions. The mask sets future positions to $-\infty$ before the softmax, and since $\text{softmax}(x_i) \to 0$ as $x_i \to -\infty$, masked positions contribute nothing.

Multi-head attention splits the hidden dimension into independent heads that attend separately:

```python
#Original query tensor
q = [[1, 2, 3, 4, 5, 6],    # Token 1
     [7, 8, 9, 10, 11, 12]] # Token 2
#Shape: (seq_len, hidden_dim) = (2, 6)

#Separated into heads
sub_q = [[[1, 2, 3],    # Head 1 for Token 1
          [4, 5, 6]],   # Head 2 for Token 1
         [[7, 8, 9],    # Head 1 for Token 2
          [10, 11, 12]]] # Head 2 for Token 2
#Shape: (seq_len, num_heads, head_dim) = (2, 2, 3)
```

[Grouped Query Attention](https://arxiv.org/abs/2305.13245) has multiple query heads share one key/value head (group size 4 means 4 query heads per KV head). Quality is largely preserved, and the KV cache shrinks by the group factor, which permits a larger batch size. [[ml/serving-systems/performance-modeling|Performance Modeling]] quantifies the effect of batch size.

### Feed-forward network

The Llama FFN uses a gated design with three projections. Gate and up projections expand the hidden dimension, the gate passes through SiLU and multiplies the up path elementwise (SwiGLU), and the down projection returns to model width:

$$\text{FFN}(x) = W_{down}\left(\text{SiLU}(W_{gate}\,x) \odot W_{up}\,x\right)$$

### Normalization

Llama replaces LayerNorm with RMSNorm, which omits the mean subtraction:

$$\text{RMSNorm}(x) = \frac{x}{\sqrt{\frac{1}{n}\sum_{i=1}^n x_i^2 + \epsilon}} \odot g$$

with $\epsilon$ a small stability constant and $g$ a learned per-dimension scale.

### Residual connections

Each major component's output is added to its input, $\text{output} = \text{input} + \text{component}(\text{input})$, which preserves gradient flow through deep stacks.

### Rotary positional encoding

RoPE ([RoFormer](https://arxiv.org/abs/2104.09864)) applies position-dependent rotations to query and key vectors, encoding relative position directly in the attention dot product and extrapolating more gracefully to varying sequence lengths than learned absolute embeddings.

### Softmax in practice

$$\text{softmax}(x_i) = \frac{e^{x_i}}{\sum_j e^{x_j}}$$

Implementations subtract the row maximum before exponentiating to avoid overflow, which leaves the output unchanged; the online version of this computation is the core of FlashAttention (see [[ml/serving-systems/memory-management|Memory Management]]).

## KV cache

During decode, each new token needs attention against every previous position's keys and values. Recomputing them every step would make step $t$ cost $O(t)$ full projections, so the K and V vectors are cached as they are produced. The cache is per request and per layer (every layer keeps its own K and V), and it grows linearly with generated length, so at long sequence lengths and large batches it accounts for most of serving memory. Cache sizing and allocation strategies are treated in [[ml/serving-systems/memory-management|Memory Management]].

## Multi-GPU execution

Tensor parallelism splits the weight matrices across GPUs: Q, K, V projections are partitioned by head, FFN projections by rows or columns, and each GPU computes its shard (details in [[ml/serving-systems/parallelism|Parallelism]]). The attention output projection and the FFN down projection are split by rows, so each GPU produces a partial sum of the layer's output, and one AllReduce (a ReduceScatter followed by an AllGather) after each of the two sums them, two per layer in the forward pass ([Megatron-LM](https://arxiv.org/abs/1909.08053), Section 3). With sequence parallelism, each AllReduce becomes a ReduceScatter and a later AllGather that send the same bytes.

## Where each operation binds

Compute bound: the dense projections (Q, K, V, output, up, gate, down) and prefill attention, since they are large matmuls over many tokens.

Memory bound: decode attention, which streams the KV cache to score one new token per request.

Network bound: the AllReduce collectives (or, with sequence parallelism, ReduceScatter and AllGather) in tensor-parallel deployments.

This division is the reason prefill and decode require different batching treatments ([[ml/serving-systems/batching|Batching]]) and different hardware ratios.

## Original transformer vs Llama

- Structure: encoder-decoder with cross-attention becomes decoder-only.
- Normalization: LayerNorm becomes RMSNorm.
- Activation: ReLU becomes SwiGLU.
- Positions: absolute embeddings become rotary (RoPE).
- Attention: full multi-head becomes grouped-query.

## Related notes

- [[ml/serving-systems/memory-management|Memory Management]]
- [[ml/serving-systems/batching|Batching]]
- [[ml/serving-systems/parallelism|Parallelism]]
- [[ml/serving-systems/speculative-decoding|Speculative Decoding]]
