"""Independent replay of beam search over the numbers stored in beam-figure.json.

    python3 figure_replay.py   # writes beam-figure-expected.json, checks against the live model

Written separately from the figure's TypeScript (and from figure_data.py): a
hypothesis is a tuple of vocabulary ids, candidates are ranked by score with
ties broken by beam position and then by the position of the token in the
stored list (end-of-sentence first). The checks compare each width's finished
hypotheses with what the live model's search returned, and the expected file
holds every step's beam, pruned candidates and finished set for the figure's
test to match.
"""
import json, sys

d = json.load(open("beam-figure.json", encoding="utf-8"))
nodes = d["nodes"]
EOS = 0

def chain(i):
    out = []
    while nodes[i]["parent"] >= 0:
        out.append(nodes[i]["token"]); i = nodes[i]["parent"]
    return tuple(reversed(out))

table = {chain(i): n for i, n in enumerate(nodes)}

def options(prefix):
    n = table[prefix]
    return [(EOS, n["eos"])] + [(w, l) for w, l in n["next"]]

def replay(k):
    beam = [((), 0.0)]
    finished, steps = [], []
    for t in range(d["max_len"]):
        ranked = []
        for b, (h, s) in enumerate(beam):
            for pos, (w, l) in enumerate(options(h)):
                ranked.append(((-(s + l), b, pos), h, w, s + l))
        ranked.sort(key=lambda r: r[0])
        if t == d["max_len"] - 1:
            done = [(h, sc) for _, h, w, sc in ranked if w == EOS]
            finished += done
            steps.append({"kept": [], "pruned": [], "finished": [[list(h), sc] for h, sc in done]})
            break
        kept, pruned, done = [], [], []
        for rank, (_, h, w, sc) in enumerate(ranked[: 2 * k]):
            if w == EOS:
                (done if rank < k else pruned).append((h, w, sc))
            elif len(kept) < k:
                kept.append((h + (w,), sc))
            else:
                pruned.append((h, w, sc))
        finished += [(h, sc) for h, _, sc in done]
        steps.append({
            "kept": [[list(h), sc] for h, sc in kept],
            "pruned": [[list(h) + [w], sc] for h, w, sc in pruned],
            "finished": [[list(h), sc] for h, _, sc in done],
        })
        if len(finished) >= k:
            break
        beam = kept
    best_raw = max(range(len(finished)), key=lambda i: (finished[i][1], -i))
    best_norm = max(range(len(finished)), key=lambda i: (finished[i][1] / (len(finished[i][0]) + 1), -i))
    return {"steps": steps, "finished": [[list(h), sc] for h, sc in finished],
            "raw": best_raw, "norm": best_norm}

out = {}
for k in range(1, d["kmax"] + 1):
    r = replay(k)
    live = d["live"][str(k)]
    assert [h for h, _ in r["finished"]] == [h for h, _ in live], f"width {k}: replay differs from the live model"
    assert all(abs(a[1] - b[1]) < 2e-3 for a, b in zip(r["finished"], live)), k
    out[str(k)] = r
    text = lambda h: "".join(d["vocab"][w] for w in h).replace("▁", " ").strip()
    print(f"k={k}: {len(r['steps'])} steps, {len(r['finished'])} finished; "
          f"raw -> {text(r['finished'][r['raw']][0])!r}; norm -> {text(r['finished'][r['norm']][0])!r}", file=sys.stderr)
json.dump(out, open("beam-figure-expected.json", "w", encoding="utf-8"), separators=(",", ":"))
