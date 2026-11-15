---
title: Bias, Marketplace Effects, and Counterfactual Evaluation
category: Recommender Systems
tags:
  - recommender systems
  - selection bias
  - exposure bias
  - contextual bandits
  - counterfactual evaluation
  - fairness
  - ads
date: 2026-07-31
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: The dependence of recommender logs on the logging policy, exploration with contextual bandits, offline policy evaluation with IPS, SNIPS, the direct method and doubly robust estimators, and the allocation of producer-side exposure in two-sided marketplaces alongside user relevance.
sources:
  - title: Li et al. (2010), A Contextual-Bandit Approach to Personalized News Article Recommendation
    url: https://arxiv.org/pdf/1003.0146
    type: paper
  - title: Li et al. (2014), Counterfactual Estimation and Optimization of Click Metrics for Search Engines
    url: https://arxiv.org/pdf/1403.1891
    type: paper
  - title: Chaney, Stewart, and Engelhardt (2018), How Algorithmic Confounding in Recommendation Systems Increases Homogeneity and Decreases Utility
    url: https://arxiv.org/pdf/1710.11214
    type: paper
  - title: Patro et al. (2020), FairRec
    url: https://arxiv.org/pdf/2002.10764
    type: paper
  - title: Dudík, Langford, and Li (2011), Doubly Robust Policy Evaluation and Learning
    url: https://arxiv.org/pdf/1103.4601
    type: paper
  - title: Swaminathan and Joachims (2015), The Self-Normalized Estimator for Counterfactual Learning
    url: https://proceedings.neurips.cc/paper_files/paper/2015/hash/39027dfad5138c9ca0c474d71db915c3-Abstract.html
    type: paper
  - title: Chapelle, Joachims, Radlinski, and Yue (2012), Large-Scale Validation and Analysis of Interleaved Search Evaluation
    url: https://www.cs.cornell.edu/people/tj/publications/chapelle_etal_12a.pdf
    type: paper
  - title: Kuang et al. (2018), Stable Prediction across Unknown Environments
    url: https://arxiv.org/pdf/1806.06270
    type: paper
  - title: Zou et al. (2019), Reinforcement Learning to Optimize Long-term User Engagement in Recommender Systems
    url: https://arxiv.org/pdf/1902.05570
    type: paper
---

Recommendation logs are generated under the recommender's own policy. The policy determines which items each user is shown, only shown items can receive feedback, and the labels used for the next training run therefore depend on the current policy's decisions. Recommendation data is in this sense the product of an intervention by the system and not a passive observation of user preference.

The consequences include selection bias in the training data, the need for exploration and for offline policy evaluation with known propensities, and, in two-sided marketplaces, the question of how exposure is allocated among producers.

## Logged Data Is Policy-Shaped

If a platform shows only head items, its logs contain many interactions with head items and little evidence about the tail. The scarcity of tail interactions then reflects how rarely the policy exposed tail items and gives little information about their quality.

This creates a feedback loop:

1. policy chooses exposure
2. exposure determines which labels can be observed
3. observed labels train the next policy

Chaney, Stewart, and Engelhardt study this loop directly and show that training on recommendation data confounded in this way can homogenize user behavior without increasing utility.

Recommendation logs are therefore a sample of user preferences filtered by the previously deployed recommender, and not a random sample.

## Biases That Matter in Practice

- **Exposure bias**: unshown items cannot collect positive feedback.
- **Position bias**: higher-ranked items attract more interaction for reasons partly unrelated to relevance.
- **Popularity bias**: already-popular items collect more exposure, which further increases their observed engagement.
- **Selection bias**: the training set overrepresents the traffic that the current system already shows.

These biases interact. Popular items receive higher positions, higher positions generate more clicks, and those clicks train the next model.

## Exploration and Contextual Bandits

The contextual bandit is a formal model of learning under exposure constraints. At each step $t$, the learner

1. observes a context $x_t$,
2. chooses an action $a_t$,
3. observes the reward of the chosen action only.

Many recommendation surfaces have this structure, since the system observes rewards only for the items it shows.

