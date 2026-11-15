#!/bin/sh
# Downloads the Twitter production cache trace sample (cluster 52, first 1M
# requests) that libCacheSim ships as test data, pinned to one commit, and
# checks its hash. The trace comes from Yang, Yue and Rashmi, "A large scale
# analysis of hundreds of in-memory cache clusters at Twitter" (OSDI 2020).
set -eu
here=$(dirname "$0")
data=$(cd "$here/../../../../" && pwd)/work/notebook-data/sharding
url=https://raw.githubusercontent.com/1a1a11a/libCacheSim/4e3521a9ee8e5519429a8f5568216b4e5dbef967/data/twitter_cluster52.csv
out="$data/twitter_cluster52.csv"
mkdir -p "$data"
[ -f "$out" ] || curl -fsSL -o "$out" "$url"
echo "$(cat "$here/trace.sha256")  $out" | sha256sum -c -
