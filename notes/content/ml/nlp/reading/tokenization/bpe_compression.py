"""BPE compression experiment. Trains byte-level BPE (HF tokenizers) on three
training mixes x 3 document subsamples, truncates merges to each vocab size,
and measures UTF-8 bytes per token on held-out text. Also measures the
r50k/cl100k/o200k tiktoken encodings."""
import json, os, random, glob, time, sys, hashlib
from tokenizers import Tokenizer, models, pre_tokenizers, trainers, decoders
import tiktoken
from tiktoken.load import load_tiktoken_bpe

D = os.environ.get('TOKDATA', '/tmp/tokdata')  # unzipped nltk_data corpora: gutenberg, europarl_raw, udhr2
OUT = os.environ.get('TOKOUT', 'out'); os.makedirs(OUT, exist_ok=True)
def rd(p):
    b = open(p, 'rb').read()
    try: return b.decode('utf-8')
    except UnicodeDecodeError: return b.decode('latin-1')  # 2 Gutenberg files are Latin-1

# ---- corpora ----
gut = sorted(glob.glob(f'{D}/gutenberg/*.txt'))
HELD = {'austen-persuasion.txt', 'carroll-alice.txt', 'chesterton-thursday.txt', 'whitman-leaves.txt'}
gut_tr = [rd(p) for p in gut if os.path.basename(p) not in HELD]
gut_te = [rd(p) for p in gut if os.path.basename(p) in HELD]

stdlib = sorted(p for p in glob.glob('/usr/lib/python3.13/**/*.py', recursive=True)
                if '/site-packages/' not in p and '/test' not in p and '/idlelib/' not in p)
def split(p):  # deterministic 80/20 split by path hash
    return int(hashlib.md5(p.encode()).hexdigest(), 16) % 5 != 0
code_tr = [rd(p) for p in stdlib if split(p)]
code_te = [rd(p) for p in stdlib if not split(p)]

LANGS = ['danish','dutch','english','finnish','french','german','greek','italian','portuguese','spanish','swedish']
ep_tr, ep_te = {}, {}
for L in LANGS:
    fs = sorted(glob.glob(f'{D}/europarl_raw/{L}/*'))
    ep_tr[L] = [rd(p) for p in fs[:8]]
    ep_te[L] = [rd(p) for p in fs[8:]]

UDHR = ['eng','deu','fra','spa','fin','tur','vie','swh','yor','zul','rus','ukr','ell_monotonic','heb','arb','hin','ben','tam','tha','amh','kor','jpn','cmn_hans']
udhr = {}
for c in UDHR:
    t = rd(f'{D}/udhr2/{c}.txt')
    udhr[c] = t

def nbytes(docs): return sum(len(d.encode()) for d in docs)

def cap(docs, budget, rng):
    docs = docs[:]; rng.shuffle(docs); out, n = [], 0
    for d in docs:
        if n >= budget: break
        b = d.encode()[: budget - n].decode('utf-8', 'ignore'); out.append(b); n += len(b.encode())
    return out

