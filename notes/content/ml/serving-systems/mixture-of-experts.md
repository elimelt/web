---
title: Intro to Mixture of Experts (MoE) in LLM Serving Systems
aliases:
  - llm-serving-systems/mixture-of-experts
category: Machine Learning Systems
tags:
  - mixture-of-experts
  - moe
  - performance-optimization
  - memory-efficiency
  - machine-learning
date: 2025-05-25
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: needs-review
description: The MoE architecture, routing and load balancing, the DeepSeek design lineage, and the systems problems MoE creates for training and serving (all-to-all communication, expert placement, offloading).
sources:
  - title: CSE 599K, LLM Serving Systems, University of Washington, Spring 2025 (lecture notes)
    type: lecture
  - title: "Switch Transformers: Scaling to Trillion Parameter Models with Simple and Efficient Sparsity"
    url: https://arxiv.org/abs/2101.03961
    type: paper
  - title: Mixtral of Experts
    url: https://arxiv.org/abs/2401.04088
    type: paper
  - title: "DeepSeekMoE: Towards Ultimate Expert Specialization in Mixture-of-Experts Language Models"
    url: https://arxiv.org/abs/2401.06066
    type: paper
  - title: DeepSeek-V2 Technical Report
    url: https://arxiv.org/abs/2405.04434
    type: paper
  - title: DeepSeek-V3 Technical Report
    url: https://arxiv.org/abs/2412.19437
    type: paper
  - title: "Fiddler: CPU-GPU Orchestration for Fast Inference of Mixture-of-Experts Models"
    url: https://arxiv.org/abs/2402.07033
    type: paper
  - title: "Outrageously Large Neural Networks: The Sparsely-Gated Mixture-of-Experts Layer"
    url: https://arxiv.org/abs/1701.06538
    type: paper
  - title: "GShard: Scaling Giant Models with Conditional Computation and Automatic Sharding"
    url: https://arxiv.org/abs/2006.16668
    type: paper
  - title: "MegaBlocks: Efficient Sparse Training with Mixture-of-Experts"
    url: https://arxiv.org/abs/2211.15841
    type: paper
---

A mixture-of-experts (MoE) layer replaces the feed-forward network of a transformer block with a set of smaller expert networks and a learned router that selects a few experts for each token. The total parameter count grows with the number of experts, while the computation per token grows only with the number of experts selected.

Expert routing distributes parameters and computation across devices, so MoE serving builds on [[ml/serving-systems/parallelism|parallel execution]] and the cost model in [[ml/serving-systems/performance-modeling|Performance Modeling]].

The material began as notes for CSE 599K "LLM Serving Systems" at the University of Washington, Spring 2025, taught by Prof. Baris Kasikci with TA Kan Zhu. Speedup numbers are quoted from the cited papers or from lecture slides, and I have not reproduced any of them.

## Core idea

A MoE layer replaces one large feedforward network with many smaller expert FFNs plus a router that picks a few experts per token. Since each token activates only $k$ of $N$ experts, $N$ (and with it the total parameter count) can grow without increasing per-token FLOPs. This decoupling of parameter count from per-token computation is the principal motivation for the architecture.

The architecture is used in Mixtral, Grok, the DeepSeek series, Qwen-MoE, and the open OLMoE, and GPT-4 is widely rumored to use it (unconfirmed).

## Evidence for the architecture

The papers give three lines of evidence.

