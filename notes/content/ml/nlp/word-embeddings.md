---
title: Word Embeddings and Distributional Semantics
category: Natural Language Processing
tags:
  - word embeddings
  - distributional semantics
  - word2vec
  - glove
  - representation learning
date: 2026-08-01
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: draft
description: Dense lexical representations from the distributional hypothesis through word2vec and GloVe, the reasons their geometry encodes word relations, the cases in which distributional similarity departs from semantic similarity, and their relation to transformer token embeddings, with a toy skip-gram implementation and its measured output.
sources:
  - title: Mikolov et al. (2013), Efficient Estimation of Word Representations in Vector Space
    url: https://arxiv.org/abs/1301.3781
    type: paper
  - title: Mikolov et al. (2013), Distributed Representations of Words and Phrases and their Compositionality
    url: https://arxiv.org/abs/1310.4546
    type: paper
  - title: Pennington et al. (2014), GloVe - Global Vectors for Word Representation
    url: https://aclanthology.org/D14-1162.pdf
    type: paper
  - title: Bengio et al. (2003), A Neural Probabilistic Language Model
    url: https://www.jmlr.org/papers/volume3/bengio03a/bengio03a.pdf
    type: paper
---

Word embeddings are dense, low-dimensional real-valued vectors that represent the words of a vocabulary and are learned so that words occurring in similar contexts have nearby vectors. Static embeddings assign one vector to each word type, and they are trained either by predicting context words (word2vec) or by fitting global co-occurrence statistics (GloVe).

They occupy the position between sparse count representations such as [[ml/nlp/ppmi|PPMI]] and [[ml/nlp/reading/information-retrieval|tf-idf]], whose vectors are as long as the vocabulary, and the learned embedding matrices inside [[ml/deep-learning/decoder-only-transformers|decoder-only transformers]], whose upper layers make each token's representation depend on its context.

## The distributional hypothesis

The distributional hypothesis states that words occurring in similar contexts tend to have similar meanings. The idea predates neural networks by decades. Harris (1954) argued that "difference of meaning correlates with difference of distribution," and Firth (1957) summarized it as "you shall know a word by the company it keeps." Operationally, each word is represented by statistics of the contexts in which it appears, and words with similar meanings receive similar representations because they occur in similar contexts.

Sparse methods implement this directly. A co-occurrence matrix (optionally reweighted, as in [[ml/nlp/ppmi|PPMI]]) gives each word a vector as long as the vocabulary. These vectors are adequate for retrieval tasks but have two structural limitations. Their dimensionality equals the vocabulary size, and statistics are not shared between related contexts. A count model that observes "the cat sat" acquires no information about "the dog sat", since the two sets of counts occupy different columns.

