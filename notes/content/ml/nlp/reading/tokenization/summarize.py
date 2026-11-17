"""Prints the tables in the tokenization note from out/results.json and out/udhr.json."""
import json, statistics as st
R = json.load(open('out/results.json')); U = json.load(open('out/udhr.json')); EB = R['meta']['eval_bytes']
MIX = ['english', 'english+code', 'europarl-11']
def bpe(mix, V, ev):
    return [EB[ev] / r['tokens'] for r in R['bpe'] if r['mix'] == mix and r['vocab'] == V and r['eval'] == ev]
def fmt(xs): return f"{st.mean(xs):.2f} ± {st.stdev(xs):.2f}"
print('## Table 1: bytes per token on held-out text, mean ± sd over 3 subsamples')
for ev in ['english (Gutenberg)', 'python (stdlib)', 'europarl finnish', 'europarl greek']:
    print('###', ev)
    print('| training mix | 1,024 | 4,096 | 16,384 | 32,768 | 65,536 (or all merges) |')
    for mix in MIX:
        print(f'| {mix} | ' + ' | '.join(fmt(bpe(mix, V, ev)) for V in [1024, 4096, 16384, 32768, 65536]) + ' |')
print('## Table 2: open tokenizers, bytes per token')
for ev in ['english (Gutenberg)', 'python (stdlib)', 'europarl english', 'europarl finnish', 'europarl greek']:
    print(f'| {ev} | ' + ' | '.join(f"{EB[ev]/r['tokens']:.2f}" for r in R['open'] if r['eval'] == ev) + ' |')
