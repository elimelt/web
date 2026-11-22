#!/bin/bash
# Reproduces every number in the stream-sampling note. Run it in a directory
# that holds the 24 hourly pageview files of 4 March 2026
# (pageviews-20260304-HH0000.gz) and stream.bin from ../sketch-experiments/run.sh
# (the same records in the same order, with a 64-bit key hash per record).
set -e
here=$(cd "$(dirname "$0")" && pwd)
cc -O2 -o pvrec "$here/pvrec.c"
cc -O2 -march=native -o samp "$here/samp.c" -lm
cc -O2 -o figsample "$here/figsample.c"
./pvrec pageviews-20260304-*.gz > pvrec.log            # recs.bin, projects.tsv
# Uniformity of Algorithm L: inclusion counts of 1,000 positions, K = 10, 10^6 runs.
./samp uniform 1000 10 1000000 > uni.txt
# Subset sums: en.m, en, de, fi, gl, pt.n, an; hours 0 and 12; 1/100 and
# 1/10,000 of pages by key hash; everything. 100 trials at each K.
export SUBSETS="p:427,p:424,p:366,p:510,p:590,p:1355,p:45,h:0,h:12,m:100,m:10000,all"
for K in 1000 10000 100000; do ./samp subsets $K 100 $K > subsets_$K.txt & done
wait
python3 -I "$here/analyze8.py" subsets_1000.txt subsets_10000.txt subsets_100000.txt
# Time per record and random draws of Algorithm R and Algorithm L, one core.
for K in 100 10000 1000000; do taskset -c 3 ./samp speed $K; done > speed.txt
# The figure's substream and data, and the reference the figure's tests use.
./figsample > figsample.txt
python3 -I "$here/make_fig.py" figsample.txt projects.tsv "$here"
python3 -I "$here/figure_ref.py" "$here" 100 p:en
