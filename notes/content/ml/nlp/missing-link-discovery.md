---
title: Missing-Link Discovery Pipeline
aliases:
  - software/missing-link-discovery
category: Natural Language Processing
tags:
  - embeddings
  - information retrieval
  - ranking
  - pipeline design
  - knowledge base
date: 2026-07-31
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: The stage architecture, retrieval and ranking algorithm, and usage of the missing-link discovery pipeline in the notes repository.
sources:
  - title: "SPEC.md: Missing-Link Discovery Pipeline"
    url: https://github.com/elimelt/notes/blob/feb11ef355944ddfcac5848cb32c17b66623a57b/SPEC.md
    type: docs
  - title: "First real run: proposals and evaluation (issue #54)"
    url: https://github.com/elimelt/notes/issues/54
    type: docs
  - title: "Baseline rerun and experiment export (issue #119)"
    url: https://github.com/elimelt/notes/issues/119
    type: docs
  - title: "Word Translation Without Parallel Data (CSLS), Conneau et al. 2018"
    url: https://arxiv.org/abs/1710.04087
    type: paper
  - title: Qwen3-Embedding-0.6B model card
    url: https://huggingface.co/Qwen/Qwen3-Embedding-0.6B
    type: docs
  - title: "TextRank: Bringing Order into Text"
    url: https://aclanthology.org/W04-3252/
    type: paper
  - title: "PositionRank: An Unsupervised Approach to Keyphrase Extraction"
    url: https://aclanthology.org/P17-1102/
    type: paper
  - title: "Simple Unsupervised Keyphrase Extraction using Sentence Embeddings"
    url: https://aclanthology.org/K18-1022/
    type: paper
  - title: "SPEC-INLINE-LINKING.md: learned inline-link discovery"
    url: https://github.com/elimelt/notes/blob/6ae85f5a2b35d18beb83eaf7882f0e89e724b315/linkdiscovery/SPEC-INLINE-LINKING.md
    type: docs
  - title: "Gerlach et al. 2021 — Multilingual Entity Linking System for Wikipedia with a Machine-in-the-Loop Approach (add-a-link)"
    url: https://arxiv.org/abs/2105.15110
    type: paper
---

