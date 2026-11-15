---
title: Recommender Systems
aliases:
  - recc-sys/reccomender-systems
category: Recommender Systems
tags:
  - recommender systems
  - collaborative filtering
  - matrix factorization
  - implicit feedback
  - bpr
  - personalization
  - ranking
  - selection bias
  - exposure bias
  - counterfactual evaluation
  - ads
  - candidate generation
  - wide and deep
date: 2025-04-27
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: The recommendation problem and its recurring components, from explicit and implicit feedback and simple baselines through latent-factor models and ranking objectives to the multi-stage production pipelines used at scale and the gap between offline and online evaluation.
sources:
  - title: Koren, Bell, and Volinsky (2009), Matrix Factorization Techniques for Recommender Systems
    url: https://doi.org/10.1109/MC.2009.263
    type: paper
  - title: Hu, Koren, and Volinsky (2008), Collaborative Filtering for Implicit Feedback Datasets
    url: https://yifanhu.net/PUB/cf.pdf
    type: paper
  - title: Rendle et al. (2009), BPR
    url: https://arxiv.org/pdf/1205.2618
    type: paper
---

A recommender system determines, for a user $u$, which items $i$ of a catalog to expose and in what order, given records of past interactions and features of users and items. Its training data is sparse, since each user interacts with a small fraction of the catalog, and it is shaped by the exposure decisions of earlier versions of the system.

Several components recur across implementations: sparse supervision from implicit feedback, latent structure in the user-item interaction matrix, the decomposition of serving into retrieval and ranking stages, and the mismatch between offline logs and online behavior.

## The Core Problem

In its simplest form, the recommendation problem is the question

> given user $u$, which items $i$ should appear near the top of the list?

Several properties of the data make the problem difficult:

- Users interact with only a tiny fraction of the catalog.
- Missing interactions are ambiguous.
- Preferences drift.
- Exposure itself changes the future data.

The training table is therefore sparse, dependent on the exposure policy, and nonstationary.

## Signals: Explicit Versus Implicit

Recommender systems use two kinds of feedback.

### Explicit Feedback

Explicit feedback consists of ratings, thumbs-up events, and stated preferences. It is direct and usually scarce.

### Implicit Feedback

Implicit feedback consists of clicks, purchases, watches, dwell time, and skips. It is abundant and weak. The absence of an interaction does not imply dislike, and often indicates only that the item was not exposed or was not of interest at that moment.

The meaning of these labels, treated in [[ml/recommender-systems/ranking-objectives|ranking objectives and implicit feedback]], must be settled before a model family is chosen.

## Baselines Still Matter

Simple recommenders often remain in production for a long time because they are robust and inexpensive to compute.

- **Popularity**: recommend the most popular items.
- **Recent popularity**: same idea, but with a freshness window.
- **Item-item co-occurrence**: recommend things often consumed with what the user already consumed.

These baselines are coarse but serve as reference points. A new model that does not outperform recent popularity in online testing usually indicates an error in the modeling approach or in the evaluation setup.

## Latent Factor Models

Matrix factorization became a widely used collaborative-filtering model because it reduces an enormous sparse table to a lower-dimensional geometric problem.

User $u$ and item $i$ are represented by vectors $x_u, y_i \in \mathbb{R}^k$ and scored with

$$
\hat{r}_{ui} = x_u^\top y_i
$$

The model is effective because user-item interactions often have low-dimensional structure. In place of an arbitrary score for every pair, it learns a compact representation of user tastes and item attributes.

For explicit feedback, the objective is commonly regularized squared error on observed entries. For implicit feedback, a confidence-weighted objective is more appropriate:

$$
\min_{x_*, y_*} \sum_{u,i} c_{ui}(p_{ui} - x_u^\top y_i)^2 + \lambda \left(\sum_u \lVert x_u \rVert^2 + \sum_i \lVert y_i \rVert^2 \right)
$$

This is the formulation of Hu, Koren, and Volinsky, which gives observed interactions higher confidence than zeros instead of treating zeros as negatives of equal weight.

## Ranking and Prediction

Much of recommendation concerns the ordering of items more than the estimation of ratings. Pairwise and listwise objectives address the ordering directly. BPR, RankNet, LambdaRank, and LambdaMART all optimize the ranking more directly than plain regression. If the product shows only a top-$k$ list, the relative order can matter more than absolute calibration.

No single objective is correct in every case. Ads systems often require calibrated click probabilities, while media feeds depend more on top-of-list order. The loss is chosen according to the downstream consumer of the score.

## The Multi-Stage Pipeline

For large catalogs, recommenders are almost always built as staged systems:

1. retrieve a candidate set
2. rank the candidates with a richer model
3. apply filters or business constraints

The staging is required by the computational cost of scoring large catalogs within tight latency budgets.

[[ml/recommender-systems/retrieval-and-ranking|Retrieval and Ranking]] describes the division of work between the stages. [[ml/recommender-systems/two-tower-retrieval|Two-Tower Retrieval]] describes a common retrieval architecture. [[ml/recommender-systems/wide-and-deep|Wide and Deep]] is a ranking-stage example of combining sparse and dense features once the candidate set is small enough.

## Beyond Bags of Interactions

Basic matrix factorization discards the order of interactions and the structure of the interaction graph. Many later recommenders model one or both.

- **Sequential models** capture short-horizon intent and recency.
- **Graph models** propagate signal across the user-item interaction graph and related structures.

These models are described in [[ml/recommender-systems/sequential-recommendation|Sequential and Graph Recommenders]].

## Offline and Online Evaluation

Offline accuracy is useful but often misleading.

The training and evaluation logs come from an earlier policy that determined what users saw, which creates exposure bias and feedback loops. A model can score well offline by reproducing the omissions of the current policy and then perform poorly online.

Production recommender systems therefore rely on:

- randomized logging
- exploration
- counterfactual evaluation
- A/B tests on actual business metrics

These methods are treated in [[ml/recommender-systems/bias-and-marketplace-effects|Bias, Marketplace Effects, and Counterfactual Evaluation]].

## Components of a Production Recommender

A production recommender typically combines:

- a retrieval system for recall
- a ranker for precision
- a logging policy that decides what can be learned next
- a marketplace allocator, whether or not it is designed as one

Because recommendation controls exposure, it allocates attention among items and producers in addition to predicting user preferences.

## Related Notes

- [[ml/recommender-systems/ranking-objectives|Ranking Objectives and Implicit Feedback]]
- [[ml/recommender-systems/retrieval-and-ranking|Retrieval and Ranking]]
- [[ml/recommender-systems/sequential-recommendation|Sequential and Graph Recommenders]]
- [[ml/recommender-systems/bias-and-marketplace-effects|Bias, Marketplace Effects, and Counterfactual Evaluation]]
- [[ml/recommender-systems/two-tower-retrieval|Two-Tower Retrieval and the MovieLens 100K experiment]]

## Sources

- [Koren, Bell, and Volinsky (2009), Matrix Factorization Techniques for Recommender Systems](https://doi.org/10.1109/MC.2009.263)
- [Hu, Koren, and Volinsky (2008), Collaborative Filtering for Implicit Feedback Datasets](https://yifanhu.net/PUB/cf.pdf)
- [Rendle et al. (2009), BPR: Bayesian Personalized Ranking from Implicit Feedback](https://arxiv.org/pdf/1205.2618)
