---
title: PEFT and Preference Optimization
aliases:
  - llm-serving-systems/peft-and-preference-optimization
category: Machine Learning Systems
tags:
  - peft
  - lora
  - qlora
  - rlhf
  - dpo
  - fine-tuning
  - memory-efficiency
  - machine-learning
date: 2026-08-01
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: draft
description: Model adaptation from SFT through RLHF to DPO, with a worked memory comparison of full fine-tuning, LoRA and QLoRA, and multi-adapter serving.
sources:
  - title: "LoRA: Low-Rank Adaptation of Large Language Models"
    url: https://arxiv.org/abs/2106.09685
    type: paper
  - title: "QLoRA: Efficient Finetuning of Quantized LLMs"
    url: https://arxiv.org/abs/2305.14314
    type: paper
  - title: "Training language models to follow instructions with human feedback"
    url: https://arxiv.org/abs/2203.02155
    type: paper
  - title: "Direct Preference Optimization: Your Language Model is Secretly a Reward Model"
    url: https://arxiv.org/abs/2305.18290
    type: paper
  - title: "S-LoRA: Serving Thousands of Concurrent LoRA Adapters"
    url: https://arxiv.org/abs/2311.03285
    type: paper
---

Adaptation of a pretrained base model into a preference-tuned chat model consists of supervised fine-tuning (SFT) on demonstrations followed by preference optimization, either RLHF's PPO loop or DPO. Parameter-efficient fine-tuning (PEFT) methods such as LoRA and QLoRA carry out any of these stages while training only a small set of added parameters.

The memory cost of each stage follows from the mixed-precision accounting for full fine-tuning under Adam given in [[ml/serving-systems/parallelism|Parallelism]]. Applied to LoRA, the same accounting shows that LoRA reduces the trainable-state term (gradients and optimizer state) and leaves the weight term unchanged. QLoRA additionally reduces the weight term by quantizing the frozen base.

## From pretraining to preference: the adaptation pipeline

The pipeline introduced with InstructGPT runs three stages on top of a pretrained base model. SFT trains on instruction-response demonstrations with ordinary cross-entropy, which trains the model on a response format and a range of tasks. RLHF then trains a reward model on human preference comparisons and uses it to fine-tune the SFT policy with PPO. DPO replaces the reward-model-plus-PPO stage with a single supervised loss computed directly on preference pairs. LoRA and QLoRA are methods for running SFT, RLHF or DPO training without updating the full parameter set, and they do not form a separate stage.

## LoRA: low-rank adapters

