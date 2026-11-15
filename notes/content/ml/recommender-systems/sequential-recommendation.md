---
title: Sequential and Graph Recommenders
category: Recommender Systems
tags:
  - recommender systems
  - sequential recommendation
  - graph recommenders
  - implicit feedback
  - exposure bias
  - transformers
  - gnn
date: 2026-07-31
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: How recommenders exploit order and graph structure, from self-attentive sequence models to graph-based embedding propagation.
sources:
  - title: Kang and McAuley (2018), Self-Attentive Sequential Recommendation
    url: https://arxiv.org/pdf/1808.09781
    type: paper
  - title: Sun et al. (2019), BERT4Rec
    url: https://arxiv.org/abs/1904.06690
    type: paper
  - title: Ying et al. (2018), PinSage
    url: https://cs.stanford.edu/people/jure/pubs/pinsage-kdd18.pdf
    type: paper
  - title: He et al. (2020), LightGCN
    url: https://arxiv.org/abs/2002.02126
    type: paper
---

Sequential recommenders model a user's history as an ordered sequence of interactions and predict the next interaction from it. Graph recommenders model the user-item log as a graph and compute user and item representations by propagating information over graph neighborhoods.

Plain collaborative filtering treats user history as an unordered bag and so discards two signals that these models use:

- **order**: what happened recently and in what sequence
- **structure**: which users and items sit near each other in the interaction graph

## Sequential Recommendation

A user's next action depends on more than the multiset of items the user consumed. Recency and session context affect it, and the same item can indicate different intents depending on the items that immediately preceded it.

If a user watched:

1. "intro to transformers"
2. "attention is all you need explained"
3. "kv cache implementation"

the next relevant item differs from the one that would follow a month of unrelated clicks.

## SASRec

SASRec applied self-attention to sequential recommendation. The model treats a user's history as a sequence and predicts future items from attention over prior positions.

Beyond the effectiveness of the transformer architecture itself, the paper's main empirical claim is that self-attention adapts to dataset density:

- on dense datasets, the model can use longer-range dependencies
- on sparse datasets, it attends mainly to recent events

The paper also reports higher speed, since self-attention permits more parallel computation in training and serving than earlier RNN-based sequence models.

## BERT4Rec

BERT4Rec uses a bidirectional Transformer with a Cloze-style masked-item objective. Instead of predicting only the next item from the left context, it predicts masked items from both left and right context within the observed sequence.

The objective yields a stronger sequence representation but changes the task, so that BERT4Rec is a denoising model of the sequence and not a pure autoregressive next-item model.

Sequence models for recommendation therefore need not be strictly left-to-right, and with a suitable training objective, bidirectional context can improve them.

## Where Sequence Models Help

Sequence-aware recommenders help when:

- user intent changes quickly
- sessions have local coherence
- recency matters more than long-run taste
- item transitions themselves carry signal

They are especially useful in media, shopping, and short-session surfaces, where the immediately preceding interaction is often the strongest available feature.

## What They Do Not Solve

Sequence models share the other problems of recommender systems:

- exposure bias in the logs
- cold start for fresh items
- weak supervision from implicit feedback
- catalog constraints that the model itself does not represent

They also introduce a further problem, the definition of sequence boundaries. Sessionization, truncation length, and negative sampling all affect the results.

## Graph Recommenders

The user-item log is also a graph. Users connect to items through interactions. Items connect indirectly through shared audiences. Boards, creators, or taxonomies may add more edges.

Graph-based recommenders use that structure by propagating information over neighborhoods, in addition to direct features or sequence order.

## PinSage

PinSage is a graph recommender deployed in production at Pinterest. It uses random walks and graph convolutions to build item embeddings at Pinterest scale. Its contribution lies less in the particular aggregator than in the use of local graph neighborhoods, which encode context that pure ID-based factorization misses.

Graph structure is most useful when item content is rich and the interaction graph is very large. Pins linked through boards, images, and co-save behavior carry more signal than a flat user-item matrix represents.

## LightGCN

LightGCN simplifies graph convolution for collaborative filtering. The paper argues that when GCNs are adapted to collaborative filtering, two common neural-network components are often unnecessary:

- feature transformations
- nonlinear activations

It claims that simple linear neighborhood aggregation suffices and often performs better. The reported result is about **16% relative improvement on average** over NGCF under the same setting.

> [!quote] The ablation finding
> "We empirically find that the two most common designs in GCNs -- feature transformation and nonlinear activation -- contribute little to the performance of collaborative filtering. Even worse, including them adds to the difficulty of training and degrades recommendation performance."
> — [He et al. (2020), LightGCN](https://arxiv.org/abs/2002.02126), abstract

The finding may extend beyond graph models. When the graph signal is already expressive, additional nonlinear components can make training harder without improving accuracy.

## Sequence Versus Graph

The two approaches are complementary and address different questions.

| Signal type | Best question it answers |
| --- | --- |
| Sequential model | What is this user likely to do next, given recent behavior? |
| Graph model | Which users and items occupy nearby regions of the interaction graph? |

A platform can use both:

- sequence models for short-horizon intent
- graph models for broad structural similarity and retrieval

## Where They Fit in a System

- Retrieval can use graph-derived item embeddings.
- Ranking can use sequence encoders over recent activity.
- Feature pipelines often expose both graph and sequence summaries to later models.

As catalog size and traffic grow, systems tend to divide these roles among separate components instead of relying on a single end-to-end model.

## Related Notes

- [[ml/recommender-systems/recommender-systems|Recommender Systems]]
- [[ml/recommender-systems/two-tower-retrieval|Two-Tower Retrieval]]
- [[ml/recommender-systems/bias-and-marketplace-effects|Bias, Marketplace Effects, and Counterfactual Evaluation]]
- [[systems/research/sparsity-notes|Faster Causal Self Attention]]
- [[ml/recommender-systems/two-tower-retrieval|Two-Tower Retrieval and the MovieLens 100K experiment]]

## Sources

- [Kang and McAuley (2018), Self-Attentive Sequential Recommendation](https://arxiv.org/pdf/1808.09781)
- [Sun et al. (2019), BERT4Rec](https://arxiv.org/abs/1904.06690)
- [Ying et al. (2018), PinSage](https://cs.stanford.edu/people/jure/pubs/pinsage-kdd18.pdf)
- [He et al. (2020), LightGCN](https://arxiv.org/abs/2002.02126)
