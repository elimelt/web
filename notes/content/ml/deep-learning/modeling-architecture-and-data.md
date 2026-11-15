---
title: Modeling, Architecture, and Data
category: Deep Learning
tags:
  - deep learning
  - modeling
  - architecture
  - data representation
  - regularization
  - attention
  - resnet
date: 2026-07-31
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: The choice of model class, objective, data representation and training setup, with emphasis on inductive bias, optimization stability, scaling laws, compute-optimal training and the effect of inference cost on model size.
sources:
  - title: Deep Residual Learning for Image Recognition
    url: https://arxiv.org/abs/1512.03385
    type: paper
  - title: Attention Is All You Need
    url: https://arxiv.org/abs/1706.03762
    type: paper
  - title: Ioffe and Szegedy (2015), Batch Normalization
    url: https://arxiv.org/abs/1502.03167
    type: paper
  - title: Kaplan et al. (2020), Scaling Laws for Neural Language Models
    url: https://arxiv.org/abs/2001.08361
    type: paper
  - title: Hoffmann et al. (2022), Training Compute-Optimal Large Language Models
    url: https://arxiv.org/abs/2203.15556
    type: paper
  - title: Touvron et al. (2023), LLaMA - Open and Efficient Foundation Language Models
    url: https://arxiv.org/abs/2302.13971
    type: paper
  - title: Srivastava et al. (2014), Dropout
    url: https://www.cs.toronto.edu/~rsalakhu/papers/srivastava14a.pdf
    type: paper
---

Model design for a supervised learning problem consists of choosing the prediction target and loss, the representation of the data, the model class and its inductive biases, and the allocation of training compute between parameters and data.

The choice of architecture depends on decisions that precede it: what the model must predict, what structure the data has, and which resource (training compute, inference cost or labeled data) is the binding constraint.

## Start from the Interface

A supervised learning problem is defined independently of any model class, by

- input space $x$
- output space $y$
- loss $\mathcal{L}(\hat{y}, y)$
- deployment constraints

Examples of such interfaces include

- token sequence to next token
- image to class label
- image to dense segmentation mask
- graph to node labels
- feature vector to scalar score

The output head and the loss follow from the interface. Classification uses cross-entropy, regression a real-valued loss, and autoregressive generation a factorized log-likelihood.

## Architecture Is an Inductive Bias

Each architecture encodes assumptions about the structure of its input.

| Data structure | Bias | Typical architecture |
| --- | --- | --- |
| tabular or fixed vectors | dense interactions | MLP |
| 2D grids | locality and translation equivariance | CNN |
| ordered sequences | state evolution through time | RNN / LSTM / GRU |
| long-range relational sequences | content-based routing | Transformer |
| irregular graphs | neighborhood message passing | GNN |

An architecture encodes a hypothesis about which symmetries of the data are relevant. When the hypothesis holds, the model requires fewer parameters and less data. When it does not, the constraint makes optimization harder without improving generalization.

> [!abstract] Architecture selection as prior selection
> Each row of the table corresponds to an assumption about the data. A CNN assumes that a pattern is equally relevant at every position of the grid, an RNN that the past can be summarized in a fixed-size state, and a GNN that a node's neighbors are informative about it. The choice of architecture determines which of these assumptions are built into the model and which must instead be learned from data.

## The Bias-Variance Question Shows Up as Architecture

A high-capacity model can represent a large class of functions, but with finite data and finite compute, training need not find one that generalizes.

When the structure of the data is known, it can be encoded in the architecture, for example with

- local convolutions instead of a fully connected image classifier
- causal masking instead of unconstrained sequence attention
- message passing instead of flattening a graph into arbitrary order

The heuristic applies across data modalities and architecture families.

## Optimization Choices Are Architectural Choices

Several widely cited techniques are often described as "training tricks." They can also be understood as changes to the effective architecture.

### Residual Connections

ResNet reframes a block as

$$
y = x + F(x)
$$

so that the block learns a residual instead of the mapping $H(x)$ directly. The paper's motivation is the **degradation problem**: deeper plain nets can have higher training error than shallower ones even though a deeper model contains the shallower solution as a special case via identity layers.

The identity path gives both activations and gradients a direct route through the network that bypasses the learned transformation.

