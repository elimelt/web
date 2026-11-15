---
title: Numerical Optimization for Machine Learning
category: Mathematics
tags:
  - optimization
  - gradient descent
  - sgd
  - momentum
  - adam
  - learning-rate schedules
date: 2026-08-01
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: draft
description: The optimizers used to train models, from gradient descent and conditioning through momentum, Nesterov, Adam and decoupled weight decay, with theorems distinguished from empirical heuristics, and a measured NumPy experiment.
sources:
  - title: Goodfellow, Bengio, and Courville, Deep Learning, chapter 8
    url: https://www.deeplearningbook.org/contents/optimization.html
    type: book
  - title: Kingma and Ba (2015), Adam - A Method for Stochastic Optimization
    url: https://arxiv.org/abs/1412.6980
    type: paper
  - title: Sutskever et al. (2013), On the importance of initialization and momentum in deep learning
    url: https://proceedings.mlr.press/v28/sutskever13.html
    type: paper
  - title: Loshchilov and Hutter (2019), Decoupled Weight Decay Regularization
    url: https://arxiv.org/abs/1711.05101
    type: paper
  - title: Nesterov Accelerated Gradient and Momentum (mize docs)
    url: https://jlmelville.github.io/mize/nesterov.html
    type: docs
---

The optimizers used to train machine learning models are iterative first-order methods. Each step updates the parameters $\theta$ using the gradient of the training objective $J(\theta)$, or a stochastic estimate of it, scaled by a step size and in most methods combined with earlier gradients.

Their behavior is explained partly by theorems, proved for restricted function classes (mainly convex quadratics), and partly by heuristics, which are empirical and justified by training results. Each claim is labeled as one or the other. The gradients are derived in [[math/matrix-calculus|Matrix Calculus for Machine Learning]], and convex background is in [[math/convexity-lagrangians-kkt|Convexity, Lagrangians, and KKT]].

## Gradient descent and conditioning

Gradient descent iterates $\theta_{t+1} = \theta_t - \alpha \nabla J(\theta_t)$. On a strongly convex quadratic $J(\theta) = \frac{1}{2}\theta^T H \theta$ with eigenvalues $0 < \mu = \lambda_{\min} \le \lambda_{\max} = L$, the error contracts linearly, and with the optimal fixed step $\alpha = 2/(\mu + L)$ the rate is governed by the condition number $\kappa = L/\mu$:

$$
\lVert \theta_t - \theta^\star \rVert \le \left(\frac{\kappa - 1}{\kappa + 1}\right)^{t} \lVert \theta_0 - \theta^\star \rVert.
$$

