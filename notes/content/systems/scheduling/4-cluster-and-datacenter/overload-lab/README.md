---
title: Overload Lab
category: Scheduling
tags:
  - admission control
  - overload
  - benchmarks
date: 2026-11-17
updated: 2026-11-17
authors:
  - elimelt
  - claude-opus-5-5
status: evergreen
description: A Go HTTP/2 server with six admission policies, an open-loop Poisson load generator, and the scripts that produced the measurements in the admission-control note.
sources:
  - title: Maurer (2015), Fail at Scale, ACM Queue
    url: https://queue.acm.org/detail.cfm?id=2839461
    type: paper
  - title: Netflix concurrency-limits
    url: https://github.com/Netflix/concurrency-limits
    type: code
---

The experiment behind
[[systems/scheduling/4-cluster-and-datacenter/admission-control-backpressure-overload|Admission Control, Backpressure, and Overload Management]]:
a small Go HTTP/2 server under open-loop load, with six admission policies.

- `server/main.go`: the server. `/work?n=N` performs N rounds of SHA-256
  (about 90 ns each on the test machine) after the policy admits it, yielding
  the processor every 1000 rounds. The handler does not check whether the
  client is still waiting. Policies: `none`, `fixed` (16 in progress),
  `queue` (4 in progress, FIFO queue of 1000), `codel` (4 in progress, FIFO
  queue with the controlled-delay rule of Maurer's "Fail at Scale", 5 ms /
  100 ms), `gradient` (Netflix Gradient2) and `gradient-v1` (the minimum-RTT
  gradient of Netflix's 2018 post). The Gradient2 port uses a minimum limit of
  2 and an initial limit of 16, where the library defaults to 20 for both, and
  updates once per window of at least 50 ms and 10 samples.
- `loadgen/main.go`: Poisson arrivals, exponentially distributed work (mean
  11,000 rounds, about 1 ms), a 100 ms deadline per attempt, 16 HTTP/2
  connections. Optional load spike and immediate retries.
- `run.py`: runs each (policy, rate, seed) against a fresh server and appends
  a line to `results.jsonl` (or `--out`).
- `summarize.py`: prints the tables used in the note and, with `--write`,
  regenerates the figure's data module
  `notes/quartz-site/plugins/mdx/src/components/overload-lab/measured.ts`.

## Running

The server is pinned to CPUs 0-1 with `GOMAXPROCS=2`, the load generator to
CPUs 2-3, so the machine needs 4 CPUs and `taskset`.

```sh
cd notes/content/systems/scheduling/4-cluster-and-datacenter/overload-lab
go build -o bin/server ./server && go build -o bin/loadgen ./loadgen
python3 run.py --rates 500,1000,1400,1700,2000,2400,3000,4000 \
    --policies none,fixed,queue,codel,gradient,gradient-v1 --seeds 1,2,3
python3 run.py --rates 1400 --policies none,fixed,codel,gradient --seeds 1,2,3 \
    --retries 2 --spike 4,2,3500 --duration 16 --warmup 0 --out spike.jsonl
python3 run.py --rates 1400 --policies none --seeds 1,2,3 \
    --spike 4,2,3500 --duration 16 --warmup 0 --out spike-noretry.jsonl
python3 summarize.py --write
```

Each run offers load for 12 s and summarizes seconds 2 to 12 (the spike runs:
16 s, all of it). The sweep took about 100 minutes on the machine below. `bin/` is not committed.

## Environment of the recorded results

4-vCPU cloud VM (Intel Xeon @ 2.10 GHz), Linux 6.18, Go 1.24.7, Python 3.
Other tenants share the host, so the three seeds also absorb run-to-run noise.
