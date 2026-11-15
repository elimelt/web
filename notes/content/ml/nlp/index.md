---
title: Natural Language Processing
category: Natural Language Processing
tags:
  - nlp
  - tokenization
  - classification
  - neural networks
date: 2026-07-31
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: Overview of the NLP notes, from tokenization and linear classifiers to neural models and prompting.
sources:
  - title: Speech and Language Processing
    url: https://web.stanford.edu/~jurafsky/slp3/
    type: textbook
---

Natural language processing (NLP) is the computational analysis and generation of human language. The notes cover the pipeline that converts text into inputs a model can use, beginning with [[ml/nlp/reading/tokenization|tokenization]] and continuing with [[ml/nlp/reading/classification|classification]] and [[ml/nlp/reading/multinomial-logistic-regression|multinomial logistic regression]]. [[ml/nlp/reading/neural-networks|Neural networks]] treats models with nonlinear decision boundaries, for tasks on which linear boundaries are insufficient.

Two further notes concern current large language models more than textbook NLP. [[ml/nlp/prompting|Prompting]] connects the earlier modeling material to the use of pretrained models through their inputs, and [[ml/nlp/decoding-strategies|decoding strategies]] covers the conversion of a trained model's output distributions into text at inference time.

## Suggested path

- Represent and retrieve text: [[ml/nlp/reading/tokenization|tokenization]], [[ml/nlp/ppmi|PPMI]], [[ml/nlp/word-embeddings|word embeddings]], [[ml/nlp/reading/information-retrieval|information retrieval and the PPMI experiment]]
- Build classifiers: [[ml/nlp/reading/classification|classification]], [[ml/nlp/reading/multinomial-logistic-regression|multinomial logistic regression]]
- Add nonlinear models: [[ml/nlp/reading/neural-networks|neural networks]]
- Use current models: [[ml/nlp/prompting|prompting]], [[ml/nlp/decoding-strategies|decoding strategies]]

## Related notes

- [[ml/deep-learning/recurrent-neural-networks|Recurrent Neural Networks]]