### Normalization

BatchNorm inserts

$$
\hat{x}^{(k)} = \frac{x^{(k)} - \mu_\mathcal{B}^{(k)}}{\sqrt{(\sigma_\mathcal{B}^{(k)})^2 + \epsilon}},
\qquad
y^{(k)} = \gamma^{(k)} \hat{x}^{(k)} + \beta^{(k)}
$$

into the network. Normalization changes the conditioning of the optimization problem with respect to parameter scale. In practice it often permits larger learning rates and reduces sensitivity to initialization.

### Regularization

Dropout changes the training distribution itself. Instead of a single deterministic hidden layer, training samples a different subnetwork at each step from a family that shares weights. Weight decay changes which solutions have low regularized loss. Data augmentation changes which invariances the training objective favors.

When the architecture is appropriate for the data, these choices can affect the result more than further architectural changes.

## Data Choices Are Model Choices

A model receives information about the task only through the tensors constructed from the data. The relevant choices include

- tokenization
- feature extraction
- target construction
- balancing or reweighting
- negative sampling
- train/validation split
- augmentation
- deduplication

For sequence models these choices can change the task itself. Bahdanau attention was motivated by the failure of fixed-length sentence encodings. GPT-style language modeling depends strongly on tokenization and context length, and recommender training depends strongly on how negatives are sampled.

## Compute, Data, and Scale

For language models, the relationship between loss, model size, data and compute has been measured precisely enough to be used for planning. $N$ denotes the non-embedding parameter count, $D$ the number of training tokens, $C$ the training compute in FLOPs, and $L$ the autoregressive cross-entropy loss in nats per token. For dense transformers, training cost is approximately

$$
C \approx 6ND
$$

