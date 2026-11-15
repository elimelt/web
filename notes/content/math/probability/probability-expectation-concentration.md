---
title: Probability, Expectation, and Concentration Bounds
category: Mathematics
tags:
  - probability
  - expectation
  - variance
  - concentration bounds
  - random variables
  - statistics
date: 2026-08-01
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: draft
description: Random variables, expectation, variance, covariance and conditional expectation, and the Markov, Chebyshev, Chernoff and Hoeffding inequalities, with the sample sizes they imply and a NumPy simulation.
sources:
  - title: Pishro-Nik, Introduction to Probability, Statistics, and Random Processes
    url: https://probabilitycourse.com/
    type: book
  - title: Aldous, Hoeffding's inequality (course handout)
    url: https://www.stat.berkeley.edu/~aldous/Real-World/hoeffding.pdf
    type: lecture
  - title: Cornell CS 4780, lecture note 2, ML setup and notation
    url: https://www.cs.cornell.edu/courses/cs4780/2018fa/lectures/lecturenote02_mlnotation.pdf
    type: lecture
---

A concentration inequality bounds the probability that a random variable, typically a sum or average of independent variables, deviates from its expectation by more than a given amount.

The inequalities of Markov, Chebyshev, Chernoff and Hoeffding form a sequence in which each uses more information about the random variable than the one before. Inverted, they give the number of samples required for an empirical average to lie within a given tolerance of its expectation with a given probability, which is the question underlying A/B tests, offline recommender metrics and benchmark noise.

## Random variables and expectation

