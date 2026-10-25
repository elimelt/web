---
title: Elijah Melton's Technical Notes
description: Reference notes on algorithms, machine learning, systems, software, hardware, and mathematics, drafted with language models and reviewed by Elijah Melton.
updated: 2026-10-25
authors:
  - elimelt
  - gpt-5.6-sol
  - gpt-6
  - claude-opus-5-5
---

Reference notes on algorithms, machine learning, systems, software, hardware,
and mathematics. Language models write most of the text from Elijah Melton's
notes, papers, and code, and he reviews and edits each note before it goes up.
Elijah's own writing is on his [blog](https://blog.elimelt.com).

## Selected notes

- [[algorithms/greedy-algorithms|Why earliest finish time is optimal for interval scheduling]]: greedy-stays-ahead and exchange proofs, plus why interval partitioning sorts by start time instead.
- [[ml/nlp/decoding-strategies|Beam search, length normalization, and language-model decoding]]: the beam curse, greedy decoding, temperature, top-k, and nucleus sampling.
- [[ml/recommender-systems/deep-neural-networks-for-youtube-recommendations|Deep Neural Networks for YouTube Recommendations]]: candidate generation, ranking, sampled softmax, and watch-time objectives.
- [[ml/recommender-systems/predicting-clicks-on-ads-at-facebook|Practical Lessons from Predicting Clicks on Ads at Facebook]]: the GBDT plus logistic-regression model, data freshness, and online learning.
- [[ml/recommender-systems/two-tower-retrieval|Two-tower retrieval with a MovieLens experiment]]: an executable look at embedding retrieval and ranking.
- [[systems/operating-systems/benchmarks/store_fwd|Store-to-load forwarding benchmarks]]: a runnable x86 harness comparing exact-match, independent, and partially overlapping store/load pairs, with recorded setup and per-run timings.

## Browse by topic

- [[algorithms/index|Algorithms]]
- [[hardware/index|Hardware]]
- [[math/index|Mathematics]]
- [[ml/index|Machine learning]]
- [[software/index|Software engineering]]
- [[systems/index|Systems]]
- [[reference/index|Reference material]]

## How these notes are written

Each note records a proof, a paper, a benchmark, or an implementation detail
that Elijah wanted to be able to find again. A model drafts the note and does
most of the revising. Elijah chooses the topics and sources and reviews each
draft. The `authors` field in a note's frontmatter lists every model that
edited it, and the git history records each change.

Coverage is uneven, and many notes assume background they never explain. For a
first introduction to a subject, a textbook or a course is a better place to
start.

## Corrections

Notes can contain errors. They get fixed when someone finds them, and
corrections are welcome as a [pull request](https://github.com/elimelt/web).
