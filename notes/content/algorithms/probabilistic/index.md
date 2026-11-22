---
title: Probabilistic Data Structures
category: Algorithms
tags:
  - probabilistic data structures
  - sketching
  - streaming algorithms
  - hashing
  - randomized algorithms
date: 2026-11-15
updated: 2026-11-22
authors:
  - elimelt
status: draft
description: A series on randomized summaries of large data sets (hash families, membership filters, cardinality and frequency sketches, quantile sketches, similarity estimation and stream sampling), with shared notation and a common benchmark of 161 million Wikimedia pageview records.
---

A probabilistic data structure answers queries about a data set approximately, using space far smaller than the data set, and gives the approximation as a statement about a random choice made by the structure itself: with probability at least $1 - \delta$ over the choice of hash functions or samples, the answer is within $\varepsilon$ of the truth. The randomness is internal. No assumption is made about the distribution of the input, which may be chosen by an adversary who does not see the random choices.

In practice these structures appear where exact answers would require memory proportional to the input: counting distinct users per day in a database's query planner, finding the most frequent flows on a router, testing whether a key might exist before reading a disk block, or estimating latency percentiles across many servers without shipping every measurement. Most are also mergeable: two summaries of disjoint inputs combine into a summary of the union with the same guarantee, which makes them suitable for distributed aggregation.

## Notation

The notes in this series use the following conventions unless they state otherwise.

- **Stream.** The input is a sequence of updates $(i_t, c_t)$, $t = 1, \dots, T$, with each item $i_t$ in a universe $[n] = \{1, \dots, n\}$. In the *cash-register* model every $c_t > 0$; in the *turnstile* model $c_t$ may be negative. A stream of plain items is the special case $c_t = 1$.
- **Frequency vector.** $a \in \mathbb{Z}^n$ with $a_i = \sum_{t : i_t = i} c_t$. Its norms are $\|a\|_1 = \sum_i |a_i|$ and $\|a\|_2 = (\sum_i a_i^2)^{1/2}$. In the cash-register model $N = \|a\|_1$ is the total count.
- **Frequency moments.** $F_k = \sum_i a_i^k$, so $F_0$ is the number of distinct items (with $0^0 = 0$), $F_1 = N$, and $F_2 = \|a\|_2^2$.
- **Accuracy.** An $(\varepsilon, \delta)$ guarantee for an estimate $\hat{x}$ of $x$ states $\Pr[|\hat{x} - x| > \varepsilon \cdot s] \le \delta$ for a stated scale $s$: $s = x$ for a relative guarantee, or $s = \|a\|_1$ for an additive one.
- **Hashing.** $h : [n] \to [w]$ denotes a hash function drawn from a family $\mathcal{H}$. A family is $k$-wise independent if for any $k$ distinct keys the values $h(x_1), \dots, h(x_k)$ are independent and uniform. Analyses that assume a fully random function say so; the first note of the series concerns when that assumption is justified.
- **Logarithms.** $\ln$ is the natural logarithm, $\lg$ the base-2 logarithm.

## The shared benchmark

The experiments in the series use the 24 hourly [Wikimedia pageview files](https://dumps.wikimedia.org/other/pageviews/readme.html) dated 4 March 2026, covering the hours ending 00:00 through 23:00 UTC. They hold records `domain_code page_title count_views total_response_size`, one record per (project, page, hour) with at least one view after Wikimedia's filtering of identified spiders and automated agents. The files were read from a [public mirror](https://clickhouse-public-datasets.s3.amazonaws.com/wikistat/original/) that holds the same files under the same names.

| Quantity | Value |
| --- | ---: |
| Records (stream length, one per page and hour) | 160,961,718 |
| Distinct (project, page) keys, $F_0$ | 60,974,808 |
| Total views, $N = \|a\|_1$ | 445,961,446 |
| Largest $a_i$ (English Wikipedia's Main Page) | 4,354,576 (0.98% of $N$) |
| Keys with exactly one view | 58.9% of keys, 8.1% of views |
| Views held by the top $10^3$, $10^5$, $10^6$ keys | 9.1%, 32.6%, 57.3% |
| $\|a\|_2 / \|a\|_1$ | 0.0124 |

The stream has two properties that matter for sketches. It is long enough ($F_0 \approx 6 \times 10^7$) to reach the regime where asymptotic bounds should apply, and its frequency distribution is heavy-tailed but flatter than the Zipf distributions often assumed in analyses: the log-log slope of frequency against rank is about 0.75 between ranks 10 and 1000 and about 0.9 to 1.1 beyond rank $10^5$.

## Series

The notes are ordered so that each depends only on earlier ones. Notes without links are planned.

1. **[[algorithms/probabilistic/hashing-for-sketches|Hashing for sketches]].** Universal and $k$-independent families, multiply-shift, polynomial and tabulation hashing, the independence each sketch's analysis assumes, and HyperLogLog, Count-Min and AMS run with each family on dense and hashed keys from the benchmark.
2. **[[algorithms/probabilistic/bloom-filters|Bloom filters and their variants]].** The false-positive rate and its exact form, partitioned, double-hashed, blocked and counting filters, and LevelDB's probe sequence, with false-positive rates measured on the pageview keys and the cost per lookup inside and beyond the cache.
3. **[[algorithms/probabilistic/cuckoo-quotient-xor-ribbon-filters|Cuckoo, quotient, xor and ribbon filters]].** Fingerprint filters that approach the $\lg(1/\varepsilon)$ bits-per-key lower bound, with false-positive rates, construction and insertion thresholds, and build and lookup costs measured on the pageview keys against Bloom filters of the same rate.
4. **[[algorithms/probabilistic/hyperloglog-count-min|HyperLogLog and Count-Min]].** Distinct counting and frequency estimation: the estimators and their proofs, the corrections added after the original analyses, and the measured error on the pageview stream against the published bounds.
5. **[[algorithms/probabilistic/heavy-hitters|Heavy hitters]].** Misra–Gries, Space-Saving, Count Sketch and Count-Min with conservative update for the heavy-hitter and top-$k$ problems, the isomorphism between the two counter algorithms, and recall, precision, error and update cost measured on the pageview stream in recorded and shuffled order.
6. **Quantile sketches.** GK, KLL, t-digest, DDSketch and REQ: rank error against relative error, mergeability, and accuracy at the tails on real latency data.
7. **MinHash and locality-sensitive hashing.** Jaccard similarity estimation, b-bit MinHash and banding for near-duplicate detection on Wikipedia article text. Sources: Broder (1997), Indyk and Motwani (1998), Li and König (2010).
8. **Sampling from streams.** Reservoir sampling and Algorithm L, weighted sampling without replacement, and priority sampling for subset-sum estimation. Sources: Vitter (1985), Efraimidis and Spirakis (2006), Duffield, Lund and Thorup (2007).
9. **Randomized search structures.** Skip lists and treaps: expected and high-probability bounds on depth, and measured lookup cost against balanced trees. Sources: Pugh (1990), Seidel and Aragon (1996).

## Related notes

- [[math/probability/probability-expectation-concentration|Expectation and concentration]], for the Markov, Chebyshev and Chernoff bounds used throughout
- [[systems/databases/foundations/ch3-storage-and-retrieval#Bloom filters|Bloom filters in LSM storage engines]]
- [[algorithms/index|Algorithms]]
