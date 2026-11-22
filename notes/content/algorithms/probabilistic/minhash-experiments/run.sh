#!/bin/bash
# Reproduces every number in the MinHash and LSH note, in an empty working
# directory. Needs Python 3 with NumPy, PyArrow and lxml, and a C compiler.
set -e
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p rg txt full fig
cc -O2 -march=native -o join "$here/join.c" -lm
cc -O2 -march=native -o minhash "$here/minhash.c"
# Row groups 0 to 39 of the minicrawl file (ranks 1 to 156,448), reduced to
# visible text, about 1 GB of HTML read over HTTP range requests.
for i in $(seq 0 39); do
  python3 -I "$here/fetch_crawl.py" $i $((i + 1)) && python3 -I "$here/to_text.py" $i
done
# Word 5-shingle sets: full/sets.u64, full/offsets.i64, full/docs.tsv.
python3 -I "$here/shingle.py" full txt/tx_*.parquet
# Exact join at J >= 0.3, timed again at 0.5 and 0.8.
./join 0.3 full/sets.u64 full/offsets.i64 > full/pairs.tsv 2> full/join.log
for T in 0.3 0.5 0.8; do ./join $T full/sets.u64 full/offsets.i64 > /dev/null 2> full/join_$T.log; done
# 256 MinHash values per page with seed 1.
./minhash 256 1 full/sets.u64 full/offsets.i64 full/sig.u64 2> full/minhash.log
python3 -I "$here/analyze7.py" full     # full/analysis.json
python3 -I "$here/indep7.py" full       # full/indep.json
# The figure's pairs and the reference its tests use.
python3 -I "$here/make_fig7.py" full fig
cp fig/pairs.bin.gz "$here/"
python3 -I "$here/figure_ref.py" "$here" full/analysis.json