Li, Chu, Langford, and Schapire apply this model to personalized news recommendation and report a **12.5% click lift** over a context-free bandit baseline on Yahoo! Front Page traffic. The paper also shows that offline evaluation is possible when the logging policy randomizes its choices with known propensities.

## Counterfactual Evaluation

If the logging policy chooses action $a$ with probability $\pi_0(a \mid x)$, then inverse-propensity weighting estimates the value of a target policy $\pi$ by reweighting logged rewards:

$$
\hat{V}_{\text{IPS}}(\pi) = \frac{1}{n} \sum_{t=1}^{n} \frac{\pi(a_t \mid x_t)}{\pi_0(a_t \mid x_t)} r_t
$$

Inverse-propensity weighting is the basis of counterfactual evaluation. With it, logged data can evaluate a policy that was never deployed, provided the logging policy gives nonzero probability to the actions the target policy takes and the propensities are known.

Li et al. (2014) propose using such causal estimators offline to screen many candidate models at low cost, in place of running a serial A/B test for each.

The estimator is unbiased when the propensities are known and positive wherever $\pi$ is positive. Taking the expectation over $a_t \sim \pi_0(\cdot \mid x_t)$ and the resulting reward, each term contributes $\sum_a \pi_0(a\mid x)\frac{\pi(a\mid x)}{\pi_0(a\mid x)}r(x,a) = \sum_a \pi(a\mid x) r(x,a) = V(\pi \mid x)$, the true value of $\pi$ at that context. The variance of the estimator, however, can be large. If $\pi_0(a\mid x)$ is small for an action to which $\pi$ assigns high probability, the corresponding log line receives a large weight $\pi(a\mid x)/\pi_0(a\mid x)$, and a few such lines can dominate the average. Randomized data collection with adequate probability on every action is therefore a requirement for reliable offline evaluation.

### Self-Normalized IPS (SNIPS)

IPS is unbiased for the value, but it is not invariant to scaling or shifting of the reward, and its variance can be dominated by a single logged example with a small propensity. Swaminathan and Joachims call the resulting failure **propensity overfitting**. When IPS is used as a training objective as well as an evaluation metric, the optimizer can improve the estimate by reducing $\pi(a\mid x)$ on the actions that happened to be sampled instead of by improving the policy.

The self-normalized (SNIPS) estimator divides by the sum of the importance weights instead of by $n$:

$$
\hat{V}_{\text{SNIPS}}(\pi) = \frac{\sum_{t=1}^{n} \frac{\pi(a_t \mid x_t)}{\pi_0(a_t \mid x_t)} r_t}{\sum_{t=1}^{n} \frac{\pi(a_t \mid x_t)}{\pi_0(a_t \mid x_t)}}
$$

As a ratio estimator, SNIPS is biased at finite $n$. The bias vanishes as $n$ grows, and its variance is typically lower than that of IPS. If the importance weights sum to more than $n$ on a given sample (a draw that overrepresents the actions favored by $\pi$), IPS overestimates the value, and SNIPS corrects for the excess because the same inflated weights appear in the denominator.

### Direct Method (DM)

The direct method uses no importance weighting. It fits a reward model $\hat{r}(x, a)$ to the logs by regression and estimates the value of a policy by averaging the model's predictions under $\pi$:

$$
\hat{V}_{\text{DM}}(\pi) = \frac{1}{n} \sum_{t=1}^{n} \sum_{a} \pi(a \mid x_t)\, \hat{r}(x_t, a)
$$

DM has low variance because it contains no importance ratio. Its error is bias. If $\hat{r}$ is inaccurate on actions that the logging policy rarely took, which may be the actions that $\pi$ favors, DM reports an incorrect value, and nothing in the estimator indicates that the reward model is extrapolating beyond the support of the logged data.

### Doubly Robust (DR) Estimator

Dudík, Langford, and Li combine DM and IPS so that each compensates for the other's source of error. The DR estimator is

$$
\hat{V}_{\text{DR}}(\pi) = \frac{1}{n} \sum_{t=1}^{n} \left[ \hat{r}(x_t, \pi) + \frac{\pi(a_t \mid x_t)}{\pi_0(a_t \mid x_t)} \bigl(r_t - \hat{r}(x_t, a_t)\bigr) \right], \qquad \hat{r}(x,\pi) := \sum_a \pi(a\mid x)\hat r(x,a)
$$

