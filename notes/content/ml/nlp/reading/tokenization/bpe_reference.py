"""Reference BPE trainer used to check the interactive figure.

Written independently of the figure's TypeScript: merges are applied with
the regex-lookaround replacement from Sennrich et al.'s reference code
(symbols joined by a separator that never occurs in text), and pair counts
are taken over every piece of the text in order instead of over distinct
pieces. Ties go to the pair that occurs first in the text.

    python3 bpe_reference.py presets.json fixture.json
"""
import json, sys
import regex  # third-party `regex`, for \p{L}

RULES = {
    # GPT-2 encoder.py
    "gpt2": regex.compile(r"""'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+"""),
    # tiktoken_ext/openai_public.py, o200k_base
    "o200k": regex.compile("|".join([
        r"""[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]*[\p{Ll}\p{Lm}\p{Lo}\p{M}]+(?i:'s|'t|'re|'ve|'m|'ll|'d)?""",
        r"""[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]+[\p{Ll}\p{Lm}\p{Lo}\p{M}]*(?i:'s|'t|'re|'ve|'m|'ll|'d)?""",
        r"""\p{N}{1,3}""", r""" ?[^\s\p{L}\p{N}]+[\r\n/]*""", r"""\s*[\r\n]+""", r"""\s+(?!\S)""", r"""\s+""",
    ])),
}
SEP = "\x01"

def base(piece, unit):
    if unit == "char":
        return list(piece)
    return [chr(b) for b in piece.encode("utf-8")]  # one code point per byte

def merge(word, left, right):
    # word is SEP-joined; merge only whole symbols, as in subword-nmt
    pat = regex.compile(r"(?<![^" + SEP + r"])" + regex.escape(left + SEP + right) + r"(?![^" + SEP + r"])")
    return pat.sub(lambda m: left + right, word)

def train(text, unit, rule, max_merges, min_count=2):
    words = [SEP.join(base(p, unit)) for p in RULES[rule].findall(text)]
    merges, tokens = [], [sum(len(w.split(SEP)) for w in words)]
    while len(merges) < max_merges:
        counts, first = {}, {}
        for wi, w in enumerate(words):
            s = w.split(SEP)
            for i in range(len(s) - 1):
                key = (s[i], s[i + 1])
                counts[key] = counts.get(key, 0) + 1
                first.setdefault(key, (wi, i))
        if not counts:
            break
        best = min(counts, key=lambda k: (-counts[k], first[k]))
        if counts[best] < min_count:
            break
        merges.append([best[0], best[1], counts[best]])
        words = [merge(w, *best) for w in words]
        tokens.append(sum(len(w.split(SEP)) for w in words))
    return merges, tokens

if __name__ == "__main__":
    presets = json.load(open(sys.argv[1]))
    out = {}
    for p in presets:
        for rule in RULES:
            for unit in ("char", "byte"):
                m, t = train(p["train"], unit, rule, 200)
                out[f"{p['id']}/{unit}/{rule}"] = {"merges": m, "tokens": t,
                    "pieces": [len(RULES[rule].findall(x)) for x in (p["train"], p["apply"])]}
                print(p["id"], unit, rule, len(m), t[0], t[-1], file=sys.stderr)
    json.dump(out, open(sys.argv[2], "w"), ensure_ascii=False)