The missing-link discovery pipeline,
[`linkdiscovery/`](https://github.com/elimelt/notes/tree/feb11ef355944ddfcac5848cb32c17b66623a57b/linkdiscovery),
is a batch system in the notes repository that identifies pairs of notes that
are strongly related but not yet linked and proposes a link for each pair,
with supporting evidence, for human review. Its criterion is stronger than
similarity. A proposal asserts that a direct navigational link would benefit a
reader and states where in the source note the link should be placed.

The system does not edit notes. It emits ranked proposals (`proposals.jsonl` /
`proposals.md`), and link insertion is a separate step that requires human
approval. Its first full run produced
[issue #54](https://github.com/elimelt/notes/issues/54); the accepted links were
merged in [#59](https://github.com/elimelt/notes/pull/59). The later CPU
baseline rerun and its experiment bundle are tracked in
[issue #119](https://github.com/elimelt/notes/issues/119).

## Architecture

The pipeline has six stages, with typed, serializable artifacts at every
boundary:

```text
raw content
  -> source adapter        (Corpus: documents + existing relationships)
  -> preprocessor          (ProcessedCorpus: typed regions, semantic units)
  -> embedder              (EmbeddingIndex: vectors + runtime provenance)
  -> candidate generator   (CandidateSet: high-recall pairs + raw features)
  -> ranker                (ProposalSet: scored, directed, evidence-backed)
  -> reporter              (JSONL / Markdown review artifacts)
```

Two design rules determine most of the structure.

**1. Adapters define source semantics.** The core package has no dependency on
Markdown, wikilinks, frontmatter or the repository's layout. These are handled
by a separate `linkdiscovery_markdown` package that translates host concepts
into generic contracts. Each stage is a `Protocol`, so any stage can be
replaced without changes to the others:

```python
class Embedder(Protocol):
    """Embeds semantic units, returning vectors plus model and runtime provenance.

    Must not expose PyTorch, MLX, NumPy, or sentence-transformers objects
    across the boundary, must reuse cached vectors through ``cache``, and
    must record device selection and fallbacks in the returned runtime
    report (no silent fallback).
    """

    def embed(
        self, corpus: ProcessedCorpus, config: EmbeddingConfig, cache: ArtifactCache
    ) -> EmbeddingIndex:
        """Embed every eligible unit, reusing cache entries where keys match."""
        ...
```

[interfaces.py#L76-L90](https://github.com/elimelt/notes/blob/feb11ef355944ddfcac5848cb32c17b66623a57b/linkdiscovery/src/linkdiscovery/interfaces.py#L76-L90)

**2. All artifacts are content-addressed.** Artifacts are written atomically
to a store keyed by fingerprints, and each stage's cache key is composed of
exactly the inputs that affect its output. In the embedding cache key, for
example, a change to a ranking weight does not invalidate embeddings, but a
change to the chunker, the model revision or the instruction text does:

```python
options_fp = _runtime_options_fingerprint(config)
keys = {
    unit.id: combine_fingerprints(
        unit.content_hash,
        corpus.preprocessing_fingerprint,
        provider.model_fingerprint,
        options_fp,
    )
    for unit in units
}
```

[embedder.py#L174-L183](https://github.com/elimelt/notes/blob/feb11ef355944ddfcac5848cb32c17b66623a57b/linkdiscovery/src/linkdiscovery/embed/embedder.py#L174-L183)

Device and batch size are deliberately *excluded* from the key. They must not
change embedding values, so including them would discard reusable vectors
([embedder.py#L89-L103](https://github.com/elimelt/notes/blob/feb11ef355944ddfcac5848cb32c17b66623a57b/linkdiscovery/src/linkdiscovery/embed/embedder.py#L89-L103)).
As a result, a second run over an unchanged corpus reports 2,931/2,931 cache
hits and re-ranks in seconds.

The embedding runtime qualifies devices in preference order (`[mps, cpu]`) by
encoding representative inputs on each; framework availability alone is not
sufficient. On an out-of-memory error it halves the batch size and resumes
from the last complete batch. Every fallback is recorded in the run manifest,
and the model, precision and output dimension are never changed silently.

### Experiment export

The pipeline's internal embedding table is organized by unit, because
retrieval uses document, section and title views. For reranking experiments,
the completed run can be joined with its processed-corpus artifact into one
self-contained NumPy bundle:

```bash
cd linkdiscovery
uv run linkdiscovery export-embeddings \
  --artifacts .artifacts \
  --run-id run-20260801T043353Z-0e713a7a \
  --out .artifacts/experiments/run-20260801T043353Z-0e713a7a-embeddings.npz
```

The bundle can be loaded with `allow_pickle=False` and contains the following
aligned arrays.

| Array | Shape in the baseline rerun | Meaning |
| --- | ---: | --- |
| `matrix` | `(258, 512)` | normalized document-view rows |
| `document_ids` | `(258,)` | row index for `matrix` |
| `unit_matrix` | `(3184, 512)` | every semantic-unit embedding |
| `unit_ids` | `(3184,)` | row index for `unit_matrix` |
| `unit_document_ids` / `unit_views` | `(3184,)` | document and retrieval view for each unit |
| `unit_texts` | `(3184,)` | text used for token/vocabulary matching |
| `unit_source_spans_json` | `(3184,)` | source offsets for inline placement |

`matrix` holds the document-level embeddings; its row `i` is the document
whose ID is `document_ids[i]`. `unit_matrix` is the full matrix used by
retrieval, so section-level reranking and vocabulary matching do not require
reconstructing the pipeline. A minimal document reranker begins as follows.

```python
import numpy as np

with np.load(".artifacts/experiments/run-...-embeddings.npz", allow_pickle=False) as bundle:
    document_ids = bundle["document_ids"].astype(str)
    matrix = bundle["matrix"]
    row_by_document = {document_id: row for row, document_id in enumerate(document_ids)}
    query_row = row_by_document["ml/nlp/word-embeddings"]
    cosine_scores = matrix @ matrix[query_row]
```

Inline-link suggestions are obtained by filtering `unit_views` to `section`,
comparing the corresponding `unit_texts` or vectors, and using the decoded
source spans to locate each suggestion for review. The exporter includes
evidence metadata; it does not edit Markdown or create a link without review.

### Offline anchor analysis

The first offline experiment used the baseline rerun's 2,353 ranked proposals
and compared four anchor selectors. The reproducible analysis script is
[`scripts/inline_link_analysis.py`](https://github.com/elimelt/notes/blob/feb11ef355944ddfcac5848cb32c17b66623a57b/linkdiscovery/scripts/inline_link_analysis.py);
its outputs are kept under `.artifacts/experiments/`.

| Selector | What it tries | Coverage | Observation |
| --- | --- | ---: | --- |
| Descending exact n-gram | First usable shared 4-, 3-, 2-, then 1-gram | 2,331 / 2,353 | 177 four-grams, 228 three-grams, 1,114 two-grams, and 812 one-grams; the long-first rule often falls back to generic words. |
| Weighted exact phrase | Shared phrase scored by IDF, length, position, and generic-word penalty | 2,331 / 2,353 | Better than length alone in principle, but still selects code fragments or words such as `len`, `void`, and `0` without stronger span typing. |
| Natural exact phrase | Exact overlap with code-like tokens, boilerplate, and weak one-word spans rejected | 2,081 / 2,353 | Safer because it declines more often, but the remaining one-word overlaps are not sufficient evidence of a natural link. |
| Asymmetric keyphrase | Independently extract a salient phrase on each side | 2,353 / 2,353 | More coverage and more natural bidirectionality, but a naive IDF/position scorer over-selects identifiers and implementation details. |

The analysis indicates that “bidirectional” should describe the relationship
between two notes and should not require the same anchor text in both. A
strict shared n-gram can produce unnatural link text, and it fails when the
ranked pair is semantically related but uses different vocabulary. An
unconstrained keyphrase scorer, conversely, selects plausible-looking but
irrelevant anchors. The resulting policy generates source and target mention
candidates independently, reranks them with the pair evidence, and permits a
no-link result.

A production design would resemble mention detection with entity
disambiguation more than unconstrained phrase matching. It would identify
noun-phrase, named-entity and section-heading candidates; remove headings,
`Related notes`, tables and code spans; and score each candidate using local
grammatical context, IDF, target-title/description similarity,
section-to-document similarity, source position and overlap with existing
links. This design follows TextRank's graph-based salience model and
PositionRank's position-biased PageRank for keyphrases, and the
sentence-embedding approach of EmbedRank applies to ranking candidate phrases
against the target note ([TextRank](https://aclanthology.org/W04-3252/),
[PositionRank](https://aclanthology.org/P17-1102/),
[EmbedRank](https://aclanthology.org/K18-1022/)).

### Token-alignment preflight

The next preflight used the cached, pinned Qwen3-Embedding-0.6B model on MPS,
so it evaluated contextual token representations rather than the hashing
baseline used by the deterministic rerun. It encoded 64 unique evidence units
from the top 50 ranked proposals.

Unrestricted Smith-Waterman over the token similarity matrix over-aligned long
stretches of headings, prose, and code-like material, so its raw score is not
a suitable anchor selector. Markdown-aware prose candidates capped at 1–10
words plus bounded, bidirectional MaxSim produced spans for 48/50 pairs, with
a median span size of two words and median symmetric MaxSim of 0.4232.

In a separate candidate-recall audit, the same span generator recovered 1,142
of 1,451 existing explicit-link anchors (78.7%). This is a preflight recall
measurement only, because existing links include boilerplate and `Related
notes` locations that are not necessarily eligible for new inline links. The
experiment validates the mechanics of span generation and does not measure the
quality of automatically selected links. Salience, prose-region filtering,
target-document relevance and a human precision measurement are required
before the method is added to the main pipeline. Detailed output is kept in
`.artifacts/experiments/token-alignment-preflight.md` and its JSON companion.

## Algorithm

**Views.** Each note is decomposed into three retrieval views: a bounded
`document` view (title, description, headings, leading content), `section`
chunks (grouped under their lowest heading, split at region boundaries,
carrying their heading path as context), and a `title` view. Chunk sizes are
measured in tokens of the model's tokenizer rather than in words.

**High-recall retrieval.** For every unit in every view, cosine top-k
neighbors are retrieved (k = 50 per unit). Exact search runs as blocked matrix
products so that memory stays bounded; an HNSW backend is used above 50k
units:

```python
def exact_top_k(
    table: VectorTable,
    k: int,
    *,
    query: VectorTable | None = None,
    block_size: int = 1024,
) -> list[list[tuple[int, float]]]:
    """Blocked exact cosine top-k over normalized vectors. ..."""
```

[retrieval.py#L88-L104](https://github.com/elimelt/notes/blob/feb11ef355944ddfcac5848cb32c17b66623a57b/linkdiscovery/src/linkdiscovery/candidates/retrieval.py#L88-L104)

Unit matches are collapsed into canonical unordered document pairs.
Self-pairs, alias-equivalent pairs, excluded documents and already-linked
pairs are removed at this stage, so later stages rank only pairs that are not
yet linked.

**Hubness correction.** Raw cosine similarity favors "hub" notes that are
close to many others (surveys, index-like pages) and long notes, whose many
units give more opportunities for a high maximum similarity by chance. Every
pair similarity is therefore corrected by the local neighborhood density of
both endpoints, using CSLS local scaling (Conneau et al. 2018), `csls = 2·sim
− density(a) − density(b)`, where a document's density is its mean similarity
to its 10 nearest neighbors. The same correction is applied at section level:

```python
flat = np.sort(sims, axis=None)[::-1]
best = float(flat[0])
top_r = float(flat[: min(TOP_R_SECTIONS, flat.shape[0])].mean())
tied = np.argwhere(sims >= flat[0])
best_source, best_target = min((source_ids[i], target_ids[j]) for i, j in tied)
csls_best = (
    2.0 * best - self._density.get(best_source, 0.0) - self._density.get(best_target, 0.0)
)
```

[generator.py#L347-L354](https://github.com/elimelt/notes/blob/feb11ef355944ddfcac5848cb32c17b66623a57b/linkdiscovery/src/linkdiscovery/candidates/generator.py#L347-L354)

**Ranking.** The ranker is an interpretable weighted model over normalized
features. Version 1 has no learned weights, so every score decomposes into
inspectable terms. Pairs that bridge disconnected graph neighborhoods receive
a bonus; hubs, near-duplicates and pairs already connected by a short graph
path receive a penalty:

```python
score = clamp01(
    weights["w_document"] * normalized["csls_similarity_norm"]
    + weights["w_local"] * normalized["best_chunk_similarity_norm"]
    + weights["w_breadth"] * normalized["support_breadth_norm"]
    + weights["w_lexical"] * normalized["lexical_similarity_norm"]
    + weights["w_bridge"] * bridge
    - weights["w_hub"] * hub
    - weights["w_duplicate"] * near_duplicate
    - weights["w_redundancy"] * redundancy
)
```

[ranker.py#L383-L392](https://github.com/elimelt/notes/blob/feb11ef355944ddfcac5848cb32c17b66623a57b/linkdiscovery/src/linkdiscovery/ranking/ranker.py#L383-L392)

Each proposal also reports three separate estimates, *relatedness* (semantic
strength), *usefulness* (whether a link would help a reader) and *missingness*
(confidence that the relationship is truly absent), together with a confidence
band that is recalibrated against accumulated accept and reject decisions.
Link direction is determined by placement evidence. The note whose *section*
best matches the other note's document view hosts the link, and symmetric
evidence yields an undirected proposal. Per-note results are reordered by
maximal marginal relevance so that near-identical targets do not dominate the
review queue.

## Usage

```bash
cd linkdiscovery
uv sync --extra embeddings   # or plain `uv sync` for the no-download baseline

: "Full run with Qwen3-Embedding-0.6B on MPS (falls back to CPU)"
uv run linkdiscovery run --config configs/notes.yaml --artifacts .artifacts

: "Weak-supervision quality check: hide 15% of existing links"
uv run linkdiscovery evaluate --config configs/notes.yaml --artifacts .artifacts \
  --holdout-fraction 0.15 --seed 7

: "Stratified review queue: top-ranked, near-threshold, random, and sparse regions"
uv run linkdiscovery review-queue --proposals .artifacts/reports/proposals.jsonl \
  --size 25 --seed 7

: "Export document and unit matrices for reranking and inline-link experiments"
uv run linkdiscovery export-embeddings --artifacts .artifacts \
  --run-id run-20260801T043353Z-0e713a7a \
  --out .artifacts/experiments/run-20260801T043353Z-0e713a7a-embeddings.npz
```

The pipeline is configured by a single declarative file
([configs/notes.yaml](https://github.com/elimelt/notes/blob/feb11ef355944ddfcac5848cb32c17b66623a57b/linkdiscovery/configs/notes.yaml)).
Unknown fields are errors, the model is pinned to an immutable revision, and
the resolved configuration is recorded in the run manifest. Reports are
written to `.artifacts/reports/`. `proposals.jsonl` is the machine-readable
artifact, with every feature and evidence span, and `proposals.md` is the
review document, with a checklist per proposal. Review decisions are stored
durably and are used for confidence calibration on the next run.

`candidates.existing_relationship_policy` controls the opt-in existing-link
behavior for token/lexical suggestion experiments. `exclude` is the default
and preserves missing-link discovery semantics. `penalize` or `reward` keeps
existing direct-link pairs in the candidate set and emits an
`existing_link_adjustment` of `-1` or `+1`; `ranking.weights.w_existing_link`
controls its score contribution. The policy is recorded in the resolved run
configuration and changing it invalidates candidate artifacts.

On the current corpus snapshot, the deterministic CPU baseline rerun processed
258 notes and 3,184 units, generated 8,714 candidate pairs, and produced 2,353
proposals. The run is reproducible from
[issue #119](https://github.com/elimelt/notes/issues/119). The earlier neural MPS run
proposed 2,292 candidate links and recovered held-out existing links at
recall@25 ≈ 0.20 with untuned default weights. These are qualification
measurements; a larger number of proposals is not evidence of better links.

## Learned inline links (v2)

The pair-level pipeline determines which notes should be connected. Version 2,
specified in
[`SPEC-INLINE-LINKING.md`](https://github.com/elimelt/notes/blob/6ae85f5a2b35d18beb83eaf7882f0e89e724b315/linkdiscovery/SPEC-INLINE-LINKING.md)
and implemented in
[`linkdiscovery/inline/`](https://github.com/elimelt/notes/tree/6ae85f5a2b35d18beb83eaf7882f0e89e724b315/linkdiscovery/src/linkdiscovery/inline),
determines *which exact phrase in a note should become a link, and to which
target*. It is formulated as staged, closed-world mention detection followed
by entity linking with an explicit no-link option (the BLINK / Wikimedia
add-a-link pattern), and it is neither relation extraction nor a joint model.

**The audit precedes training.** Existing links are weak supervision rather
than gold labels, so the first component built is an annotation workflow,
consisting of a 150-link stratified sample, a terminal labeling tool, Cohen's
κ / Krippendorff's α agreement, and a go/no-go gate (κ ≥ 0.6 and ≥ 150 clean
positives). Each judged link is assigned a supervision tier. The central rule
is that links in Related-notes sections, headings and tables are correct
*edges* but poor *anchor* examples:

```python
def derive_tier(
    target_correct: bool,
    anchor_natural: bool,
    placement_valid: bool,
    region_kind: LinkRegionKind,
) -> Tier:
    """Map one audit judgment onto a supervision tier per SPEC-INLINE-LINKING §4.

    1. Wrong target -> Tier D ("exclude or use as negatives") ...
    2. Graph-only region -> at best Tier C ("graph supervision only") ...
    3. Prose-like region with a natural anchor and valid placement -> Tier A ...
    4. Prose-like region, correct target, but an unnatural anchor or
       invalid placement -> Tier B ...
    """
```

[audit/tiers.py#L50-L71](https://github.com/elimelt/notes/blob/6ae85f5a2b35d18beb83eaf7882f0e89e724b315/linkdiscovery/src/linkdiscovery/inline/audit/tiers.py#L50-L71)

**Architecture A: frozen encoder, three small heads.** The encoder is not
fine-tuned; only three small heads are trained, which takes minutes on MPS.
They are a naturalness MLP over Lee/SpanBERT-style span representations
(`[start | end | mean-interior | width | hand features]`), target retrieval as
a full-catalog softmax (with about 258 targets the entire catalog fits in
every step, so no in-batch-negative approximation is needed), and a reranker
head. Unlinked spans are treated as positive-unlabeled data, because an
unlinked "MapReduce" is usually a correct link that was never written and
should not be used as a negative. The treatment uses class-prior weighting and
negatives confirmed by a cross-encoder (the RocketQA hazard). Candidate
anchors come from a self-corpus anchor dictionary with Milne–Witten
keyphraseness (link-probability floor 6.5%), and hard rules are applied
outside the learned scores: candidate spans may not overlap existing links,
code, math or frontmatter.

**The three scores remain separate until selection.** A single collapsed score
cannot represent a correct target with an unnatural anchor, so naturalness,
target correctness and placement validity are combined only at global
selection. They are combined by a geometric mean, under which any near-zero
head score drives the combined score toward zero:

```python
def combine_scores(
    naturalness: float,
    target_correctness: float,
    placement_validity: float,
    weights: Mapping[str, float],
) -> float:
    """Weighted geometric mean of the three head scores (spec §6 Q24).

    ... The geometric mean is chosen over an arithmetic one because it
    vetoes: any near-zero head drives the combined score toward zero, so a
    wrong target cannot be rescued by a beautiful anchor.
    """
```

[select.py#L150-L167](https://github.com/elimelt/notes/blob/6ae85f5a2b35d18beb83eaf7882f0e89e724b315/linkdiscovery/src/linkdiscovery/inline/select.py#L150-L167)

Selection then applies temperature-scaled acceptance thresholds (or
split-conformal thresholds, with a finite-sample `P(accepted ∧ wrong) ≤ ε`
guarantee), a capped per-note budget of about 1 link per 175 words, and MMR
diversity. The budget reflects Wikipedia server-log studies showing that links
compete for attention and that most added links are never clicked.

**Status.** Phases 1–3 are implemented and run offline only:

```bash
uv run linkdiscovery inline audit-sample --config configs/notes.yaml \
  --artifacts .artifacts --size 150 --seed 7 --out .inline/audit
uv run linkdiscovery inline annotate --sample .inline/audit/audit-sample.json \
  --annotator you --labels .inline/audit/labels-you.jsonl
uv run linkdiscovery inline recall-check --config configs/notes.yaml \
  --artifacts .artifacts --sample .inline/audit/audit-sample.json
uv run linkdiscovery inline propose --config configs/notes.yaml \
  --artifacts .artifacts --engine baseline --out .inline/proposals
```

On this corpus the span generator covers 93% of audited prose anchors (spec
gate: ≥ 85%). The deterministic baseline engine, which is the fallback under
the kill criterion if the learned heads cannot reach precision@1 ≥ 0.70,
already proposes 485 anchored links (for example, "load balancing" in the HTTP
note → the load-balancing note). Training of the learned heads depends on the
outcome of the human audit. The v1 quality target is precision@1 ≈ 0.75–0.80
at about 40% recall, matching the deployed Wikimedia add-a-link system. The
subsystem does not edit notes; like v1, it emits proposals for review.

## Edge cases or limits

- Existing links are biased supervision. Recovery metrics measure agreement
  with past linking practice and do not measure the value of novel links.
  Human precision-at-k from review decisions is the primary quality metric.
- Proposal IDs currently embed direction, so a direction flip between runs
  orphans that pair's earlier review decision (it is ignored, not misapplied).
- Notebook-generated notes should receive links in their sources; edits to the
  generated Markdown are lost on regeneration.
- `exclude` remains the safe default for existing direct links. `reward` is
  useful for learning from positive linking behavior, while `penalize` is
  useful when the token-based phase should prefer novel suggestions. Either
  opt-in mode can surface already-linked pairs and therefore cannot replace
  the missing-link review queue.

## Sources

- [SPEC.md: the full design contract](https://github.com/elimelt/notes/blob/feb11ef355944ddfcac5848cb32c17b66623a57b/SPEC.md)
- [Issue #54: first-run proposals and evaluation](https://github.com/elimelt/notes/issues/54)
- [Issue #119: baseline rerun and experiment export](https://github.com/elimelt/notes/issues/119)
- [PR #63: pipeline implementation](https://github.com/elimelt/notes/pull/63) and [PR #59: applied links](https://github.com/elimelt/notes/pull/59)
- [SPEC-INLINE-LINKING.md: learned inline-link design contract](https://github.com/elimelt/notes/blob/6ae85f5a2b35d18beb83eaf7882f0e89e724b315/linkdiscovery/SPEC-INLINE-LINKING.md) and [PR #135: inline subsystem implementation](https://github.com/elimelt/notes/pull/135)
- [Gerlach et al. 2021, Wikimedia add-a-link](https://arxiv.org/abs/2105.15110), [Milne & Witten 2008, Learning to Link with Wikipedia](https://doi.org/10.1145/1458082.1458150), [Paranjape et al. 2016, Improving Website Hyperlink Structure Using Server Logs](https://doi.org/10.1145/2835776.2835832)
- [Conneau et al. 2018, CSLS hubness correction](https://arxiv.org/abs/1710.04087)
- [Qwen3-Embedding-0.6B model card](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B)
- [Mihalcea & Tarau 2004, TextRank](https://aclanthology.org/W04-3252/)
- [Florescu & Caragea 2017, PositionRank](https://aclanthology.org/P17-1102/)
- [Bennett et al. 2018, EmbedRank](https://aclanthology.org/K18-1022/)

## Related notes

- [[ml/recommender-systems/retrieval-and-ranking|Retrieval and ranking]]
- [[ml/nlp/reading/information-retrieval|Information retrieval]]
- [[ml/recommender-systems/two-tower-retrieval|Two-tower retrieval]]