The first term is the DM baseline. The second term is an IPS correction applied to the *residual* between the observed reward and the model's prediction for the action actually taken, instead of to the raw reward.

The name refers to two cases in which the estimator is unbiased. Fix a context $x$, let $a \sim \pi_0(\cdot \mid x)$, and let $r$ have $\mathbb{E}[r \mid x, a] = r(x,a)$, the true expected reward. The expectation of one DR term over the logging policy's action distribution is

$$
\mathbb{E}_{a, r}\left[\hat r(x,\pi) + \frac{\pi(a\mid x)}{\pi_0(a\mid x)}\bigl(r - \hat r(x,a)\bigr)\right] = \hat r(x,\pi) + \sum_a \pi_0(a\mid x)\frac{\pi(a\mid x)}{\pi_0(a\mid x)}\bigl(r(x,a) - \hat r(x,a)\bigr)
$$

$$
= \hat r(x,\pi) + \sum_a \pi(a\mid x)\bigl(r(x,a) - \hat r(x,a)\bigr) = \hat r(x,\pi) + V(\pi\mid x) - \hat r(x,\pi) = V(\pi\mid x)
$$

The reward model $\hat r$ cancels regardless of its accuracy, provided $\pi_0(a\mid x) > 0$ wherever the cancellation divides by it. This is the first robustness case: **the propensities are correct, the reward model can be arbitrarily wrong, and the estimator is still unbiased.**

In the second case, the propensities are estimated as $\hat\pi_0$, possibly with bias, and the reward model is exactly correct, $\hat r(x,a) = r(x,a)$. The residual $r_t - \hat r(x_t,a_t)$ then has expectation zero for every $t$ regardless of $\hat\pi_0$, so the correction term vanishes in expectation and $\hat V_{\text{DR}}(\pi)$ reduces to $\hat r(x,\pi) = V(\pi\mid x)$. This is the second robustness case: **the reward model is correct, the propensities can be wrong, and the estimator is still unbiased.**

DR is therefore unbiased if either the propensities or the reward model is correct. In practice its variance is also often lower than that of IPS, because an accurate reward model accounts for most of the reward and the importance-weighted term corrects only a residual, which is typically smaller and less heavy-tailed than the raw reward.

### Support Mismatch and Variance

All three importance-weighted estimators (IPS, SNIPS, DR) require $\pi_0(a\mid x) > 0$ wherever $\pi(a\mid x) > 0$. If the logging policy never took an action that the target policy takes, the ratio $\pi(a\mid x)/\pi_0(a\mid x)$ is undefined, and if the logging propensity is near zero, the ratio is estimated from a near-zero denominator with large sampling error. Dudík, Langford, and Li's empirical results and Li et al.'s search-engine deployment both treat propensity overlap as a precondition for these estimators.

Insufficient overlap appears in practice as one or two logged examples carrying almost all the weight in the sum, so that the effective sample size is far smaller than $n$. When the largest few importance weights account for a large share of the total weight, the point estimate is unreliable regardless of the width of the naive confidence interval.

### Practical Logging-Policy Design

Because the estimators above require overlap, the logging policy must be designed for later counterfactual evaluation as well as for the current user experience:

- keep a small randomization floor on every action with nonzero business value, so that $\pi_0(a\mid x)$ never reaches zero
- log the propensity $\pi_0(a_t \mid x_t)$ with every impression, in addition to the action and outcome, since it cannot be reconstructed after the serving logic changes
- prefer stratified or epsilon-greedy exploration over policies with sharp decision boundaries, since sharp boundaries create regions with effectively zero support
- treat propensity logging as part of the serving system's schema contract, since an undetected regression in it invalidates every downstream offline evaluation

### Interleaving vs. A/B Testing