This is a theorem (see Nesterov's *Introductory Lectures* or B&V §9.3). A well-conditioned problem ($\kappa$ near 1) converges in a few steps, and an ill-conditioned one converges slowly, because the step size is limited by the direction of largest curvature while progress is needed along the direction of smallest curvature. [Deep Learning ch. 8](https://www.deeplearningbook.org/contents/optimization.html) treats ill-conditioning as the first of the fundamental difficulties in neural net training. Saddle points are a second difficulty. For high-dimensional nonconvex problems, critical points are overwhelmingly saddles rather than poor local minima ([Dauphin et al. 2014](https://arxiv.org/abs/1406.2572), an argument from experiments and random matrix theory, not a theorem about neural networks).

## Stochastic gradients

SGD replaces $\nabla J$ with an unbiased minibatch estimate. The classical convergence guarantee (Robbins and Monro, 1951) requires the step sizes to satisfy

$$
\sum_t \alpha_t = \infty, \qquad \sum_t \alpha_t^2 < \infty,
$$

so that the total step length is unbounded while the steps decay fast enough for the effect of gradient noise to vanish ([DL ch. 8.3.1](https://www.deeplearningbook.org/contents/optimization.html)). In practice the step size is seldom annealed to zero, and schedules that hold it constant and then decay it are heuristics tuned by validation loss.

Batch size trades gradient variance against per-step cost. Variance of the minibatch gradient falls as $1/B$, so returns diminish. Doubling the batch halves the variance but doubles the compute, a sublinear improvement in wall-clock terms once parallel hardware saturates ([DL ch. 8.1.3](https://www.deeplearningbook.org/contents/optimization.html)). The claim that small-batch noise acts as a regularizer and large batches can generalize worse is empirical, not settled theory.

## Momentum and Nesterov

Classical momentum (Polyak) accumulates a velocity:

$$
v_{t+1} = \mu v_t - \alpha \nabla J(\theta_t), \qquad \theta_{t+1} = \theta_t + v_{t+1}.
$$

Along directions where gradients agree step after step, velocity builds toward a terminal speed $\alpha \lVert g \rVert / (1 - \mu)$, a $1/(1-\mu)$ amplification, 10x at $\mu = 0.9$; along oscillating directions, contributions cancel. This behavior counteracts ill-conditioning. On quadratics it is a theorem that momentum improves the iteration count from $O(\kappa)$ to $O(\sqrt{\kappa})$ with the optimal $\mu = \left((\sqrt{\kappa}-1)/(\sqrt{\kappa}+1)\right)^2$ ([Sutskever et al. 2013](https://proceedings.mlr.press/v28/sutskever13.html), citing Polyak 1964).

Nesterov's variant evaluates the gradient at the look-ahead point:

$$
v_{t+1} = \mu v_t - \alpha \nabla J(\theta_t + \mu v_t), \qquad \theta_{t+1} = \theta_t + v_{t+1}.
$$

The correction has its largest effect when the velocity is about to overshoot, since the gradient at the look-ahead point reflects the rising objective one step earlier. [Sutskever et al.](https://proceedings.mlr.press/v28/sutskever13.html) showed the two differ only in where the gradient is taken, that NAG is more tolerant of large $\mu$, and that momentum with careful initialization allows first-order methods to train deep networks previously thought to require second-order methods. The [mize notes](https://jlmelville.github.io/mize/nesterov.html) give the reparameterization that implements NAG as a small correction term on classical momentum, which is how frameworks implement `nesterov=True`.

## Adam and weight decay

[Adam](https://arxiv.org/abs/1412.6980) keeps exponential moving averages of the gradient and its square, corrects their initialization bias, and scales each coordinate's step by its own noise level:

$$
\begin{aligned}
m_t &= \beta_1 m_{t-1} + (1-\beta_1) g_t, \qquad & \hat{m}_t &= m_t / (1 - \beta_1^t), \\
v_t &= \beta_2 v_{t-1} + (1-\beta_2) g_t^2, & \hat{v}_t &= v_t / (1 - \beta_2^t), \\
\theta_{t+1} &= \theta_t - \alpha\, \hat{m}_t / (\sqrt{\hat{v}_t} + \epsilon). &&
\end{aligned}
$$

Defaults from the paper: $\alpha = 0.001$, $\beta_1 = 0.9$, $\beta_2 = 0.999$, $\epsilon = 10^{-8}$. The per-coordinate scaling makes updates invariant to diagonal rescaling of the gradient and bounds the effective step near $\alpha$, so Adam tolerates learning-rate choices under which SGD diverges. The bias correction compensates for the initialization $m_0 = v_0 = 0$, which biases early averages toward zero; dividing by $1 - \beta^t$ removes the bias, and the correction has the largest effect when $\beta_2$ is close to 1.

In Adam, adding $\frac{\lambda}{2}\lVert\theta\rVert^2$ to the loss (L2 regularization) passes $\lambda\theta$ through the adaptive scaling, so parameters with large historical gradients get *less* decay, coupling regularization strength to gradient history. [Loshchilov and Hutter](https://arxiv.org/abs/1711.05101) decouple it, applying $-\alpha\lambda\theta_t$ directly in the update, outside the $\hat{m}/\sqrt{\hat{v}}$ scaling, and call the result AdamW. Their evidence is empirical. On image classification AdamW brings Adam's generalization to the level of SGD with momentum, and it has since become widely used for training transformers. In PyTorch the two are `torch.optim.Adam(weight_decay=...)` (coupled L2) and `torch.optim.AdamW` (decoupled), and they optimize different effective objectives.

Learning-rate schedules (step decay, cosine, warmup) are heuristics applied on top of these methods. Warmup interacts specifically with Adam. Early in training $\hat{v}$ is estimated from few samples, so the first steps can be badly scaled, and increasing $\alpha$ gradually over the first few thousand steps mitigates this.

> [!abstract] What is proved vs. what is practiced
> On strongly convex quadratics with condition number $\kappa$:
>
> | Method | Iterations to converge | Status |
> |---|---|---|
> | Gradient descent, optimal step | $O(\kappa)$, factor $\frac{\kappa-1}{\kappa+1}$ per step | theorem |
> | Heavy-ball momentum, optimal $\mu$ | $O(\sqrt{\kappa})$ | theorem (Polyak 1964) |
> | SGD, Robbins-Monro steps | converges in probability | theorem |
> | Adam / AdamW, constant $\alpha$ | trains well with defaults | heuristic |
>
> The theorems hold on quadratics, and their transfer to deep networks is an empirical matter. The gap between $O(\kappa)$ and $O(\sqrt{\kappa})$ is large: in the [measured comparison](#a-measured-comparison) it exceeds six orders of magnitude at $\kappa = 100$. Each of the practical optimizers above (SGD with momentum, Nesterov, Adam and AdamW) includes momentum in some form.

## A measured comparison

The claims about conditioning and momentum can be checked on a quadratic, where the theory is exact. $J(\theta) = \frac{1}{2}\theta^T \mathrm{diag}(1, 100)\,\theta$, so $\kappa = 100$:

```python
import numpy as np

H = np.diag([1.0, 100.0])
def grad(th): return H @ th

def run(update, steps=200):
    th, state = np.array([1.0, 1.0]), None
    hist = []
    for t in range(steps):
        th, state = update(th, state, t)
        hist.append(np.sqrt(th @ H @ th))
    return hist

a = 2 / (1 + 100)                       # optimal GD step for this spectrum
gd   = run(lambda th, s, t: (th - a * grad(th), None))

mu = (np.sqrt(100) - 1) / (np.sqrt(100) + 1)   # optimal momentum
am = (2 / (1 + np.sqrt(1/100)))**2 / 100       # matching step size
def mom(th, v, t):
    v = mu * (v if v is not None else 0) - am * grad(th)
    return th + v, v
heavy = run(mom)

print(f"GD after 200 steps:       {gd[-1]:.3e}")     # 1.840e-01
print(f"momentum after 200 steps: {heavy[-1]:.3e}")  # 5.583e-08
```

Measured on this machine (NumPy 2.x, the script above verbatim): plain GD with its optimal step ends at error norm $1.84 \times 10^{-1}$ after 200 iterations. The initial norm is $\sqrt{101} \approx 10.05$, so the contraction factor is $0.184/10.05 \approx 0.0183$, matching the theory's $((\kappa-1)/(\kappa+1))^{200} = (99/101)^{200} \approx 0.0183$ to three digits. Heavy-ball momentum with $\mu = 9/11 \approx 0.818$ reaches $5.6 \times 10^{-8}$, lower by more than six orders of magnitude.

## Sources

- [Goodfellow, Bengio, and Courville, Deep Learning, chapter 8](https://www.deeplearningbook.org/contents/optimization.html)
- [Kingma and Ba (2015), Adam: A Method for Stochastic Optimization](https://arxiv.org/abs/1412.6980)
- [Sutskever et al. (2013), On the importance of initialization and momentum in deep learning](https://proceedings.mlr.press/v28/sutskever13.html)
- [Loshchilov and Hutter (2019), Decoupled Weight Decay Regularization](https://arxiv.org/abs/1711.05101)
- [Dauphin et al. (2014), Identifying and attacking the saddle point problem](https://arxiv.org/abs/1406.2572)
- [Nesterov Accelerated Gradient and Momentum (mize docs)](https://jlmelville.github.io/mize/nesterov.html)

## Related notes

- [[math/matrix-calculus|Matrix Calculus for Machine Learning]]
- [[math/convexity-lagrangians-kkt|Convexity, Lagrangians, and KKT Conditions]]
- [[ml/deep-learning/neural-networks-from-scratch|Neural Networks from Scratch]]
- [[ml/deep-learning/modeling-architecture-and-data|Modeling, Architecture, and Data]]