- Higher quality at equal FLOPs. [Switch Transformers](https://arxiv.org/abs/2101.03961) showed pre-training speedups up to 7x over dense baselines at fixed compute by scaling expert count.
- Lower training cost at a target accuracy. [DeepSpeed-MoE](https://arxiv.org/abs/2201.05596) reports around 5x lower training cost to match a dense model's quality.
- Competitive quality at deployment scale. [Mixtral 8x7B](https://arxiv.org/abs/2401.04088) matches or exceeds Llama 2 70B across benchmarks while activating about 13B parameters per token, roughly 5x fewer. [DeepSeek-V3](https://arxiv.org/abs/2412.19437) extends the pattern to 671B total parameters with 37B active.

## Routing

The models below use top-k token choice routing. For token $t$ at layer $l$:

$$h_t^l = \sum_{i=1}^{N} g_{i,t} \cdot \text{FFN}_i^{(l)}(u_t) + u_t$$

where $u_t$ is the token's hidden state, $g_{i,t}$ is the gating weight for expert $i$ (zero for unselected experts), and the routing scores come from a learned projection, $s_{i,t} = \text{Softmax}_i(u_t^T W_g)$. The alternative is expert choice routing, where each expert selects the tokens it will process, which guarantees balanced expert load at the cost of tokens receiving varying amounts of compute.

In a top-2 layer with one shared expert, a token routed to experts 2 and 5 follows the paths below.

```mermaid
flowchart LR
    U["token hidden state u_t"] --> G["router<br/>s_i = Softmax_i(u_t^T W_g)"]
    U --> SH["shared expert FFN<br/>(every token)"]
    G -->|"g_2"| E2["FFN_2"]
    G -->|"g_5"| E5["FFN_5"]
    G -.->|"g = 0, not in top-k"| EO["FFN_1, FFN_3, FFN_4, ..."]
    E2 --> SUM["weighted sum + residual u_t"]
    E5 --> SUM
    SH --> SUM
    SUM --> H["h_t"]
```

Deployed models use the following configurations.

| Model       | Routed experts | Active routed | Shared experts |
| ----------- | -------------- | ------------- | -------------- |
| Mixtral     | 8              | 2             | 0              |
| DBRX        | 16             | 4             | 0              |
| DeepSeek v1 | 64             | 6             | 2              |
| DeepSeek v3 | 256            | 8             | 1              |
| Qwen 1.5    | 60             | 4             | 4              |

Shared experts run for every token; routed experts are conditionally activated. Most models apply MoE only to the MLP layers. MoE attention exists (JetMoE) but is uncommon.

## Training difficulties

Top-k selection is a discrete decision, so only the selected experts receive gradients and the routing decision itself is not differentiable. Workarounds include REINFORCE-style estimators, stochastic perturbations of the router logits, and, most commonly in practice, auxiliary balancing losses layered on top of the standard gradient path.

Balancing also matters for systems efficiency. If routing concentrates on a few experts, the devices hosting them determine the duration of the whole step. The lecture notes that unbalanced training runs collapse onto a handful of heavily used experts.

> [!warning] Router collapse is self-reinforcing
> An expert that receives more tokens gets more gradient updates, improves faster, and is selected in more routing decisions. A small early imbalance can grow until a few experts receive nearly all traffic and the rest remain untrained. The balancing losses below counteract this feedback before the imbalance becomes permanent.

The [Switch Transformer](https://arxiv.org/abs/2101.03961) auxiliary loss counteracts the imbalance:

$$\mathcal{L}_{\text{aux}} = \alpha \cdot N \cdot \sum_{i=1}^{N} f_i \cdot P_i$$

where over a batch $B$ of $T$ tokens, $f_i = \frac{1}{T}\sum_{x \in B} \mathbf{1}\{\text{argmax } p(x) = i\}$ is the fraction of tokens dispatched to expert $i$ and $P_i = \frac{1}{T}\sum_{x \in B} p_i(x)$ is the router probability mass it receives. The gradient with respect to $P_i$ is proportional to $f_i$, so the loss reduces the routing probability of an expert more strongly the more tokens it receives.

The DeepSeek models modified this loss in successive versions. [DeepSeek v1 and v2](https://arxiv.org/abs/2401.06066) add per-device balancing (aggregate the same objective by device) and, in [v2](https://arxiv.org/abs/2405.04434), a communication balancing loss of the form $\mathcal{L}_{\text{CommBal}} = \alpha_3 \sum_{i=1}^{D} f_i^{in} P_i^{out}$ that balances inbound and outbound traffic per device. [DeepSeek v3](https://arxiv.org/abs/2412.19437) drops auxiliary losses entirely and instead maintains a per-expert bias $b_i$, updated online: a token routes to expert $i$ when $s_{i,t} + b_i$ makes the top-k, but the gating weight uses the unbiased $s_{i,t}$. V3 also switches the score function to a sigmoid.

## The DeepSeek lineage

The successive DeepSeek architectures record several developments in MoE design.

- v1 (16B total, 2.8B active): 64 fine-grained routed experts plus 2 shared, 6 active, standard top-k with expert and device balancing losses.
- v2 (236B total, 21B active): 160 routed plus 2 shared, adds top-M device routing (each token touches at most M devices) and the communication balancing loss.
- v3 (671B total, 37B active): 256 routed plus 1 shared, 8 active, sigmoid scoring, aux-loss-free bias balancing, top-M device routing retained.

The fine-grained pattern (many small experts plus always-on shared experts) comes from the observation that smaller experts specialize better and the shared expert absorbs common knowledge that would otherwise be duplicated across every routed expert.

## Upcycling

Because training an MoE from scratch is expensive, several models are initialized from a dense checkpoint. The dense FFN weights are copied into every expert, a newly initialized router is attached, and training continues. Qwen1.5-MoE did this from the Qwen-1.8B dense model (60 routed experts with 4 shared, 4 active) and reached quality competitive with much larger dense models at a fraction of the training cost, per the [Qwen MoE report](https://qwenlm.github.io/blog/qwen-moe/).

## Systems: expert parallelism and all-to-all

Expert parallelism partitions experts across devices. Every MoE layer then needs two all-to-all collectives per pass: a dispatch that routes each token's activations to the devices holding its selected experts, and a combine that gathers the expert outputs back to the token's original position.

```text
GPU0: [A0, A1, A2, A3]  ->  GPU0: [A0, B0, C0, D0]
GPU1: [B0, B1, B2, B3]  ->  GPU1: [A1, B1, C1, D1]
GPU2: [C0, C1, C2, C3]  ->  GPU2: [A2, B2, C2, D2]
GPU3: [D0, D1, D2, D3]  ->  GPU3: [A3, B3, C3, D3]
```

All-to-all is synchronous and blocking and moves large volumes of data, so it dominates MoE communication cost. The lecture quotes it at an average of 34.1% of step time, with median 2x and worst-case around 4x slowdown when it contends with other communication. Lina (USENIX ATC 2023) addresses this contention. It partitions AllReduce tensors into micro-operations, schedules all-to-all at higher priority so that it does not share bandwidth, and pipelines expert computation against communication. It reports up to 2.4x speedup in MoE layer execution.

## Serving MoE models

Parameters that add no per-token FLOPs still occupy memory at deployment. Mixtral 8x7B needs roughly 3.5 GB for attention layers and about 90 GB for experts in FP16, which exceeds a single GPU.

The approaches, in roughly increasing order of complexity, are as follows.

1. Weight offloading (FlexGen, Mixtral-Offloading, DeepSpeed Zero-Offload lineages): rarely used experts are kept in CPU memory and copied to the GPU on demand. Copying an expert's weights takes over 50 ms while executing it takes around 2 ms, so the PCIe copy dominates.
2. CPU compute ([Fiddler](https://arxiv.org/abs/2402.07033)): Fiddler moves the activations to the weights instead of the weights to the compute. Activations are small (under 0.1 ms to copy), so experts resident in CPU memory are computed on the CPU. Fiddler profiles expert popularity, places frequently selected experts on the GPU, and per token solves a placement problem, minimizing the max of CPU-side and GPU-side latency. It reports 8.2-10.1x over Mixtral-Offloading and 19.4-22.5x over DeepSpeed-MII.
3. Popularity-aware placement: expert popularity at inference time is not uniform (balancing losses shape training-time load, and real traffic is skewed). Collecting expert selection paths after load balancing converges, and allocating resources to the experts predicted to be popular, approaches the performance of oracle placement.

At the large scale end, [DeepSeek-V3's deployment](https://arxiv.org/abs/2412.19437) separates prefill from decode. Prefill runs 32-way expert parallelism (8 experts per GPU) with redundant copies of hot experts and routing constrained to limit InfiniBand traffic. Decode spreads to 320 GPUs across 40 nodes: attention runs TP4 with sequence parallelism and DP80, experts run EP320 so each GPU holds a single expert, 64 GPUs carry redundant and shared experts, and attention micro-batches overlap with expert micro-batches to hide communication.

## Batching expert computation

Within one device, running each expert's tokens as a separate GEMM forgoes the benefit of batching. The GroupGemm pattern recovers it. Tokens are routed and then permuted so that each expert's tokens are contiguous, all experts run in one grouped GEMM kernel, and the outputs are un-permuted and mixed with the gating weights. The permutation indices come from a prefix sum over the expert-selection mask (binary mask, cumsum over the flattened transpose, reshape), which parallelizes well on a GPU.

## Lineage: from sparsely-gated MoE to dropless routing

The systems problems of MoE predate the DeepSeek models. [Shazeer et al. (2017)](https://arxiv.org/abs/1701.06538) introduced the sparsely-gated MoE layer, with up to thousands of expert FFNs between stacked LSTM layers, with a trainable gate selecting a sparse combination per example, reporting over 1000x model capacity increase with only minor efficiency losses. The paper already faced the central systems problem of MoE. Routing decisions are data-dependent, so the amount of work sent to each device varies at runtime.

[GShard](https://arxiv.org/abs/2006.16668) (Lepikhin et al. 2020) treated this as a distributed systems problem. It provides a set of lightweight sharding annotations and an XLA compiler extension that automatically inserts the cross-device communication for a Sparsely-Gated MoE Transformer, and it scaled multilingual machine translation past 600 billion parameters across 2048 TPU v3 cores in 4 days. GShard also introduced the [capacity factor and hard token dropping](#capacity-factor-and-token-dropping), because a compiler-generated program needs statically-shaped tensors, and expert token counts are only known at runtime.

Switch Transformers ([Fedus et al. 2021](https://arxiv.org/abs/2101.03961)) simplified the routing to top-1 and popularized the auxiliary balancing loss given under [Training difficulties](#training-difficulties). [MegaBlocks](https://arxiv.org/abs/2211.15841) (Gale et al. 2022) addresses the capacity-factor and token-dropping tradeoff at the kernel level rather than in the routing algorithm. It reformulates MoE computation as block-sparse matrix operations with custom GPU kernels, so that variable per-expert token counts map onto hardware without padding to a fixed capacity or dropping the overflow. The paper reports end-to-end training speedups up to 40% over Tutel and 2.4x over dense Megatron-LM training at matched quality. This approach is called dropless routing.

## Capacity factor and token dropping

A compiler or a fixed-shape kernel needs to allocate a fixed-size buffer per expert before it knows how many tokens will route there. Given $T$ tokens, $N$ experts, and top-$k$ routing, the expected tokens per expert is $\frac{kT}{N}$; the **capacity factor** $c$ scales that into an actual buffer size, $\text{capacity} = c \cdot \frac{kT}{N}$. GShard-style systems set $c > 1$ (commonly 1.25-2) to absorb the imbalance that a router produces even with a balancing loss pushing toward uniformity. Tokens that route to an expert already at capacity are **dropped**: their contribution from that expert is zero (only the residual/shared-expert path, if any, carries them forward), which removes the gradient signal between that token and that expert and reduces quality on the dropped tokens. Raising $c$ reduces drop rate but increases wasted compute and memory, since every expert allocates its full capacity buffer whether or not tokens fill it. **Dropless routing** (MegaBlocks) avoids the tradeoff by using block-sparse kernels that size per-expert work exactly to the tokens actually routed, at the cost of losing the fixed-shape assumption that made the compiler-driven GShard approach simple to generate code for.

## Token-to-expert routing and all-to-all path

Expert parallelism spreads $N$ experts across $P$ devices. A token's activation is computed wherever the token lives, then must physically move to the device holding its selected expert, and the output must move back. The round trip consists of the dispatch and combine all-to-all collectives. The diagram shows the routing decisions that drive them for two tokens on two devices with top-1 routing.

```mermaid
flowchart LR
    subgraph Dev0["Device 0"]
        T0["token A<br/>(lives here)"]
        E0["Expert 0<br/>(lives here)"]
    end
    subgraph Dev1["Device 1"]
        T1["token B<br/>(lives here)"]
        E1["Expert 1<br/>(lives here)"]
    end
    T0 -- "router picks Expert 1<br/>(dispatch all-to-all)" --> E1
    T1 -- "router picks Expert 0<br/>(dispatch all-to-all)" --> E0
    E1 -- "output back to token A<br/>(combine all-to-all)" --> T0
    E0 -- "output back to token B<br/>(combine all-to-all)" --> T1
```

Every token whose chosen expert is on another device crosses between devices twice per MoE layer. For this reason all-to-all volume, rather than FLOPs, typically limits MoE training throughput at scale, consistent with the 34.1% step-time figure above.

## Expert, tensor, and data parallelism for MoE: cost comparison

The three axes shard different state and incur different communication costs for an MoE layer with $N$ experts, model dimension $d$, and $T$ tokens per device per step:

| Strategy | What it shards | Communication per MoE layer | Scales with |
| --- | --- | --- | --- |
| Expert parallelism | experts across devices | 2 all-to-alls of routed-token activations, size $\approx kTd$ bytes total | number of devices $P$ (more hops, same total payload) |
| Tensor parallelism | each expert's weight matrices | AllReduce per expert-local GEMM, same $8bsh$-style cost as dense TP (see [[ml/serving-systems/parallelism|Parallelism]]) | tensor-parallel width $t$, independent of $N$ |
| Data parallelism | full model (incl. all experts) replicated | AllReduce of gradients for every parameter, incl. every expert's weights, every step | total parameter count, which is $N\times$ larger with more experts |

Expert parallelism is the only one of the three whose communication volume scales with *token count* rather than *parameter count*, and this property gives MoE's decoupling of parameters from computation its systems advantage. Growing $N$ (more experts) increases data-parallel and tensor-parallel communication (more weights to synchronize or shard) and leaves expert-parallel communication roughly constant (the same tokens, spread over more, smaller experts). Production systems combine all three, as the DeepSeek-V3 deployment shows, with TP within a node for attention and each expert's own GEMMs, EP to place experts, and DP to replicate everything else.

## Why training-time balance does not guarantee serving-time balance

The balancing losses under [Training difficulties](#training-difficulties) balance load over the *training* distribution of a batch, which mixes many prompts and topics, and they do not constrain the distribution that a single production request or topical cluster of traffic produces. The following argument is an inference, not a published measurement. A router trained to balance load in aggregate can still send an overwhelming share of a topically narrow request stream (for example, customer-support tickets about billing) to whichever few experts specialized on that content during training, because those experts are the best fit for that traffic even though the aggregate training batch remained balanced. Skewed popularity at serving time is the premise of both Fiddler's placement problem and popularity-aware placement, described under [Serving MoE models](#serving-moe-models). DeepSeek-V3's deployment addresses it directly by replicating hot experts at inference rather than relying on training-time balance.

## Comparing deployed MoE designs

| Design | Routing | Balancing mechanism | Capacity handling | Notable systems technique |
| --- | --- | --- | --- | --- |
| Switch Transformer | top-1 | auxiliary load-balancing loss | fixed capacity factor, drops overflow | simplifies top-k to top-1 for speed |
| MegaBlocks | top-k, framework-agnostic | inherited from base model | dropless (block-sparse kernels) | reformulates MoE as block-sparse GEMM |
| Mixtral | top-2, no shared experts | implicit (no aux loss reported) | standard capacity-factor framework | fewer, larger experts (8 total) |
| DeepSeek v3 | top-8 of 256, sigmoid scoring | aux-loss-free per-expert bias | fine-grained experts, top-M device routing | hot-expert replication at serving, prefill/decode disaggregated EP width |

## Related notes

- [[ml/serving-systems/parallelism|Parallelism]]
- [[ml/serving-systems/performance-modeling|Performance Modeling]]
- [[ml/serving-systems/batching|Batching]]
- [[ml/serving-systems/distributed-training|Distributed Training of Large Language Models]]