Interleaving compares two rankers without splitting traffic. For each query, the two rankers' results are merged into one list (for example by team-draft interleaving), and each click is credited to the ranker that contributed the clicked result. Chapelle, Joachims, Radlinski, and Yue's large-scale study across two commercial search engines found that interleaving detected the same ranking preference as A/B testing with far fewer impressions, because each impression is a paired comparison and not a between-subjects one.

Interleaving is narrower in scope. It measures which ranker users prefer, a relative judgment made per query. It does not directly measure the effect of a change on revenue, retention or long-run engagement, which an A/B test measures and on which a marketplace's objectives ultimately depend. Counterfactual estimators, interleaving and A/B tests are in increasing order of both cost and fidelity. Offline estimators can screen candidate models, interleaving can confirm a ranking preference with little traffic, and A/B tests can validate end-to-end business metrics before a full rollout.

### A Toy Comparison: IPS vs. SNIPS vs. DR

The following example is synthetic and illustrative and involves no measurement from a real system. Suppose a logging policy $\pi_0$ chooses between two actions, $a_1$ and $a_2$, with $\pi_0(a_1\mid x) = 0.9$ and $\pi_0(a_2\mid x) = 0.1$ for a fixed context $x$, and the true rewards are $r(x,a_1) = 0$ and $r(x,a_2) = 1$. A target policy $\pi$ always picks $a_2$, so the true value is $V(\pi\mid x) = 1$.

Five interactions are logged, four draws of $a_1$ (reward 0 each) and one draw of $a_2$ (reward 1), matching the $0.9/0.1$ split exactly.

- **IPS**: weight on the $a_2$ row is $\pi(a_2\mid x)/\pi_0(a_2\mid x) = 1/0.1 = 10$, weight on every $a_1$ row is $0/0.9 = 0$. $\hat V_{\text{IPS}} = \frac{1}{5}(0+0+0+0+10 \cdot 1) = 2.0$, twice the true value of $1$, an error due entirely to finite-sample noise in one rare draw.
- **SNIPS**: the numerator is the same, and the division is by the sum of weights instead of $n$. $\hat V_{\text{SNIPS}} = \frac{10}{0+0+0+0+10} = 1.0$, which equals the true value on this sample because the one nonzero weight is also the only term in the denominator.
- **DR** with an inaccurate reward model $\hat r(x,a_1)=0.2, \hat r(x,a_2)=0.6$: $\hat r(x,\pi) = 0.6$. The correction term is nonzero only on the $a_2$ row, where it equals $10 \cdot (1 - 0.6) = 4$. Averaging over five rows, $\hat V_{\text{DR}} = \frac{1}{5}(0.6+0.6+0.6+0.6+0.6+4) = \frac{1}{5}(3+4) = 1.4$, closer to the true value of $1$ than IPS despite the inaccurate reward model, because the model accounts for the $a_1$ rows and the importance weighting corrects only the residual on $a_2$.

With one action drawn only 10% of the time, a single logged row changes the IPS estimate by a factor of two. SNIPS and DR reduce this sensitivity through normalization and residual correction respectively. The exact SNIPS result is a property of this sample and does not show that SNIPS is preferable in general.

## Marketplace Effects

Many platforms are two-sided marketplaces, in which exposure has economic value for suppliers in addition to its relevance for users. Suppliers include:

- sellers on e-commerce platforms
- creators on media platforms
- restaurants on local discovery surfaces
- drivers, hosts, or freelancers on labor platforms

Patro et al. show that a customer-centric top-$k$ recommender can create large disparities in producer exposure. Such disparities may be unfair to producers, and they may also harm the platform over time by causing suppliers to leave or by reducing user choice.

The objective of recommendation then includes, in addition to user utility, the allocation of a scarce resource, user attention, across the market.

## Producer Fairness Is Not the Same as Relevance

If the platform always serves the item of highest predicted relevance, head producers tend to receive a growing share of exposure. A marketplace may instead optimize a combination of:

- user relevance
- exposure floors
- diversity across suppliers
- long-run ecosystem health

FairRec formulates recommendation as a two-sided allocation problem with a fairness criterion for each side:

- **MMS-style exposure guarantees** for producers
- **EF1-style fairness** for customers

