---
title: Sparsity and Pruning in LLM Serving Systems
aliases:
  - llm-serving-systems/sparsity-and-pruning
category: Machine Learning Systems
tags:
  - sparsity
  - pruning
  - performance-optimization
  - machine-learning
date: 2025-05-25
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: needs-review
description: Weight, activation and KV-cache sparsity in LLM serving, with magnitude pruning, Wanda, contextual sparsity (Deja Vu), Quest, MLA and TEAL.
sources:
  - title: CSE 599K, LLM Serving Systems, University of Washington, Spring 2025 (lecture notes)
    type: lecture
  - title: "The Lottery Ticket Hypothesis: Finding Sparse, Trainable Neural Networks"
    url: https://arxiv.org/abs/1803.03635
    type: paper
  - title: A Simple and Effective Pruning Approach for Large Language Models (Wanda)
    url: https://arxiv.org/abs/2306.11695
    type: paper
  - title: "Deja Vu: Contextual Sparsity for Efficient LLMs at Inference Time"
    url: https://arxiv.org/abs/2310.17157
    type: paper
  - title: "Quest: Query-Aware Sparsity for Efficient Long-Context LLM Inference"
    url: https://arxiv.org/abs/2406.10774
    type: paper
  - title: DeepSeek-V2 Technical Report (Multi-Head Latent Attention)
    url: https://arxiv.org/abs/2405.04434
    type: paper
  - title: Training-Free Activation Sparsity in Large Language Models (TEAL)
    url: https://arxiv.org/abs/2408.14690
    type: paper
---

Sparsity in an LLM is the presence of zero or negligible values in its weights, activations or KV cache. Pruning removes such values, or whole structures, so that the computation and memory traffic associated with them can be skipped.

Like [[ml/serving-systems/quantization|Quantization]], sparsity changes the model representation to reduce serving cost, and whether the reduction yields an actual speedup depends on the hardware bottlenecks described in [[ml/serving-systems/performance-modeling|Performance Modeling]].

The material began as notes for CSE 599K "LLM Serving Systems" at the University of Washington, Spring 2025, taught by Prof. Baris Kasikci with TA Kan Zhu. Speedup and accuracy numbers are quoted from the cited papers and have not been reproduced.

## Basis for pruning

Pruning removes structure from a trained network: individual weights, neurons, attention heads, or whole layers. Pruning alone degrades accuracy gradually as sparsity increases. Pruning followed by fine-tuning maintains accuracy to much higher sparsity and occasionally exceeds the accuracy of the original model. Even with fine-tuning, accuracy drops sharply at around 80-90% sparsity.

The theoretical grounding starts with Optimal Brain Damage (LeCun et al., 1989), which shows the optimal weights to remove are the ones whose removal least increases the loss, measured through the Hessian. Computing the Hessian is prohibitively expensive at scale, so weight magnitude serves as a low-cost proxy.