[Bengio et al. (2003)](https://www.jmlr.org/papers/volume3/bengio03a/bengio03a.pdf) identified this as the curse of dimensionality for n-gram language models and proposed learning a shared real-valued vector for each word (about 60 dimensions in their experiments) jointly with a neural next-word predictor. A single observed sentence then raises the probability of the exponentially many similar sentences obtained by substituting semantically close words. Their neural language model achieved lower perplexity than modified Kneser-Ney trigram models on the Brown and AP News corpora, at a training cost of weeks on 40 CPUs. Later work retained from it the use of embeddings as the first layer of a network trained on a prediction task, more than the language model itself.

## word2vec: prediction as the training signal

[Mikolov et al. (2013)](https://arxiv.org/abs/1301.3781) reduced Bengio's model to the embeddings and a log-linear predictor with no hidden layer, which made training on billions of tokens feasible. The paper proposed two architectures:

- **CBOW** averages the context vectors and predicts the center word.
- **Skip-gram** uses the center word to predict each context word within a window of radius $c$, maximizing

$$
\frac{1}{T}\sum_{t=1}^{T} \sum_{\substack{-c \le j \le c \\ j \ne 0}} \log p(w_{t+j} \mid w_t).
$$

Skip-gram tends to give better representations of rare words, and CBOW trains faster. In both, the computational bottleneck is the softmax over the vocabulary, $p(w_O \mid w_I) = \exp(v'^{\top}_{w_O} v_{w_I}) / \sum_w \exp(v'^{\top}_w v_{w_I})$, whose denominator requires $O(|V|)$ operations per update.

[The follow-up paper](https://arxiv.org/abs/1310.4546) replaced it with **negative sampling**, which converts the multiclass prediction into binary discriminations between one observed (word, context) pair and $k$ sampled noise pairs:

$$
\log \sigma(v'^{\top}_{w_O} v_{w_I}) + \sum_{i=1}^{k} \mathbb{E}_{w_i \sim P_n(w)} \left[ \log \sigma(-v'^{\top}_{w_i} v_{w_I}) \right],
$$

with noise distribution $P_n(w) \propto U(w)^{3/4}$ (the 3/4 power flattens the unigram distribution so that rare words are sampled more often) and $k$ = 5-20 for small corpora, 2-5 at billion-word scale. The same paper subsamples frequent words, discarding tokens of very common words with a probability tied to their frequency, since a word such as "the" co-occurs with nearly every word and carries little information about it. Together these techniques reduced training to under a day for 1.6B words on one machine.

In the resulting space, the vector nearest to $\text{vec}(\text{king}) - \text{vec}(\text{man}) + \text{vec}(\text{woman})$ is $\text{vec}(\text{queen})$. On the paper's semantic/syntactic analogy test set, 300-dimensional skip-gram reached roughly 50-65% total accuracy depending on training data, where prior NNLM embeddings scored under 25% ([Mikolov et al. 2013](https://arxiv.org/abs/1301.3781), Tables 3-4). Relations such as capital-country and adjective-adverb correspond approximately to parallel offsets in the space, so that these relations are represented by linear structure.

## GloVe: regression on global counts

[Pennington et al. (2014)](https://aclanthology.org/D14-1162.pdf) observed that *ratios* of co-occurrence probabilities discriminate meaning more clearly than the probabilities themselves. In their corpus (their Table 1), for the pair ice/steam, the probe word "solid" has $P(\text{solid}\mid\text{ice})/P(\text{solid}\mid\text{steam}) = 8.9$ and "gas" has ratio $0.085$, while "water" and "fashion" (related to both or to neither) have ratios near 1. The ratio isolates the axis that separates the pair; raw probabilities are dominated by overall word frequency.

GloVe incorporates this observation by fitting log co-occurrence counts with a weighted least-squares objective over the global count matrix $X$:

$$
J = \sum_{i,j=1}^{|V|} f(X_{ij}) \left( w_i^\top \tilde{w}_j + b_i + \tilde{b}_j - \log X_{ij} \right)^2,
\qquad
f(x) = \begin{cases} (x/x_{\max})^{\alpha} & x < x_{\max} \\ 1 & \text{otherwise} \end{cases}
$$

with $x_{\max} = 100$, $\alpha = 3/4$. The weighting caps the contribution of the many frequent pairs and reduces the weight of noisy, rarely observed pairs, and zero counts contribute nothing, so the sum runs over observed pairs. Because differences of the fitted quantities are log-ratios, the ratio structure is expressed as vector arithmetic by construction. Skip-gram makes many stochastic passes over windows, while GloVe makes one pass to build counts and then fits them, and the two use the same information. Word2vec with negative sampling implicitly factorizes a shifted PMI matrix, which accounts for the similarity of the embeddings the two methods produce. On the analogy task GloVe reported results competitive with or better than word2vec at equal dimension and corpus.

## Limits of the embedding geometry

> [!warning] Distributional similarity is not semantic similarity
> These spaces put words close together when they appear in similar contexts. Antonyms, the senses of a polysemous word and hub vectors each show the difference between the two in a different way.

Nearest neighbors in these spaces reflect distributional similarity, which differs from semantic similarity in the following ways.

- **Antonyms cluster together.** "cheap" and "expensive" occur in nearly identical contexts, so their vectors are close. Distance cannot distinguish synonym from antonym.
- **One vector per type.** A polysemous word receives approximately a frequency-weighted average of its senses; the vector for "bank" lies between the finance and river senses and close to neither. Contextual models were designed to remove this limitation.
- **Hubness.** In high dimensions some vectors become nearest neighbors of a disproportionate number of words, degrading k-NN retrieval; cross-lingual embedding work introduced corrections like CSLS specifically for this.
- **Analogy arithmetic is fragile.** The analogy evaluation excludes the three input words from the candidate set; without that exclusion, the nearest vector to king - man + woman is usually king itself. Accuracy also drops sharply for rare words and relations beyond the curated test set.

## Toy skip-gram with negative sampling

The following minimal implementation trains on a synthetic corpus with two topic clusters and was run in the repository's virtual environment. Words co-occur only within a topic, so the embedding is expected to recover the cluster structure.

```python
import numpy as np

rng = np.random.default_rng(0)
animals = ["cat", "dog", "horse", "cow"]
tech = ["cpu", "gpu", "ram", "disk"]
vocab = animals + tech
idx = {w: i for i, w in enumerate(vocab)}

corpus = []
for _ in range(2000):                       # sentences stay within one topic
    topic = animals if rng.random() < 0.5 else tech
    corpus.append([idx[w] for w in rng.choice(topic, size=5)])

V, d, k, lr = len(vocab), 8, 3, 0.05
W_in = rng.normal(0, 0.1, (V, d))           # center-word vectors
W_out = rng.normal(0, 0.1, (V, d))          # context-word vectors
sigmoid = lambda x: 1 / (1 + np.exp(-x))

for epoch in range(5):
    for sent in corpus:
        for t, center in enumerate(sent):
            for ctx in sent[max(0, t-2):t] + sent[t+1:t+3]:
                negs = rng.integers(0, V, size=k)
                for target, label in [(ctx, 1.0)] + [(n, 0.0) for n in negs]:
                    v, u = W_in[center].copy(), W_out[target].copy()
                    g = sigmoid(v @ u) - label   # d loss / d score
                    W_out[target] -= lr * g * v  # symmetric updates from
                    W_in[center] -= lr * g * u   # pre-update copies

sims = W_in @ W_in.T / (np.linalg.norm(W_in, axis=1)[:, None] * np.linalg.norm(W_in, axis=1))
same = np.mean([sims[idx[a], idx[b]] for a in animals for b in animals if a != b])
cross = np.mean([sims[idx[a], idx[b]] for a in animals for b in tech])
print(f"within-topic cosine: {same:.3f}, cross-topic: {cross:.3f}")
```

The measured output is `within-topic cosine: 0.990, cross-topic: 0.132`. Words that share contexts have nearly identical directions, and the two topics remain separated. With only two disjoint topic clusters, the within-topic similarity is higher than in real corpora, where cosine similarities of 0.5-0.8 between close neighbors are typical.

## Relation to transformer embeddings

The input layer of a transformer is also a learned embedding matrix $E \in \mathbb{R}^{|V| \times d}$, defined over [[ml/nlp/reading/tokenization|subword tokens]] instead of words and trained end-to-end on next-token prediction. That training signal generalizes skip-gram's from a fixed window to the full causal context, with the transformer stack in place of the log-linear predictor. The two differ in the computation above the lookup. A static embedding model performs none, so every occurrence of a type shares one vector, while the attention layers of a transformer produce token representations conditioned on the sentence, which resolves polysemy. Static embeddings remain in use where their lower computational cost matters, in initialization for low-resource settings, lightweight similarity and retrieval, and interpretability studies.

## Sources

- [Mikolov et al. (2013), Efficient Estimation of Word Representations in Vector Space](https://arxiv.org/abs/1301.3781)
- [Mikolov et al. (2013), Distributed Representations of Words and Phrases and their Compositionality](https://arxiv.org/abs/1310.4546)
- [Pennington et al. (2014), GloVe: Global Vectors for Word Representation](https://aclanthology.org/D14-1162.pdf)
- [Bengio et al. (2003), A Neural Probabilistic Language Model](https://www.jmlr.org/papers/volume3/bengio03a/bengio03a.pdf)

## Related notes

- [[ml/nlp/ppmi|PPMI]]
- [[ml/nlp/reading/tokenization|Tokenization, Segmentation, and Edit Distance]]
- [[ml/nlp/reading/information-retrieval|Indexing and Information Retrieval]]
- [[ml/nlp/reading/neural-networks|Feedforward Neural Networks]]
- [[ml/deep-learning/decoder-only-transformers|Decoder-Only Transformers]]