A random variable $X$ is a function from outcomes to numbers; we describe it by its distribution. Expectation is the probability-weighted average ([Pishro-Nik ch. 6](https://probabilitycourse.com/)):

$$
\mathbb{E}[X] = \sum_x x\, p(x) \quad \text{(discrete)}, \qquad
\mathbb{E}[X] = \int x f(x)\, dx \quad \text{(continuous)}.
$$

Expectation is linear, $\mathbb{E}[aX + bY] = a\,\mathbb{E}[X] + b\,\mathbb{E}[Y]$, with no independence assumption. Independence is needed for products: if $X \perp Y$ then $\mathbb{E}[XY] = \mathbb{E}[X]\,\mathbb{E}[Y]$.

Variance measures spread, and covariance measures the joint variation of two variables:

$$
\mathrm{Var}(X) = \mathbb{E}[(X - \mu)^2] = \mathbb{E}[X^2] - \mu^2, \qquad
\mathrm{Cov}(X, Y) = \mathbb{E}[XY] - \mathbb{E}[X]\,\mathbb{E}[Y].
$$

Variance is not linear. $\mathrm{Var}(aX) = a^2 \mathrm{Var}(X)$, and $\mathrm{Var}(X + Y) = \mathrm{Var}(X) + \mathrm{Var}(Y) + 2\,\mathrm{Cov}(X, Y)$, which reduces to a plain sum for independent (or merely uncorrelated) variables. This additivity is the reason averages concentrate. For iid $X_1, \dots, X_n$ with mean $\mu$ and variance $\sigma^2$, the empirical mean $\hat{\mu}_n = \frac{1}{n}\sum_i X_i$ has

$$
\mathbb{E}[\hat{\mu}_n] = \mu, \qquad \mathrm{Var}(\hat{\mu}_n) = \frac{\sigma^2}{n}.
$$

Conditional expectation $\mathbb{E}[X \mid Y]$ is the best predictor of $X$ given $Y$ in mean squared error, itself a random variable, and the tower property $\mathbb{E}[X] = \mathbb{E}[\mathbb{E}[X \mid Y]]$ allows an expectation to be computed by conditioning on a variable that makes the problem factor ([Pishro-Nik §6.3-6.4](https://probabilitycourse.com/)). The ML framing in [Cornell CS 4780's notation note](https://www.cs.cornell.edu/courses/cs4780/2018fa/lectures/lecturenote02_mlnotation.pdf) is a direct application. Data are iid draws from an unknown $P$, the test error is an expectation over $P$, and each quantity computed from a sample is an estimator of some expectation.

## The inequality chain

Each inequality uses more information about the distribution than the previous one and gives a faster-decaying tail.

> [!abstract] Assumptions and tail decay
> | Bound | Requires | Tail decay |
> |---|---|---|
> | Markov | $X \ge 0$, a mean | $1/a$ |
> | Chebyshev | a variance | $1/\epsilon^2$, and $1/n$ for averages |
> | Chernoff | a moment generating function | $e^{-cn}$, exponential in $n$ |
> | Hoeffding | bounded range $[a_i, b_i]$ | $2e^{-2n\epsilon^2}$, explicit constants |
>
> Each bound after Markov is Markov's inequality applied to a transformed variable. Chebyshev applies it to $(X-\mu)^2$, and Chernoff to $e^{tX}$ with $t$ optimized. Which bound applies depends on the available assumptions. A heavy-tailed variable with no MGF admits Chebyshev but not Chernoff, and for bounded iid samples Hoeffding gives the sample size directly.

**Markov** (requires nonnegativity and a mean). For $X \ge 0$ and $a > 0$:

$$
\Pr[X \ge a] \le \frac{\mathbb{E}[X]}{a}.
$$

Proof: $\mathbb{E}[X] \ge \mathbb{E}[X \cdot \mathbf{1}\{X \ge a\}] \ge a \Pr[X \ge a]$. The bound decays only as $1/a$, and the remaining bounds are derived from it.

**Chebyshev** (requires a variance). Apply Markov to the nonnegative variable $(X - \mu)^2$ with threshold $\epsilon^2$:

$$
\Pr[|X - \mu| \ge \epsilon] = \Pr[(X-\mu)^2 \ge \epsilon^2] \le \frac{\mathrm{Var}(X)}{\epsilon^2}.
$$

Combined with $\mathrm{Var}(\hat{\mu}_n) = \sigma^2/n$ this proves the weak law of large numbers: the empirical mean converges to $\mu$ in probability. The decay in $n$ is only polynomial, $O(1/n\epsilon^2)$.

**Chernoff** (requires a moment generating function). Apply Markov to $e^{tX}$, then optimize the free parameter $t > 0$:

$$
\Pr[X \ge a] = \Pr[e^{tX} \ge e^{ta}] \le e^{-ta}\, \mathbb{E}[e^{tX}].
$$

Because the MGF of a sum of independent variables factors into a product, the exponent scales linearly in $n$ and the tail decays exponentially. For a sum $S_n$ of independent Bernoullis with mean $\mu = \mathbb{E}[S_n]$, the multiplicative form is $\Pr[S_n \ge (1+\delta)\mu] \le \exp(-\mu\,[(1+\delta)\ln(1+\delta) - \delta])$.

**Hoeffding** (requires bounded ranges). For independent $X_i \in [a_i, b_i]$ ([Aldous's handout](https://www.stat.berkeley.edu/~aldous/Real-World/hoeffding.pdf)):

$$
\Pr\!\left[\Big|\sum_i X_i - \mathbb{E}\Big[\sum_i X_i\Big]\Big| \ge t\right]
\le 2 \exp\!\left(\frac{-2t^2}{\sum_i (b_i - a_i)^2}\right).
$$

For iid $X_i \in [0,1]$ and the empirical mean, this specializes to

$$
\Pr[|\hat{\mu}_n - \mu| \ge \epsilon] \le 2 e^{-2n\epsilon^2}.
$$

## Sample sizes, A/B tests, and measurement noise

Inverting the Hoeffding bound gives a sample size. Estimating a $[0,1]$-bounded mean within $\pm\epsilon$ with probability $1 - \delta$ requires $2e^{-2n\epsilon^2} \le \delta$, that is,

$$
n \ge \frac{\ln(2/\delta)}{2\epsilon^2}.
$$

The sample size grows as $1/\epsilon^2$, so halving the error bar quadruples it. It grows only as $\ln(2/\delta)$ in the failure probability, so raising the confidence from 95% to 99.9% multiplies it by a small constant factor. For $\epsilon = 0.01$ and $\delta = 0.05$ the bound requires $n \ge \ln(40)/0.0002 \approx 18{,}445$ samples. An A/B test comparing click-through rates estimates two such means, and detecting a difference of a fraction of a percent requires a sample size of order $1/\epsilon^2$. The same arithmetic bounds how many queries an offline recommender evaluation needs before a metric delta is signal rather than sampling noise, and how many benchmark iterations to run before comparing two systems, the concern in the [[systems/operating-systems/benchmarks/README|OS benchmarks notes]]. Hoeffding assumes independent samples; correlated benchmark iterations (warm caches, interference) violate that and make the bound optimistic.

## Simulation check

Hoeffding is a worst-case bound. The following simulation checks that it holds and measures its slack for uniform variables.

```python
import numpy as np

rng = np.random.default_rng(0)
n, eps, trials = 500, 0.05, 200_000
X = rng.random((trials, n))          # iid Uniform[0,1], mu = 0.5
dev = np.abs(X.mean(axis=1) - 0.5)
empirical = (dev >= eps).mean()
hoeffding = 2 * np.exp(-2 * n * eps**2)
print(empirical, hoeffding)          # 8e-05 vs 0.1642
```

The measured tail probability is $8 \times 10^{-5}$ against a Hoeffding bound of 0.164, three orders of magnitude of slack for uniform variables. The gap is expected, since Hoeffding uses only the range $[0,1]$ and must cover the worst distribution with that range (Bernoulli at the endpoints), while Uniform[0,1] has variance $1/12$, a third of Bernoulli's $1/4$. The central limit theorem accounts for the measured value. The empirical mean has standard deviation $\sqrt{1/(12 \cdot 500)} \approx 0.0129$, so $\epsilon = 0.05$ is a 3.9-sigma deviation, and the two-sided normal tail at 3.9 sigma is about $1 \times 10^{-4}$, matching the simulation. Variance-aware bounds such as Bernstein's inequality account for this difference.

## Sources

- [Pishro-Nik, Introduction to Probability, Statistics, and Random Processes, chapters 6-7](https://probabilitycourse.com/)
- [Aldous, Hoeffding's inequality, course handout](https://www.stat.berkeley.edu/~aldous/Real-World/hoeffding.pdf)
- [Cornell CS 4780 (2018), lecture note 2, ML setup and notation](https://www.cs.cornell.edu/courses/cs4780/2018fa/lectures/lecturenote02_mlnotation.pdf)

## Related notes

- [[ml/recommender-systems/bias-and-marketplace-effects|Bias, Marketplace Effects, and Counterfactual Evaluation]]
- [[systems/operating-systems/benchmarks/README|OS Benchmarks]]
- [[math/linear-algebra/cheatsheet|Matrix Theory]]
