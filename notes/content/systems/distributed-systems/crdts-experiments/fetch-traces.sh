#!/bin/sh
# Downloads the ASCII-only sequential editing traces from josephg/editing-traces
# into traces/ (not committed). Then: node replay.mjs traces/<name>.json.gz 5
set -e
mkdir -p traces
for t in sveltecomponent rustcode seph-blog1 automerge-paper; do
  curl -sSfL -o "traces/$t.json.gz" \
    "https://raw.githubusercontent.com/josephg/editing-traces/master/sequential_traces/ascii_only/$t.json.gz"
done
