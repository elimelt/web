---
title: Machine Learning
category: Machine Learning
tags:
  - machine learning
  - deep learning
  - nlp
  - recommender systems
  - inference systems
date: 2026-07-31
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: Map of the machine learning notes, with separate paths for deep learning, language, recommendation, and serving systems.
sources:
  - title: Attention Is All You Need
    url: https://arxiv.org/abs/1706.03762
    type: paper
  - title: Deep Residual Learning for Image Recognition
    url: https://arxiv.org/abs/1512.03385
    type: paper
---

Machine learning is the study of algorithms that improve their performance on a task by fitting the parameters of a model to data. The notes are divided into four areas. [[ml/deep-learning/index|Deep learning]] covers neural networks from first principles and the main architecture families. [[ml/nlp/index|NLP]] covers language representations and textbook modeling ideas. [[ml/recommender-systems/reading-guide|Recommender systems]] covers retrieval, ranking, and feedback signals in personalization. [[ml/serving-systems/index|Serving systems]] covers the systems side of large-model inference: kernels, memory, batching, and parallelism.

The areas are related. Architecture choices in deep learning determine what later NLP and recommender models can express, and serving constraints in turn limit those choices. Large-model serving relies on the same performance reasoning as [[systems/performance/index|performance engineering]] and is subject to the same hardware constraints as those in the [[hardware/index|hardware notes]].

## Sections

- [[ml/deep-learning/index|Deep learning]]
- [[ml/nlp/index|Natural language processing]]
- [[ml/recommender-systems/reading-guide|Recommender systems]]
- [[ml/serving-systems/index|Serving systems]]

## Sources

- [Vaswani et al. (2017), Attention Is All You Need](https://arxiv.org/abs/1706.03762)
- [He et al. (2015), Deep Residual Learning for Image Recognition](https://arxiv.org/abs/1512.03385)