FLOPs, since a forward pass costs about $2N$ FLOPs per token and the backward pass about $4N$ ([Kaplan et al. 2020](https://arxiv.org/abs/2001.08361), §2.1). The scaling relations that follow are empirical fits to training runs rather than derived laws. The fits hold over many orders of magnitude, but extrapolation beyond the measured range is conjecture.

### Kaplan-style scaling

[Kaplan et al. (2020)](https://arxiv.org/abs/2001.08361) found that when only one resource limits performance, loss follows a power law in that resource:

$$
L(N) = \left(\frac{N_c}{N}\right)^{\alpha_N}, \quad
L(D) = \left(\frac{D_c}{D}\right)^{\alpha_D}, \quad
\alpha_N \approx 0.076, \;\; \alpha_D \approx 0.095,
$$

with $N_c \approx 8.8 \times 10^{13}$, $D_c \approx 5.4 \times 10^{13}$, and loss along the compute-efficient frontier falling as $L \propto C^{-0.050}$. Within a wide range of shapes, the ratio of width to depth has little effect on loss compared with total scale. Two consequences follow. Larger models are more sample-efficient, and compute-optimal training stops well before convergence. For a fixed budget, the paper concluded that $N \propto C^{0.73}$, so that most additional compute should go to model size, with **very large models trained on a relatively modest amount of data and stopped significantly before convergence**.

### Chinchilla: compute-optimal rebalanced

[Hoffmann et al. (2022)](https://arxiv.org/abs/2203.15556) repeated the measurement with the learning-rate schedule matched to each token budget. Kaplan's runs had reused schedules tuned for longer horizons, which understated the benefit of additional data. Hoffmann et al. fit a parametric loss surface (their eq. 10):

$$
L(N, D) = E + \frac{A}{N^{\alpha}} + \frac{B}{D^{\beta}},
\qquad
E \approx 1.69,\; A \approx 406.4,\; B \approx 410.7,\; \alpha \approx 0.34,\; \beta \approx 0.28.
$$

$E$ is the irreducible entropy of text; the other two terms are the finite-model and finite-data penalties. Minimizing subject to $C = 6ND$ gives $N^\star \propto C^{0.46}$ and $D^\star \propto C^{0.54}$, so parameters and tokens should scale **together**, at roughly 20 tokens per parameter at the measured scales, in place of Kaplan's $N \propto C^{0.73}$. The principal validation was that Chinchilla (70B parameters, 1.4T tokens) outperformed Gopher (280B parameters, 300B tokens) across benchmarks with the same training budget. The fitted surface accounts for this result. With both at $C \approx 5.8 \times 10^{23}$, $L(N,D)$ is 1.937 for Chinchilla's allocation and 1.993 for Gopher's, and the 4x smaller model also has 4x lower inference cost.

### A worked sizing example

Consider a training budget of $C = 10^{23}$ FLOPs. The table evaluates the Chinchilla fit at several values of $N$, with $D = C/6N$ (computed with the constants above, by a script run in the repository's virtual environment).

| Allocation | $N$ | $D$ | predicted $L$ |
| --- | --- | --- | --- |
| fit optimum | 15B | 1.1T | 2.005 |
| 2x larger model | 30B | 0.56T | 2.013 |
| Gopher-style | 280B | 60B | 2.137 |

The optimum at this budget is near 15B parameters and 1.1T tokens, about 78 tokens per parameter. Because the fitted exponents satisfy $\alpha \ne \beta$, the optimal ratio increases with budget instead of remaining at exactly 20. The predicted loss is asymmetric about the optimum. Doubling the parameter count beyond the optimum increases it by 0.008 nats, while the Gopher-style allocation, with far fewer tokens, increases it by 0.13 nats, which at these scales is roughly the gap between successive model generations.

### Inference changes the optimum

Compute-optimal allocation is the appropriate target only when training is the only cost. Serving cost scales with $N$ for every token generated over the model's deployment. [LLaMA](https://arxiv.org/abs/2302.13971) made this argument explicitly: the Chinchilla objective "disregards the inference budget," and given a target quality level "the preferred model is not the fastest to train, but the fastest at inference." Touvron et al. accordingly trained 7B to 65B models on 1 to 1.4T tokens, far beyond the guideline of about 20 tokens per parameter, and [Llama 2](https://arxiv.org/abs/2307.09288) increased the count to 2T. The table lists the allocations of several widely cited models.

| Model | $N$ | $D$ | tokens/param |
| --- | --- | --- | --- |
| GPT-3 (2020) | 175B | 300B | ~1.7 |
| Gopher (2021) | 280B | 300B | ~1.1 |
| Chinchilla (2022) | 70B | 1.4T | 20 |
| LLaMA-7B (2023) | 7B | 1T | ~143 |
| Llama 2-70B (2023) | 70B | 2T | ~29 |

By the Chinchilla criterion, the models before Chinchilla were undertrained, and the open models after LLaMA are deliberately overtrained. They spend additional training compute once to reduce inference compute on every token served. The fitted loss surface quantifies the cost. LLaMA-7B's allocation predicts $L \approx 2.052$, and the same $4.2 \times 10^{22}$ FLOPs allocated compute-optimally predicts $2.050$, a negligible difference, while inference cost falls, relative to the compute-optimal alternative of about 10B parameters, by the ratio of the model sizes. Because the loss surface is flat near the optimum, overtraining costs little in loss.

> [!tip] Flat loss optimum and inference cost
> Near the Chinchilla optimum, moving along the fixed-compute curve changes the loss by thousandths of a nat, while halving $N$ halves the cost of every token the model serves. When deployment volume is large, this asymmetry makes the smaller, overtrained model the lower-cost choice, although it is "suboptimal" by the training-only criterion.

Architecture affects the same tradeoff. Sparse mixture-of-experts models decouple parameter count from per-token FLOPs, increasing capacity without a proportional increase in inference cost, at the cost of memory, routing complexity and more difficult [[ml/serving-systems/parallelism|parallelism]]. Small dense overtrained models make the opposite tradeoff and are the simplest to serve.

### Data-side caveats

Token count is not a sufficient statistic for $D$. Deduplication affects results (near-duplicates consume budget and encourage memorization), as does mixture composition (code, web and books scale differently and interact with downstream tasks), and the supply of data is finite. [Muennighoff et al. (2023)](https://arxiv.org/abs/2305.16264) measured that repeating a fixed corpus for up to about 4 epochs costs almost nothing compared with fresh data, and that the returns from repetition decay to zero by about 16 epochs. All the scaling fits also assume a fixed data distribution in which only quantity varies. An intervention on data quality changes the fitted constants, which is why it can be worth more than additional parameters.

> [!warning] Scaling fits as interpolations
> The power-law fits hold over the measured range with the measured data distribution. Extrapolating orders of magnitude beyond the fitted runs, or applying the constants after a major change in data mixture or quality, is conjecture. Chinchilla was itself a correction to Kaplan's fit, made necessary by a learning-rate-schedule confound.

Once the architecture family is adequate for the data, data quality and compute allocation tend to affect loss more than small structural changes. The scaling results make this quantitative. The loss reduction from each additional parameter or token follows a power law with a small exponent, so the largest gains come from the allocation between parameters and tokens and from the constants that data quality determines.

## A Practical Decision Order

Before a model is designed, the following questions should be answered.

1. What downstream decision consumes the model output?
2. Which invariances or constraints should the model obey?
3. Is training compute scarce, inference latency scarce, or labeled data scarce?
4. What kinds of errors are expensive?
5. What part of the data pipeline is policy-shaped, biased, or weakly labeled?

The answers narrow the design space.

## Example: Translation

A translation model has:

- one fully observed source sequence
- one generated target sequence
- alignment between them

These properties correspond to an encoder-decoder architecture with cross-attention, which is the design of the original transformer.

## Example: Long-Context Language Modeling

A language model needs:

- causal dependence
- parallel training over positions
- long-range interaction

These requirements favor a decoder-only transformer over a plain RNN.

## Example: Small Scientific Dataset

When data is scarce and the structure is known, a smaller model with a stronger prior tends to generalize better than a large flexible one, because in that regime the dominant source of error is variance.

## Minimal PyTorch Spec

```python
from dataclasses import dataclass
import torch.nn as nn

@dataclass
class Spec:
    input_dim: int
    output_dim: int
    task: str

def make_head(spec: Spec) -> nn.Module:
    if spec.task == "classification":
        return nn.Linear(spec.input_dim, spec.output_dim)
    if spec.task == "regression":
        return nn.Linear(spec.input_dim, spec.output_dim)
    if spec.task == "autoregressive":
        return nn.Linear(spec.input_dim, spec.output_dim, bias=False)
    raise ValueError(spec.task)
```

The specification is deliberately minimal. It fixes the interface, meaning the input dimension, output dimension and task, before any architectural choice is made.

## Failure Modes

- loss mismatched to the downstream objective
- architecture blind to known structure
- evaluation split not representative of deployment
- target leakage in preprocessing
- over-investing in parameter count when the bottleneck is noisy or biased data
- over-investing in architectural novelty when the bottleneck is compute or token budget

## Related Notes

- [[ml/deep-learning/neural-networks-from-scratch|Neural Networks from Scratch]]
- [[ml/deep-learning/decoder-only-transformers|Decoder-Only Transformers]]
- [[ml/deep-learning/convolutional-neural-networks|Convolutional Neural Networks]]
- [[ml/serving-systems/parallelism|Parallelism]]
- [[ml/serving-systems/performance-modeling|Performance Modeling]]

## Sources

- [He et al. (2015), Deep Residual Learning for Image Recognition](https://arxiv.org/abs/1512.03385)
- [Vaswani et al. (2017), Attention Is All You Need](https://arxiv.org/abs/1706.03762)
- [Ioffe and Szegedy (2015), Batch Normalization](https://arxiv.org/abs/1502.03167)
- [Kaplan et al. (2020), Scaling Laws for Neural Language Models](https://arxiv.org/abs/2001.08361)
- [Hoffmann et al. (2022), Training Compute-Optimal Large Language Models](https://arxiv.org/abs/2203.15556)
- [Touvron et al. (2023), LLaMA: Open and Efficient Foundation Language Models](https://arxiv.org/abs/2302.13971)
- [Touvron et al. (2023), Llama 2: Open Foundation and Fine-Tuned Chat Models](https://arxiv.org/abs/2307.09288)
- [Muennighoff et al. (2023), Scaling Data-Constrained Language Models](https://arxiv.org/abs/2305.16264)
- [Srivastava et al. (2014), Dropout](https://www.cs.toronto.edu/~rsalakhu/papers/srivastava14a.pdf)