Once a platform's multiple stakeholders are taken into account, single-objective top-$k$ ranking no longer represents its objective adequately.

## Distribution Shift Compounds the Feedback Loop

The exposure loop described under [Logged Data Is Policy-Shaped](#logged-data-is-policy-shaped) is a special case of a more general problem, in which a model trained on the current distribution is deployed on a later distribution that its own decisions helped create. Kuang, Cui, Athey, Xiong, and Li study this problem for tabular prediction, where a classifier trained on one environment is later applied to an environment with a shifted feature-outcome relationship. Their method, global balancing, reweights training examples so that each feature's estimated effect is decorrelated from the other features, and yields a classifier whose accuracy degrades less when the deployment distribution shifts. In the recommender setting, a ranker trained only on exposure-filtered clicks fits spurious feature correlations that held under the previous exposure policy, and these correlations need not persist after a policy change.

Zou, Xia, Ding, Song, Liu, and Yin study a related problem: a model that is stable under distribution shift can still optimize over the wrong horizon. A ranker trained to predict the next click models engagement myopically. Their FeedRec system formulates session-level feed ranking as a reinforcement learning problem with reward defined over both click-type signals (clicks, orders) and richer engagement signals (dwell time, return visits), in order to penalize policies that increase short-term clicks at the expense of long-term engagement. The contribution lies in the formulation more than in the specific RL architecture. A supervised, single-step objective cannot represent the tradeoff between a recommendation with high immediate engagement and one that increases the probability of a return visit in later sessions, and a system evaluated only on next-click accuracy can report good results while retention declines.

Both papers imply that counterfactual estimators and interleaving measure the effect of a policy change relative to the current traffic mix, and that neither detects a policy that is *stably* better on the current distribution and worse once its own exposure decisions have changed the distribution. Longer-horizon metrics, listed under [What to Measure](#what-to-measure), should therefore be tracked even when short-term online tests show no regression.

## What to Measure

A recommender evaluated only on click metrics tends to overfit them. A broader metric set includes:

- short-term engagement
- retention or downstream value
- calibration
- exposure concentration
- tail coverage
- creator or seller-side outcomes

These metrics complement A/B tests and do not replace them. They reduce the risk that the offline evaluation loop reports incorrect conclusions with high confidence.

## Related Notes

- [[ml/recommender-systems/ranking-objectives|Ranking Objectives and Implicit Feedback]]
- [[ml/recommender-systems/retrieval-and-ranking|Retrieval and Ranking]]
- [[ml/recommender-systems/predicting-clicks-on-ads-at-facebook|Practical Lessons from Predicting Clicks on Ads at Facebook]]

## Sources

- [Li et al. (2010), A Contextual-Bandit Approach to Personalized News Article Recommendation](https://arxiv.org/pdf/1003.0146)
- [Li et al. (2014), Counterfactual Estimation and Optimization of Click Metrics for Search Engines](https://arxiv.org/pdf/1403.1891)
- [Chaney, Stewart, and Engelhardt (2018), How Algorithmic Confounding in Recommendation Systems Increases Homogeneity and Decreases Utility](https://arxiv.org/pdf/1710.11214)
- [Patro et al. (2020), FairRec](https://arxiv.org/pdf/2002.10764)
- [Dudík, Langford, and Li (2011), Doubly Robust Policy Evaluation and Learning](https://arxiv.org/pdf/1103.4601)
- [Swaminathan and Joachims (2015), The Self-Normalized Estimator for Counterfactual Learning](https://proceedings.neurips.cc/paper_files/paper/2015/hash/39027dfad5138c9ca0c474d71db915c3-Abstract.html)
- [Chapelle, Joachims, Radlinski, and Yue (2012), Large-Scale Validation and Analysis of Interleaved Search Evaluation](https://www.cs.cornell.edu/people/tj/publications/chapelle_etal_12a.pdf)
- [Kuang et al. (2018), Stable Prediction across Unknown Environments](https://arxiv.org/pdf/1806.06270)
- [Zou et al. (2019), Reinforcement Learning to Optimize Long-term User Engagement in Recommender Systems](https://arxiv.org/pdf/1902.05570)
