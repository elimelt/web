---
title: Multinomial Logistic Regression
aliases:
  - natural-language-processing/reading/multinomial-logistic-regression
category: Natural Language Processing
tags:
  - classification
  - multinomial logistic regression
  - machine-learning
date: 2025-01-05
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: incomplete
description: Notation and probabilistic setup for classification, plus the definition of the multinomial logistic regression model. Training, gradients, and regularization are not covered yet.
sources:
  - title: Jurafsky & Martin, Speech and Language Processing (3rd ed. draft)
    url: https://web.stanford.edu/~jurafsky/slp3/
    type: textbook
---

Multinomial logistic regression is a discriminative classifier that models the conditional distribution of a class label given an input as the softmax of class-specific linear functions of the input's features. The treatment follows Jurafsky & Martin, [SLP3](https://web.stanford.edu/~jurafsky/slp3/).

The model extends the [[ml/nlp/reading/classification|classification]] framework with a discriminative linear model, and [[ml/nlp/reading/neural-networks|feedforward neural networks]] generalize it with nonlinear layers. Training, gradients and regularization are not yet covered.

## Classification setup

The input can be anything (a document, an image) and the output is a class label from a finite set $\mathcal{L}$:

$$
classify : \mathcal{V}^* \rightarrow \mathcal{L}
$$

$\mathcal{V}$ is the vocabulary, so $\mathcal{V}^*$ is the set of all possible texts.

$X$ is a random variable over inputs, taking values in $\mathcal{V}^*$. $Y$ is a random variable over outputs, taking values in $\mathcal{L}$.

$p(X, Y)$ is the true distribution of labeled texts, and $p(Y)$ is the marginal distribution of labels. Neither is known in advance, and both must be estimated from data.

## The model

Multinomial logistic regression scores each class with a linear function of features, then normalizes the scores into a distribution with softmax. With a feature vector $\phi(x) \in \mathbb{R}^d$ and per-class weights $w_y$:

$$
p(Y = y \mid X = x) = \frac{\exp(w_y \cdot \phi(x))}{\sum_{y' \in \mathcal{L}} \exp(w_{y'} \cdot \phi(x))}
$$

Prediction takes the argmax over classes. The model is discriminative. It estimates $p(Y \mid X)$ directly, while Naive Bayes models the joint $p(X, Y)$ through a generative story about how documents arise.

Training maximizes the conditional log-likelihood of the labeled data, which is the same as minimizing cross-entropy loss. [SLP3](https://web.stanford.edu/~jurafsky/slp3/) gives the derivation of the gradient.

## Sources

- [Jurafsky & Martin, Speech and Language Processing (3rd ed. draft)](https://web.stanford.edu/~jurafsky/slp3/)
