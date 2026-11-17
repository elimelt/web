"""UDHR re-evaluation with each line stripped of the files' indentation, plus
the pre-tokenizer ceiling: UTF-8 bytes per pre-tokenized piece, an upper
bound on bytes per token for any vocabulary under that rule."""
import json, os, regex, statistics as st
from tokenizers import Tokenizer
import tiktoken
from tiktoken.load import load_tiktoken_bpe
from tiktoken_ext import openai_public as op
op.load_tiktoken_bpe = lambda url, expected_hash=None: load_tiktoken_bpe(os.environ.get('TIKTOKEN_DIR', '.') + '/' + url.rsplit('/',1)[1])
UDHR = ['eng','deu','fra','spa','fin','tur','vie','swh','yor','zul','rus','ukr','ell_monotonic','heb','arb','hin','ben','tam','tha','amh','kor','jpn','cmn_hans']
texts = {c: '\n'.join(l.strip() for l in open(os.environ.get('TOKDATA', '/tmp/tokdata') + f'/udhr2/{c}.txt', encoding='utf-8') if l.strip()) for c in UDHR}
lines = {c: t.split('\n') for c, t in texts.items()}
out = {'chars': {c: len(t) for c, t in texts.items()}, 'bytes': {c: len(t.encode()) for c, t in texts.items()},
       'lines_bytes': {c: sum(len(l.encode()) for l in ls) for c, ls in lines.items()}, 'open': {}, 'bpe': {}, 'pieces': {}}
specs = {n: getattr(op, n)() for n in ['r50k_base', 'cl100k_base', 'o200k_base']}
for n, spec in specs.items():
    enc = tiktoken.Encoding(name=n, pat_str=spec['pat_str'], special_tokens=spec['special_tokens'], mergeable_ranks=spec['mergeable_ranks'])
    pat = regex.compile(spec['pat_str'])
    out['open'][n] = {c: sum(len(enc.encode_ordinary(l)) for l in ls) for c, ls in lines.items()}
    out['pieces'][n] = {c: sum(len(pat.findall(l)) for l in ls) for c, ls in lines.items()}
for mix in ['english', 'english+code', 'europarl-11']:
    for seed in [1, 2, 3]:
        tok = Tokenizer.from_file(f'out/{mix}-s{seed}.json')
        out['bpe'][f'{mix}/{seed}'] = {c: sum(len(e.ids) for e in tok.encode_batch(ls)) for c, ls in lines.items()}
json.dump(out, open('out/udhr.json', 'w'), indent=0)
print(f"{'lang':14s} {'chars':>6s} {'B/ch':>5s} | bytes/token r50k cl100k o200k | en64k eu64k | bytes/piece r50k cl100k o200k")
for c in UDHR:
    b = out['lines_bytes'][c]
    o = [b / out['open'][n][c] for n in specs]
    bp = lambda mix: st.mean(b / out['bpe'][f'{mix}/{s}'][c] for s in [1,2,3])
    pc = [b / out['pieces'][n][c] for n in specs]
    print(f"{c:14s} {out['chars'][c]:6d} {out['bytes'][c]/out['chars'][c]:5.2f} | " + ' '.join(f'{x:5.2f}' for x in o) + f" | {bp('english'):5.2f} {bp('europarl-11'):5.2f} | " + ' '.join(f'{x:5.2f}' for x in pc))
