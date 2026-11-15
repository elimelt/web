---
title: Faster Causal Self Attention
aliases:
  - systems-research/sparsity-notes
category: Systems Research
tags:
  - machine-learning
  - attention
  - attention-mechanism
  - transformer
  - flashattention
  - sparse-attention
date: 2025-01-14
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: needs-review
description: Reading notes on three sparse attention papers, SCFA, SparseK and MoA, and the method each uses to reduce the quadratic cost of attention over long sequences.
sources:
  - title: Faster Causal Attention Over Large Sequences Through Sparse Flash Attention
    url: https://arxiv.org/abs/2306.01160
    type: paper
  - title: "Sparser is Faster and Less is More: Efficient Sparse Attention for Long-Range Transformers"
    url: https://arxiv.org/abs/2406.16747
    type: paper
  - title: "MoA: Mixture of Sparse Attention for Automatic Large Language Model Compression"
    url: https://arxiv.org/abs/2406.14909
    type: paper
---

Causal self-attention over a sequence of length $n$ computes a score for every query and every earlier key, so its time is quadratic in $n$. Sparse attention computes only a subset of these scores, chosen by a fixed pattern, a learned selection or a per-head search. The three papers summarized here, SCFA, SparseK and MoA, each reduce the cost of attention over long sequences by a different method of choosing that subset. The summaries are second-hand, and I have not re-verified every number against the papers; the status is needs-review for that reason.

## Sparse Causal Flash Attention (SCFA)

[Faster Causal Attention Over Large Sequences Through Sparse Flash Attention](https://arxiv.org/abs/2306.01160) (Pagliardini et al., 2023) extends FlashAttention to handle irregular, sparse attention patterns while keeping its computational efficiency. The modification is support for non-triangular causal masks in the FlashAttention kernel, which permits flexible attention patterns with the memory and compute efficiency of the original kernel.

The paper applies the kernel to two methods. Query/key (QK) dropping selectively removes certain query and key pairs. Hash-based attention uses locality-sensitive hashing to group similar queries and keys together.

The paper reports a 2.0x training speedup at 8,192 tokens and 3.3x at 16,384 tokens, with perplexity comparable to standard attention, and higher speed and accuracy than Reformer. The computation is exact, sparsity patterns may be dynamic, and the method adds no complexity overhead to regular FlashAttention. The speedup increases with sequence length.

## SparseK Attention

[Sparser is Faster and Less is More](https://arxiv.org/abs/2406.16747) introduces SparseK Attention, which uses a scoring network and a differentiable top-k mask operator to dynamically select a constant number of important key-value pairs for each query. Because the operator is differentiable, the selection is trained end to end.

The constant-size selection gives linear time complexity and a constant memory footprint during generation, in both training and inference. It integrates with sliding window attention, works with pre-trained LLMs through fine-tuning, and uses an IO-aware implementation built on FlashAttention. The paper reports better perplexity than baseline sparse attention methods while matching or exceeding full attention quality.

The authors note three limitations. Because of compute constraints, validation covers only modest model sizes and context lengths; only [[ml/deep-learning/decoder-only-transformers|decoder-only architectures]] and text tasks are tested; and the method adds some overhead on short sequences.

## MoA (Mixture of Sparse Attention)

[MoA: Mixture of Sparse Attention for Automatic Large Language Model Compression](https://arxiv.org/abs/2406.14909) starts from the observation that existing sparse attention methods apply one uniform pattern across all attention heads, even though different heads serve different purposes. Uniform patterns also fail to extend the effective context length beyond their attention span.

MoA automatically discovers heterogeneous sparse attention patterns tailored to each head and layer. It profiles the influence of each attention position on model predictions with gradient-based analysis, builds a search space of attention patterns and elastic scaling rules that let spans grow differently with input length, and optimizes over that space with calibration datasets containing long-range dependencies.

The paper reports 3.9x longer effective context length than baseline methods at the same average attention span, retrieval accuracy improved 1.5-7.1x over uniform sparse baselines, maximum benchmark performance drop reduced from the 9-36% range to within 5%, 6.6-8.2x throughput over FlashAttention2, and 1.2-1.4x lower GPU memory usage. Performance degrades under extremely low density constraints, and the authors leave dynamic attention patterns and non-linear elastic rules to future work.

## Related notes

- [[systems/research/padded-encoder-decoder|Accelerating Padded Encoder-Decoder Transformer Models]]
- [[ml/deep-learning/decoder-only-transformers|Decoder-Only Transformers]]
- [[ml/deep-learning/decoder-only-transformers|Decoder-Only Transformers and the WikiText-2 experiment]]
- [[ml/serving-systems/transformers|Transformer Architecture and Implementation]]
- [[ml/serving-systems/inf-llm|InfLLM: Training-Free Long-Context Extrapolation for LLMs]]
- [[ml/deep-learning/encoder-decoder-transformers|Encoder-Decoder Transformers]]
- [[ml/deep-learning/decoder-only-transformers|Decoder-Only Transformers]]
- [[ml/deep-learning/decoder-only-transformers|Decoder-Only Transformers and the WikiText-2 experiment]]
- [[ml/serving-systems/transformers|Transformer Architecture and Implementation]]
- [[ml/serving-systems/inf-llm|InfLLM: Training-Free Long-Context Extrapolation]]
- [[ml/deep-learning/encoder-decoder-transformers|Encoder-Decoder Transformers]]
