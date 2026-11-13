# Collects pagesim's outputs into replacement_results.json (the note's tables)
# and traces/window_curves.json (what the page's simulator plots).
import glob, json, statistics as st, sys
out = sys.argv[1]
TRACES = {
    'sort200k': {'label': 'sort', 'command': 'sort sort200k.txt', 'input': 'first 200,000 bytes of the Lua 5.4 manual source and C files (6,428 lines of text)'},
    'gzip9': {'label': 'gzip -9', 'command': 'gzip -9 -c text4000.txt', 'input': 'first 4,000 lines (132,302 bytes) of the same text'},
    'bzip2': {'label': 'bzip2 -9', 'command': 'bzip2 -9 -c text4000.txt', 'input': 'first 4,000 lines (132,302 bytes) of the same text'},
    'cc1_lopcodes': {'label': 'gcc (cc1)', 'command': 'cc1 -quiet -O0 lopcodes.i -o /dev/null', 'input': "Lua 5.4's lopcodes.c, preprocessed (838 lines)"},
}
def read(fn):
    rows = {}
    for line in open(fn):
        if line.startswith('#'): continue
        _, f, faults = line.split(); rows[int(f)] = int(faults)
    return rows
wins = json.load(open('windows.json'))
res = {'traces': {}}
wc = {}
for t, info in TRACES.items():
    cap = json.load(open(f'{t}.json'))
    r = dict(info, **cap, distinct_pages=wins[t]['full_pages'], footprint_kib=wins[t]['full_pages'] * 4)
    r['grid'] = {p: read(f'curve_{t}_{p}.txt') for p in ['fifo', 'clock', 'lru', 'arc', 'opt']}
    rnd = [read(f) for f in sorted(glob.glob(f'rand_{t}_*.txt'))]
    r['random_5_seeds'] = {F: {'mean': st.mean(x[F] for x in rnd), 'min': min(x[F] for x in rnd), 'max': max(x[F] for x in rnd)} for F in rnd[0]}
    r['anomalies'] = {}
    for p in ['fifo', 'clock']:
        a = read(f'all_{t}_{p}.txt'); fs = sorted(a)
        r['anomalies'][p] = {'frames_checked': [fs[0], fs[-1]],
                             'cases': [[f, a[f], a[f + 1]] for f in fs[:-1] if a[f + 1] > a[f]]}
    res['traces'][t] = r
    w = wins[t]
    wc[t] = dict(label=info['label'], window_start=w['window_start'], full_refs=w['full_refs'], refs=w['window_refs'], pages=w['window_pages'],
                 curves={p: [read(f'win_{t}_{p}.txt')[f] for f in range(1, w['window_pages'] + 1)] for p in ['fifo', 'clock', 'lru', 'opt']})
json.dump(res, open(f'{out}/replacement_results.json', 'w'), indent=1)
json.dump(wc, open(f'{out}/traces/window_curves.json', 'w'), separators=(',', ':'))
for t, r in res['traces'].items():
    print(t, {p: len(v['cases']) for p, v in r['anomalies'].items()})