def mix(name, seed):
    rng = random.Random(seed)
    sub = lambda docs: [d for d in docs if rng.random() < 0.8] or docs
    if name == 'english':
        return cap(sub(gut_tr), 8_000_000, rng)
    if name == 'english+code':
        return cap(sub(gut_tr), 4_000_000, rng) + cap(sub(code_tr), 4_000_000, rng)
    if name == 'europarl-11':
        # Europarl documents are long; subsample by paragraph chunks
        out = []
        for L in LANGS:
            paras = [p for d in ep_tr[L] for p in d.split('\n') if p.strip()]
            out += cap(sub(paras), 8_000_000 // len(LANGS), rng)
        return out
    raise KeyError(name)

EVAL = {'english (Gutenberg)': gut_te, 'python (stdlib)': code_te}
for L in LANGS: EVAL[f'europarl {L}'] = ep_te[L]
for c, t in udhr.items(): EVAL[f'udhr {c}'] = [t]

VOCABS = [512, 1024, 2048, 4096, 8192, 16384, 32768, 65536]

def train(docs, V):
    tok = Tokenizer(models.BPE())
    tok.pre_tokenizer = pre_tokenizers.ByteLevel(add_prefix_space=False)
    tok.decoder = decoders.ByteLevel()
    tr = trainers.BpeTrainer(vocab_size=V, min_frequency=2, show_progress=False,
                             initial_alphabet=pre_tokenizers.ByteLevel.alphabet(), special_tokens=[])
    tok.train_from_iterator(docs, tr)
    return tok

def truncated(tok, V):
    m = json.loads(tok.to_str())
    merges = m['model']['merges'][: V - 256]
    alpha = pre_tokenizers.ByteLevel.alphabet()
    keep = set(alpha) | {(a + b) if isinstance(a, str) else None for a, b in (x if isinstance(x, list) else x.split(' ') for x in merges)}
    vocab = {t: i for t, i in m['model']['vocab'].items() if t in keep}
    m['model']['vocab'] = vocab; m['model']['merges'] = merges
    return Tokenizer.from_str(json.dumps(m))

def count(tok, docs):
    # encode in paragraph-sized pieces to keep memory flat; ByteLevel pretokenization is local
    n = 0
    for d in docs:
        pieces = d.split('\n')
        n += sum(len(e.ids) for e in tok.encode_batch(pieces)) 
    return n

# newlines are removed by the split; count their bytes out too so bytes/token is consistent
def eval_bytes(docs): return sum(len(p.encode()) for d in docs for p in d.split('\n'))

res = {'meta': {'tokenizers': __import__('tokenizers').__version__, 'tiktoken': tiktoken.__version__,
                'python': sys.version.split()[0], 'eval_bytes': {k: eval_bytes(v) for k, v in EVAL.items()},
                'udhr_chars': {c: len(t) for c, t in udhr.items()}, 'gut_held': sorted(HELD),
                'n_stdlib_files': [len(code_tr), len(code_te)]}, 'bpe': [], 'open': []}

# ---- open tokenizers (rank files rebuilt from js-tiktoken, sha256 checked = tiktoken expected_hash) ----
from tiktoken_ext import openai_public as op
op.load_tiktoken_bpe = lambda url, expected_hash=None: load_tiktoken_bpe(os.environ.get('TIKTOKEN_DIR', '.') + '/' + url.rsplit('/',1)[1])
for name in ['r50k_base', 'cl100k_base', 'o200k_base']:
    spec = getattr(op, name)()
    enc = tiktoken.Encoding(name=name, pat_str=spec['pat_str'], special_tokens=spec['special_tokens'],
                            mergeable_ranks=spec['mergeable_ranks'])
    for k, docs in EVAL.items():
        n = sum(len(enc.encode_ordinary(p)) for d in docs for p in d.split('\n'))
        res['open'].append({'tok': name, 'vocab': enc.n_vocab, 'eval': k, 'tokens': n})
    print(name, 'done', flush=True)

for mixname in ['english', 'english+code', 'europarl-11']:
    for seed in [1, 2, 3]:
        t0 = time.time(); docs = mix(mixname, seed)
        big = train(docs, VOCABS[-1]); tt = time.time() - t0
        big.save(f'{OUT}/{mixname}-s{seed}.json')
        for V in VOCABS:
            tok = big if V == VOCABS[-1] else truncated(big, V)
            for k, ed in EVAL.items():
                res['bpe'].append({'mix': mixname, 'seed': seed, 'vocab': V, 'eval': k, 'tokens': count(tok, ed)})
        print(mixname, seed, f'train {tt:.1f}s', f'{nbytes(docs)/1e6:.2f}MB', flush=True)
        json.dump(res, open(f'{OUT}/results.json', 'w'))
print('ALL DONE')
