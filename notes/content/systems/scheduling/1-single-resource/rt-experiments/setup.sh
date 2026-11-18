#!/bin/sh
# Isolate CPU 3 as its own root domain (cgroup v1 cpuset), move every movable
# task to CPUs 0-2, and disable RT throttling and SCHED_DEADLINE admission
# control (sched_rt_runtime_us = -1) so both policies may use the whole CPU.
set -e
cd /sys/fs/cgroup/cpuset
mkdir -p sys rt
echo 0-2 > sys/cpuset.cpus; echo 0 > sys/cpuset.mems; echo 1 > sys/cpuset.cpu_exclusive
echo 3 > rt/cpuset.cpus;    echo 0 > rt/cpuset.mems;  echo 1 > rt/cpuset.cpu_exclusive
echo 0 > cpuset.sched_load_balance
for p in $(cat tasks); do echo "$p" > sys/tasks 2>/dev/null || true; done
echo -1 > /proc/sys/kernel/sched_rt_runtime_us
