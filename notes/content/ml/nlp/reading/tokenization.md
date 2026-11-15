---
title: Tokenization, Segmentation, and Edit Distance
aliases:
  - natural-language-processing/reading/tokenization
category: Natural Language Processing
tags:
  - tokenization
  - segmentation
  - edit distance
  - bpe
  - nltk
  - tr
  - regex
  - byte-pair encoding
date: 2025-02-12
updated: 2026-11-15
authors:
  - elimelt
  - claude-opus-5-5
status: draft
description: Ways to split text into tokens, from Unix one-liners and regex tokenizers to byte-pair encoding, plus sentence segmentation with NLTK and minimum edit distance.
sources:
  - title: Jurafsky & Martin, Speech and Language Processing (3rd ed. draft)
    url: https://web.stanford.edu/~jurafsky/slp3/
    type: textbook
  - title: NLTK Book, ch. 3
    url: https://www.nltk.org/book/ch03.html
    type: book
---

Tokenization is the segmentation of running text into tokens, the words, subwords and punctuation marks on which later processing operates. Methods range from Unix one-liners and regular-expression tokenizers to byte-pair encoding, which learns a subword vocabulary from a corpus. Sentence segmentation and minimum edit distance are treated alongside it, following [SLP3](https://web.stanford.edu/~jurafsky/slp3/), and the material consists mostly of code kept for reference.

Tokenization defines the terms consumed by [[ml/nlp/reading/information-retrieval|information retrieval]] systems and the model inputs used throughout [[ml/nlp/prompting|prompting]].

## Unix Tokenization

A single Unix pipeline implements a crude word tokenizer. `tr -sc 'A-Za-z' '\n'` squeezes every run of non-letters into a single newline, which puts one word per line. The remaining commands sort and count the words.

```bash
# output all words in a file, one per line
tr -sc 'A-Za-z' '\n' < input.txt

# count the words in a file
tr -sc 'A-Za-z' '\n' < input.txt | sort | uniq -c

# count the words in a file, case-insensitive
tr -sc 'A-Za-z' '\n' < input.txt | tr A-Z a-z | sort | uniq -c

# most frequent words
tr -sc 'A-Za-z' '\n' < input.txt | tr A-Z a-z | sort | uniq -c | sort -n -r
```

## Top-Down Regex Tokenization

A top-down tokenizer states the token grammar explicitly as alternations in a verbose regular expression, which NLTK applies to the text. The following pattern (adapted from the [NLTK book, ch. 3](https://www.nltk.org/book/ch03.html)) handles abbreviations, hyphenated words, currency, percentages, and ellipses.

```python
import nltk

pattern = r'''(?x)     # set flag to allow verbose regexps
  (?:[A-Z]\.)+         # abbreviations, e.g. U.S.A.
| \w+(?:-\w+)*         # words with optional internal hyphens
| \$?\d+(?:\.\d+)?%?   # currency and percentages, e.g. $12.40, 82%
| \.\.\.               # ellipsis
| [.,;"'?():-_`]       # these are separate tokens
'''

text = "This is a sentence.  This is another sentence."
nltk.regexp_tokenize(text, pattern)
```

## Bottom-Up Tokenization with Byte-Pair Encoding (BPE)

BPE learns a vocabulary from a corpus by starting from single characters and repeatedly merging the most frequent adjacent pair. The learned merge list is the tokenizer, and tokenizing new text means replaying the merges in order.

```python
def get_freq(vocab: Dict[str, int]) -> Dict[Tuple[str, str], int]:
    pairs = defaultdict(int)
    for word, freq in vocab.items():
        symbols = word.split()
        for i in range(len(symbols)-1):
            pairs[symbols[i], symbols[i+1]] += freq
    return pairs
```

```python
def merge_vocab(pair: Tuple[str, str], vocab: Dict[str, int]) -> Dict[str, int]:
    bigram = ' '.join(pair)
    replacement = ''.join(pair)
    new_vocab = {}

    for word, freq in vocab.items():
        new_word = word.replace(bigram, replacement)
        new_vocab[new_word] = freq

    return new_vocab
```

```python
def bpe(C: List[str], k: int) -> List[Tuple[str, str]]:
    vocab = defaultdict(int)
    for word in C:
        spaced = ' '.join(word)
        vocab[spaced] += 1

    merges = []

    for i in range(k):
        pairs = get_freq(vocab)
        if not pairs:
            break

        best_pair = max(pairs.items(), key=lambda x: x[1])[0]
        merges.append(best_pair)
        vocab = merge_vocab(best_pair, vocab)

    return merges
```

I have trained BPE once, on ~100MB of text with 10,000 merges, and in that experiment it produced useful segmentations only with a large corpus and a large number of merges.

```python
corpus = ["low", "lowest", "newer", "wider", "new", "width"]
num_merges = 10

merge_operations = bpe(corpus, num_merges)

print("Merge operations performed:")
for i, pair in enumerate(merge_operations, 1):
    print(f"{i}. Merged '{pair[0]}' with '{pair[1]}'")
```

> [!example] Tracing the first merges on this corpus
> Each word is initially a sequence of single characters. Each round counts adjacent pairs across the whole corpus and merges the most frequent one. Ties are broken in favor of the pair counted first, since `max` keeps the first maximum in insertion order.
>
> | Round | Best pair | Count | New symbol | Affected words |
> | --- | --- | --- | --- | --- |
> | 1 | `l` + `o` | 2 | `lo` | `lo w`, `lo w e s t` |
> | 2 | `lo` + `w` | 2 | `low` | `low`, `low e s t` |
> | 3 | `n` + `e` | 2 | `ne` | `ne w e r`, `ne w` |
> | 4 | `ne` + `w` | 2 | `new` | `new e r`, `new` |
> | 5 | `e` + `r` | 2 | `er` | `new er`, `w i d er` |
> | 6 | `w` + `i` | 2 | `wi` | `wi d er`, `wi d t h` |
>
> After six merges, `low` and `new` are single tokens, and `newer` and `wider` share the suffix token `er`. Merges learned from frequent words in this way also apply to the segmentation of rarer words.

## Segmentation and Tokenization

NLTK's built-in functions segment text into sentences, after which the words within each sentence are tokenized and POS-tagged.

```python
import nltk

sent_text = nltk.sent_tokenize(text)

for sentence in sent_text:
    tokenized_text = nltk.word_tokenize(sentence)
    tagged = nltk.pos_tag(tokenized_text)
    print(tagged)
```

## Edit Distance

Minimum edit distance is computed by dynamic programming. `dp[i][j]` is the edit distance between the first $i$ characters of `w1` and the first $j$ characters of `w2`, built up from insertions, deletions, and substitutions. This version assigns cost 1 to every operation; SLP3 also presents a variant where substitution costs 2.

```python
def min_edit_distance(w1, w2):
    n, m = len(w1), len(w2)
    dp = [[0] * (m + 1) for _ in range(n + 1)]

    for i in range(n + 1):
        dp[i][0] = i

    for j in range(m + 1):
        dp[0][j] = j

    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if w1[i - 1] == w2[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
            else:
                dp[i][j] = 1 + min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])

    return dp[n][m]
```

## Sources

- [Jurafsky & Martin, Speech and Language Processing (3rd ed. draft)](https://web.stanford.edu/~jurafsky/slp3/)
- [NLTK Book, ch. 3](https://www.nltk.org/book/ch03.html)
