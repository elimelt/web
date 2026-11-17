#!/bin/sh
# Start (or stop) N redis-server processes on ports BASE..BASE+N-1, each
# holding one key "k" with a 100-byte value. Persistence is off.
# Usage: servers.sh start|stop [N] [BASE]
N=${2:-64}; BASE=${3:-7000}
case "$1" in
start)
  for i in $(seq 0 $((N - 1))); do
    p=$((BASE + i))
    redis-server --port $p --save "" --appendonly no --daemonize yes \
      --logfile /dev/null --pidfile /tmp/fanout-redis-$p.pid
  done
  sleep 1
  v=$(head -c 100 /dev/zero | tr '\0' x)
  for i in $(seq 0 $((N - 1))); do redis-cli -p $((BASE + i)) set k "$v" >/dev/null; done
  ;;
stop)
  for i in $(seq 0 $((N - 1))); do redis-cli -p $((BASE + i)) shutdown nosave >/dev/null 2>&1; done
  ;;
esac
