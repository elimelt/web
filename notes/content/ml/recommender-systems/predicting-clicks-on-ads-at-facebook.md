---
title: Practical Lessons from Predicting Clicks on Ads at Facebook
aliases:
  - recc-sys/predicting-clicks-on-ads-at-facebook
category: Recommender Systems
tags:
  - recommender systems
  - machine-learning
  - ads
  - ctr prediction
  - gradient boosted decision trees
  - logistic regression
  - online learning
  - spark
date: 2025-05-17
updated: 2026-11-15
status: evergreen
description: How Facebook's 2014 ads CTR paper combines boosted-tree leaf features with logistic regression, then handles freshness, online learning, and calibration.
authors:
  - elimelt
  - gpt-5.6-sol
  - claude-opus-5-5
sources:
  - title: He et al. (2014), Practical Lessons from Predicting Clicks on Ads at Facebook
    url: https://quinonero.net/Publications/predicting-clicks-facebook.pdf
    type: paper
---

[He et al. (2014)](https://quinonero.net/Publications/predicting-clicks-facebook.pdf) describe the click-through-rate (CTR) prediction model in the final stage of Facebook's ads ranking cascade and measure the modeling and systems factors that determined its accuracy. The central result is a hybrid model in which gradient-boosted decision trees learn non-linear feature combinations, each reached leaf becomes a sparse binary feature, and logistic regression maps those features to a predicted click probability.

The paper also measures the effects of training-data freshness, online updates, feature pruning, and negative downsampling. It is a case study of the production system as of 2014, and Facebook's current ads stack may differ from it.

| Design question | Result reported in the paper |
| --- | --- |
| Which model works best? | GBDT leaf features followed by logistic regression outperform either component alone on normalized entropy |
| How much does freshness matter? | Daily rather than weekly retraining improves normalized entropy by about 1% in the reported setup |
| Which signals matter most? | Historical features provide most of the measured gain; contextual features still help with cold start |
| How are delayed clicks joined? | An online joiner buffers impressions until a click arrives or the labeling window expires |

The paper is a ranking case study relevant to [[ml/recommender-systems/retrieval-and-ranking|retrieval and ranking]], [[ml/recommender-systems/ranking-objectives|ranking objectives]], and [[ml/recommender-systems/recommender-systems|recommender systems]].

## Citation

- [Practical Lessons from Predicting Clicks on Ads at Facebook (He et al., ADKDD 2014)](https://quinonero.net/Publications/predicting-clicks-facebook.pdf)

## Background

The paper studies the final click prediction stage in Facebook's ads ranking cascade. Unlike sponsored search systems, Facebook did not retrieve ads by query. Ads were targeted by demographics and interests, so the set of ads eligible for a request could be very large. Ranking therefore used a cascade of models of increasing cost, and the paper addresses the last stage, at which the candidate set is small enough to justify a more expensive model.

The problem is to estimate CTR accurately enough for the downstream auction to use the score as a probability. The paper studies prediction quality and calibration and does not optimize revenue directly.

## Metrics

The main metric is normalized entropy, which is normalized log loss. It compares the model's average log loss against the loss of a baseline that always predicts the background CTR.

$$
\text{NE} = \frac{H}{H_{\max}}
$$

with

$$
H = -\frac{1}{n} \sum_{i=1}^{n} \left( \frac{1 + y_i}{2} \log(p_i) + \frac{1 - y_i}{2} \log(1 - p_i) \right)
$$

and

$$
H_{\max} = -(p \log(p) + (1 - p) \log(1 - p))
$$

Here $p$ is the empirical background CTR and $p_i$ is the model's predicted click probability for impression $i$. Lower is better.

The paper also tracks **calibration**, defined as

$$
\text{Calibration} = \frac{\text{expected clicks}}{\text{observed clicks}}
$$

so the ideal value is 1. Calibration matters because a model that orders impressions correctly but misstates their probabilities can still produce poor delivery and bidding decisions. For this reason the authors prefer NE to AUC as the main metric.

## Hybrid Model: GBDT Plus Logistic Regression

The hybrid model is built in three steps:

- train boosted decision trees in batch
- use the leaf reached in each tree as a sparse categorical feature
- feed that transformed feature vector into a logistic regression model

Each tree path becomes a learned rule. An example reaches one leaf of each tree, so the input to the linear model is a sparse binary code indicating which rules apply. The trees provide supervised non-linear feature crosses, and logistic regression learns a weight for each of those rules.

Table 1 of the paper gives the main result:

| Model | NE relative to trees-only baseline |
| --- | ---: |
| LR + Trees | 96.58% |
| LR only | 99.43% |
| Trees only | 100% |

Since lower NE is better, the hybrid outperforms either model alone. Relative to plain logistic regression, the tree transform reduces NE by about 2.85%. Relative to trees alone, it reduces NE by about 3.42%. The paper describes this as a large effect, since most routine feature engineering improves NE by only a few tenths of a percent.

Boosted trees model non-linearity and feature interactions, while logistic regression keeps the final scorer small, sparse, and inexpensive to evaluate.

## Data Freshness Matters

The authors train on one day and test on the following six days. Accuracy degrades steadily as the gap grows. They report that moving from weekly retraining to daily retraining reduces NE by about 1% for both trees and the hybrid LR-plus-tree model.

A 1% NE gain from freshness indicates that the data distribution changes from day to day. User behavior, inventory, and advertiser behavior shift quickly enough that a model trained on stale data loses revenue.

The training cost of the trees makes fully real-time retraining impractical, while the linear layer is inexpensive enough to update online.

## Online Learning for the Linear Layer

The paper compares five SGD learning-rate schemes for online logistic regression:

1. Per-coordinate learning rate
2. Per-weight square-root decay
3. Per-weight decay
4. Global decay
5. Constant learning rate

The best-performing scheme is the per-coordinate schedule

$$
\eta_{t,i} = \frac{\alpha}{\beta + \sqrt{\sum_{j=1}^{t} \nabla_{j,i}^2}}
$$

with tuned parameters $\alpha = 0.1$ and $\beta = 1.0$.

The paper reports that this scheme achieves the best NE, roughly 5% better than the worst scheme. Feature frequencies are highly uneven, and a single global schedule decays the learning rate too quickly for rare features. A per-weight schedule also decays too aggressively, and per-coordinate adaptation accommodates the imbalance better.

The paper also compares this best SGD-trained logistic regression to **Bayesian online probit regression** (BOPR). Table 3 gives:

| Model | NE relative to online LR |
| --- | ---: |
| LR | 100% |
| BOPR | 99.82% |

BOPR is therefore marginally better in this offline comparison, by 0.18%. The paper nonetheless favors LR in production because:

- the model stores one weight per active feature instead of a mean and variance pair
- prediction needs one sparse inner product instead of two
- smaller models have better cache locality and lower latency

As a Bayesian model, BOPR gives a predictive distribution in addition to a point estimate, and the paper notes that this can support explore-exploit schemes.

## Online Joiner

Online training of the linear layer requires a real-time stream of labeled examples, which the paper's **online joiner** produces.

The joiner consumes two streams:

- impressions, with the features used at ranking time
- clicks, which arrive later if the user clicks

Negative labels are implicit, since a user takes no action that records the absence of a click. An impression is labeled negative only after a waiting period long enough that a later click is unlikely.

The length of the waiting window determines a tradeoff:

- a longer waiting window improves click coverage
- a shorter window reduces delay and memory pressure

The joiner holds impressions awaiting matching click events in a `HashQueue`, a FIFO buffer combined with a hash map keyed by request ID. After the join window expires, the system emits a positive example, or a negative one if no click arrived.

The paper makes two further practical points:

- missed late clicks bias the real-time stream downward by making CTR look slightly lower than it is
- streaming systems need anomaly protection, because stale or broken click streams can collapse predicted CTR and reduce ad delivery

The authors state that the bias from incomplete click coverage can be kept to decimal points of a percent and corrected for. They also recommend disconnecting the online trainer automatically if the real-time data distribution shifts abruptly.

## Containing Memory and Latency

### Number of Trees

More trees improve NE, but with diminishing returns. The paper reports that almost all of the gain comes from the first 500 trees. The last 1,000 trees reduce NE by less than 0.1%.

The last 1,000 trees add memory, CPU, and latency costs for a reduction in NE of less than 0.1%, so the number of trees can be reduced with little loss of accuracy.

The paper also observes overfitting in one smaller submodel after 1,000 trees.

### Feature Importance

The boosting model exposes feature importance via cumulative loss reduction. The distribution is very skewed:

- the top 10 features account for about half of total importance
- the last 300 features contribute less than 1%

Pruning the least important features therefore reduces model size with little loss of accuracy.

## Historical and Contextual Features

The paper splits features into:

- **contextual** features, such as time of day, device, or page context
- **historical** features, such as past ad CTR or user CTR

Historical features dominate the top-ranked features. The top 10 by importance are all historical. Among the top 20, only 2 are contextual.

Table 4 compares feature groups:

| Features used | NE relative to contextual-only baseline |
| --- | ---: |
| All | 95.65% |
| Historical only | 96.32% |
| Contextual only | 100% |

Two conclusions follow:

- removing historical features increases NE by about 4.5% relative
- removing contextual features increases NE by under 1%

Contextual features remain necessary for cold start, where the user or ad has little history. The paper also reports that contextual features are more sensitive to freshness, while historical features are more stable over time because they summarize accumulated behavior.

## Coping With Massive Training Data

### Uniform Subsampling

The authors train tree models with subsampling rates in $\{0.001, 0.01, 0.1, 0.5, 1\}$. Accuracy improves with more data, with diminishing returns. The authors report that training on only 10% of the data reduces normalized-entropy performance by about 1% relative to the full dataset, with calibration effectively unchanged. Subsampling is therefore an acceptable tradeoff when training cost is the binding constraint.

### Negative Downsampling

Because clicks are rare, the dataset is heavily imbalanced. The paper downsamples only the negative class and finds that accuracy depends strongly on the sampling rate. The best result comes at a negative downsampling rate of **0.025**.

Downsampling reduces training time and can improve accuracy, but the predictions are miscalibrated unless they are mapped back to the real class prior. The paper gives the correction:

$$
q = \frac{p}{p + (1 - p) / w}
$$

where:

- $p$ is the predicted probability in the downsampled training space
- $w$ is the negative downsampling rate
- $q$ is the recalibrated live-space prediction

Sampling changes the label distribution of the training data, and the change must be inverted at serving time.

## Summary of Findings

- The largest improvement came from the hybrid architecture, boosted trees that learn sparse rule features followed by logistic regression, and not from the choice of online learner.
- Daily retraining improved NE by about 1% over weekly retraining, which motivated online updates of the inexpensive final layer.
- Per-coordinate learning rates were the best SGD choice for online LR because feature frequencies were highly imbalanced.
- Historical features accounted for most of the predictive power, and contextual features remained necessary for cold start.
- With the model architecture fixed, the remaining engineering work concerned systems details: joining delayed labels, bounding memory, controlling latency, sampling data, and preserving calibration.

## Related Notes

- [[ml/recommender-systems/two-tower-retrieval|Two-Tower Retrieval and the MovieLens 100K experiment]]
- [[ml/recommender-systems/recommender-systems|Recommender Systems]]
- [[ml/recommender-systems/retrieval-and-ranking|Retrieval and Ranking]]
- [[ml/recommender-systems/intro-mapreduce-spark|MapReduce and Spark]]

## Sources

- [He et al. (2014), Practical Lessons from Predicting Clicks on Ads at Facebook](https://quinonero.net/Publications/predicting-clicks-facebook.pdf)