The [Lottery Ticket Hypothesis](https://arxiv.org/abs/1803.03635) accounts for the existence of accurate sparse subnetworks. A large randomly initialized network contains small subnetworks ("winning tickets") that, trained in isolation from their original initialization, match the accuracy of the full model. On this account, over-parametrization increases the number of candidate subnetworks at initialization, and pruning after training identifies one that was present from the start.

## Weight sparsity

Weight sparsity takes three structural forms, which trade flexibility against ease of efficient implementation:

- Structured: remove whole rows, columns, channels, heads, or layers. Efficient execution is straightforward, since the dense kernels operate on smaller matrices.
- Semi-structured: fixed patterns like 2:4 (two nonzero out of every four weights), which NVIDIA Ampere and later accelerate in hardware.
- Unstructured: remove any weight anywhere. It gives the highest quality at a given sparsity, but its irregular access pattern makes a wall-clock speedup difficult to obtain.

### Wanda

[Wanda](https://arxiv.org/abs/2306.11695) prunes per output, scoring each weight by the product of its magnitude and the L2 norm of its input activation. The activation term matters because LLM activations have a few large-magnitude features (the same outlier phenomenon that drives [[ml/serving-systems/quantization|quantization]] design), so a small weight multiplying a large activation can still be important. The method requires no retraining and no weight updates.

```python
def prune(W, X, s):
    metric = W.abs() * X.norm(p=2, dim=0)      # Wanda pruning metric
    _, sorted_idx = torch.sort(metric, dim=1)  # sort per output
    pruned_idx = sorted_idx[:, :int(C_in * s)] # indices to prune
    W.scatter_(dim=1, index=pruned_idx, src=0) # zero out weights
    return W
```

The paper reports accuracy comparable to SparseGPT at 50%, 4:8, and 2:4 sparsity with a much simpler procedure, since SparseGPT performs expensive weight updates during pruning.

### Deja Vu: contextual sparsity

Static pruning commits to one sparsity pattern for all inputs. [Deja Vu](https://arxiv.org/abs/2310.17157) observes that for a given input, only a small input-dependent subset of heads and MLP neurons matters, and predicts that subset at inference time. Small lookahead predictors run ahead of the main computation. The attention input at block $k$ predicts the MLP sparsity at block $k$, and the MLP input predicts attention sparsity at block $k+1$, so prediction overlaps with computation. The paper reports no accuracy drop up to around 75% contextual sparsity and 1.8-6x latency improvement over strong baselines, with hardware-aware sparse kernels converting the sparsity into the speedup.

## KV cache sparsity

Attention weights at inference are highly sparse. The lecture cites attention matrices over 95% sparse, with under 1% of weights carrying meaningful mass. The KV cache (the memory-bound side of decoding, see [[ml/serving-systems/memory-management|Memory Management]]) is therefore a natural target for sparsity.

### Quest

Eviction-based methods drop KV entries judged unimportant from past attention, and they fail when an evicted token becomes important for a later query. [Quest](https://arxiv.org/abs/2406.10774) keeps the entire KV cache in memory and reduces data movement instead. It tracks per-page metadata (elementwise min and max keys), estimates each page's maximum possible attention score for the current query, and computes attention only over the top-K pages. Importance is therefore decided per query rather than from history. The paper reports a 7.03x self-attention speedup at 32K context with a 2K token budget, with accuracy maintained on long-dependency tasks.

### Multi-Head Latent Attention

[DeepSeek-V2's MLA](https://arxiv.org/abs/2405.04434) compresses the KV cache at the architecture level. Instead of caching full per-head keys and values, it caches one learned low-rank latent vector per token and expands it during attention. The paper reports a 93.3% KV cache reduction and 5.76x generation throughput improvement over DeepSeek 67B.

| Attention mechanism | KV cache per token | Capability |
|---------------------|--------------------|------------|
| Multi-Head Attention (MHA) | $2n_h d_h l$ | Strong |
| Grouped-Query Attention (GQA) | $2n_g d_h l$ | Moderate |
| Multi-Query Attention (MQA) | $2d_h l$ | Weak |
| MLA | $(d_c + d_h^R)\,l \approx \frac{9}{2}d_h l$ | Stronger than MHA per the paper |

Here $d_c$ is the latent dimension ($4d_h$ in the paper) and $d_h^R$ the decoupled RoPE head dimension ($d_h/2$). RoPE requires the decoupling because position-dependent rotations do not commute with the low-rank compression, so MLA keeps a small rotated component concatenated beside the compressed part.

## Activation sparsity

LLM activation distributions concentrate around zero across MLP projections and attention weight matrices. When an activation is (near) zero, the weight columns it multiplies contribute nothing, so the corresponding weight reads can be skipped. In the memory-bound decode regime, the reduction in weight traffic translates directly into lower latency.

[TEAL](https://arxiv.org/abs/2408.14690) applies this without training. During decoding, it thresholds low-magnitude activations to zero and skips loading the associated weight channels. The paper reports that around 25% sparsity costs little accuracy and yields a 1.2-1.3x speedup, and that 50% sparsity causes a small degradation and yields 1.6-1.8x, across model sizes from 8B to 70B.

## Conditions for a speedup

Sparsity reduces latency only when the hardware can skip the zeros. 2:4 patterns have dedicated tensor core support, while unstructured sparsity rarely yields a wall-clock speedup. Activation and KV sparsity reduce latency in the memory-bound decode regime because the work saved is memory traffic. Zero-shot methods (Wanda, TEAL) give up a small amount of accuracy in exchange for simpler deployment, and fine-tuning recovers that accuracy when the compute budget allows. Weight and activation sparsity can be combined, and the combination is a current direction of efficiency research.

## Related notes

- [[ml/serving-systems/quantization|Quantization]]
- [[ml/serving-systems/performance-modeling|Performance Modeling]]
- [[ml/serving-systems/memory-management|Memory Management]]
- [[systems/research/sparsity-notes|Faster Causal Self Attention]]
- [[systems/research/padded-encoder-decoder|Accelerating Padded Encoder-Decoder Transformer Models]]
