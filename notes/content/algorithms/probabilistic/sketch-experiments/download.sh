#!/bin/bash
D=20260304
for h in $(seq -w 0 23); do f=pageviews-$D-${h}0000.gz; [ -s $f ] || curl -sS --retry 4 -o $f "https://clickhouse-public-datasets.s3.amazonaws.com/wikistat/original/$f"; done
echo done