[LoRA](https://arxiv.org/abs/2106.09685) freezes the pretrained weight matrix $W_0 \in \mathbb{R}^{d \times k}$ and adds a low-rank update $\Delta W = BA$, with $B \in \mathbb{R}^{d \times r}$, $A \in \mathbb{R}^{r \times k}$, and rank $r \ll \min(d,k)$. The forward pass becomes $h = W_0 x + BAx$, so at inference $B$ and $A$ can be merged into $W_0$ with zero added latency. Only $A$ and $B$ receive gradients; $W_0$ never does.

Trainable parameters per adapted matrix are $r(d+k)$ instead of $dk$. For a square $d \times d$ matrix the reduction factor is $\frac{d}{2r}$: at $d = 4096$ and $r = 16$, that is a 128x reduction in parameters for that matrix. The saving applies to gradients and optimizer state as well as to parameter storage, since both are needed only for the $r(d+k)$ trainable values.

## QLoRA: quantized frozen base

[QLoRA](https://arxiv.org/abs/2305.14314) further reduces memory by storing the frozen base in 4-bit NF4 (a data type built for normally distributed weights) instead of FP16, while keeping the LoRA adapters themselves in BF16. Two additional mechanisms keep training stable and reduce memory further.

- **Double quantization.** Block quantization needs one scale constant per block. At block size 64, an FP32 constant adds $32/64 = 0.5$ bits per parameter. QLoRA quantizes the constants themselves (FP32 to FP8, block size 256), reducing that overhead to $8/64 + 32/(64 \times 256) = 0.127$ bits per parameter, a saving of 0.373 bits per parameter, or about 3 GB for a 65B-parameter model.
- **Paged optimizers.** Optimizer state for the small trainable adapter set is allocated in NVIDIA unified memory, which pages between CPU and GPU automatically when a memory spike would otherwise trigger an out-of-memory error, at the cost of a stall when a page fault occurs.

Backpropagation flows through the frozen 4-bit weights (dequantized on the fly for the matmul) into the BF16 adapters; the base weights themselves are never updated and never need gradients or optimizer state.

## Worked example: full fine-tuning vs LoRA vs QLoRA on Llama3-8B

Consider Llama3-8B ($P = 8 \times 10^9$ params, hidden size 4096, 32 layers), the model used in [[ml/serving-systems/memory-management|Memory Management]]'s KV-cache example, with LoRA applied to the four attention projections per layer (q, k, v, o, each treated as $4096 \times 4096$ for this estimate) at rank $r = 16$:

$$\text{Trainable params} = 32 \text{ layers} \times 4 \text{ matrices} \times 16 \times (4096 + 4096) = 16.8\text{M}$$

This is 0.21% of $P$. The ZeRO-style mixed-precision accounting from [[ml/serving-systems/parallelism|Parallelism]] (FP16 params and gradients at $2\Psi$ each, FP32 master weights/momentum/variance at $4\Psi$ each, $K=12$ total for the optimizer terms) gives the following totals.

| Method    | Base weights                | Trainable-state (grad + optimizer) | Total     |
| --------- | ---------------------------- | ----------------------------------- | --------- |
| Full FT   | 16 GB (FP16, $2P$)            | 112 GB ($14P$, all params trainable) | ~128 GB   |
| LoRA      | 16 GB (frozen FP16, $2P$)     | ~0.27 GB ($16\Psi = 16$ bytes/param $\times$ 16.8M) | ~16.3 GB  |
| QLoRA     | ~4.1 GB (NF4 + DQ, ~4.13 bits/param $\times P$) | ~0.27 GB (same trainable set)       | ~4.4 GB   |

Full fine-tuning needs the full $16\Psi$ per parameter (weights, gradients, and Adam's FP32 master/momentum/variance) applied to all 8B parameters, which alone exceeds an 80 GB H100 before activations are counted. LoRA reduces the trainable state to that of 16.8M parameters, so the frozen 16 GB base dominates the budget. QLoRA then reduces the base itself by roughly 4x, so a single consumer or datacenter GPU can fine-tune models that would otherwise require multi-GPU sharding to hold the optimizer state. Activations, a third and generally smaller term, are omitted; gradient checkpointing (see [[ml/serving-systems/parallelism|Parallelism]]) reduces them when they are significant.

## Multi-adapter serving

Serving many fine-tuned variants of the same base model poses a different memory problem. N full fine-tunes require $N$ times the weight memory, while N LoRA adapters require one frozen base plus $N$ small adapter sets. [S-LoRA](https://arxiv.org/abs/2311.03285) exploits this at serving time with Unified Paging, which extends the [[ml/serving-systems/memory-management|PagedAttention]] page-table idea to adapter weights. A single memory pool holds both KV-cache pages and adapter-weight pages of varying LoRA rank, so a batch can mix requests targeting different adapters without pre-reserving worst-case space per adapter. A custom tensor-parallel strategy and batched CUDA kernels then let one GPU serve thousands of adapters concurrently, with reported throughput up to 4x that of naive per-adapter serving in HuggingFace PEFT or vLLM.

## RLHF: reward model plus PPO

[InstructGPT](https://arxiv.org/abs/2203.02155) trains a reward model on human-ranked comparisons of model outputs, then fine-tunes the SFT policy with PPO to maximize that reward, subject to a KL penalty against the frozen SFT policy that limits drift toward degenerate text exploiting the reward model (reward hacking). Running this loop requires four models resident at once: the trainable policy (actor), a value/critic model estimating expected reward, the frozen reward model scoring generated completions, and the frozen reference policy for the KL term. Only the actor (and usually the critic) carry gradients and optimizer state; the reward model and reference are forward-only. The system must also interleave sampling (generating completions from the current policy) with training, a scheduling problem distinct from the batching concerns in [[ml/serving-systems/batching|Batching]].

## DPO: eliminating the reward model and the RL loop

[DPO](https://arxiv.org/abs/2305.18290) starts from the same KL-constrained reward-maximization objective RLHF optimizes, but substitutes its closed-form optimal policy into the Bradley-Terry preference model instead of fitting a separate reward model. The result is a loss computed directly on log-probability ratios between the trainable policy $\pi_\theta$ and a frozen reference $\pi_{ref}$, for a preferred completion $y_w$ and dispreferred completion $y_l$:

$$\mathcal{L}_{DPO}(\pi_\theta;\pi_{ref}) = -\mathbb{E}_{(x,y_w,y_l)}\left[\log \sigma\left(\beta \log\frac{\pi_\theta(y_w|x)}{\pi_{ref}(y_w|x)} - \beta \log\frac{\pi_\theta(y_l|x)}{\pi_{ref}(y_l|x)}\right)\right]$$

$\beta$ controls the strength of the KL constraint, playing the same role the KL penalty coefficient plays in PPO. DPO requires only two models, the trainable policy and a frozen reference, both evaluated with forward passes over static preference data and no sampling loop. No reward model or value function is trained, and no rollout or generation phase runs during training, which removes the memory of the reward and value models and the scheduling of a sampling phase relative to RLHF.

## LoRA and QLoRA with DPO: the frozen base as the reference

In the LoRA case, DPO's frozen reference model is the same frozen base model that the adapter modifies. Instead of two full copies of the weights, a LoRA-DPO setup holds one frozen base and one trainable adapter. The reference log-probabilities come from a forward pass with the adapter disabled, and the policy log-probabilities come from a forward pass with it enabled. This halves the weight-memory cost of the two-model DPO setup relative to full-parameter DPO, in addition to the trainable-state savings LoRA already provides for SFT.

## Edge cases or limits

LoRA's low-rank assumption can limit quality. Harder tasks or larger distribution shifts from the base model sometimes require larger $r$ or more adapted matrices to match full fine-tuning quality, which reduces the memory advantage. QLoRA's 4-bit base adds a dequantization cost to every forward and backward pass, so it reduces memory at the cost of compute and offers little benefit when GPU memory is not the limiting resource. DPO's quality depends on the reference model remaining close to the policy's initialization. If training moves too far from $\pi_{ref}$, the implicit KL constraint no longer regularizes effectively, the same failure that PPO's explicit KL penalty is designed to prevent.

## Related notes

- [[ml/serving-systems/memory-management|Memory Management]]
- [[ml/serving-systems/parallelism|Parallelism]]
- [[ml/serving-systems/quantization|Quantization]]
- [[ml/serving-systems/batching|Batching]]
