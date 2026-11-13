"""Measure what two-phase commit costs on one machine with real processes,
real TCP sockets and real fdatasync calls.

One coordinator process runs transactions one at a time against N participant
processes. Every process keeps its own log file; a "forced" write is a pwrite
followed by fdatasync, an unforced write is a pwrite alone. Log files are
preallocated so fdatasync never has to update file metadata.

Protocols (commit path only, every participant votes yes):

  2pc        coordinator: PREPARE -> wait for N YES -> force COMMIT -> commit
             point -> COMMIT -> wait for N ACK -> unforced END.
             participant: force PREPARED, vote; on COMMIT force COMMIT,
             release locks, ACK.  (Presumed abort is identical on this path.)
  pc         presumed commit: coordinator forces a COLLECTING record naming
             the participants before PREPARE; participants write COMMIT
             unforced and send no ACK.
  implicit   parallel-commits style: the coordinator forces a STAGING record
             (participant list) while the PREPAREs are in flight; the commit
             point is "STAGING durable and all N YES received". COMMIT
             messages then go out as in 2pc.
  2pc-nosync 2pc with every forced write made unforced, to isolate the
             network and CPU cost.

Commit latency is the time from the start of a transaction to its commit
point, the moment the coordinator could tell the client it committed.
Lock hold is measured inside each participant, from receiving PREPARE to
releasing its locks after the decision.

Run:  python3 commit_bench.py [--txns 1000] [--reps 5] [--out results.json]
"""

from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import os
import platform
import random
import selectors
import socket
import statistics
import struct
import sys
import tempfile
import time

PREPARE, YES, COMMIT, ACK, STATS, QUIT = range(6)
MSG = struct.Struct("!BQ")  # type, transaction id
RECORD = 64  # bytes per log record
LOG_BYTES = 8 << 20


class Log:
    def __init__(self, path: str, sync: bool):
        self.fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_TRUNC, 0o600)
        os.posix_fallocate(self.fd, 0, LOG_BYTES)
        os.fsync(self.fd)
        self.off = 0
        self.sync = sync
        self.forced = 0

    def write(self, kind: bytes, txn: int, force: bool) -> None:
        rec = (kind + b" %d" % txn).ljust(RECORD, b".")
        os.pwrite(self.fd, rec, self.off)
        self.off = (self.off + RECORD) % LOG_BYTES
        if force and self.sync:
            os.fdatasync(self.fd)
            self.forced += 1

    def close(self) -> None:
        os.close(self.fd)


def recv_exact(sock: socket.socket, n: int) -> bytes:
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("peer closed")
        buf += chunk
    return buf


def participant(port_q, logdir: str, protocol: str, sync: bool) -> None:
    srv = socket.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen(1)
    port_q.put(srv.getsockname()[1])
    conn, _ = srv.accept()
    conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    log = Log(os.path.join(logdir, f"p{os.getpid()}.log"), sync)
    holds: list[int] = []
    prepared_at: dict[int, int] = {}
    while True:
        kind, txn = MSG.unpack(recv_exact(conn, MSG.size))
        if kind == PREPARE:
            prepared_at[txn] = time.perf_counter_ns()  # locks taken here
            log.write(b"PREPARED", txn, force=True)
            conn.sendall(MSG.pack(YES, txn))
        elif kind == COMMIT:
            log.write(b"COMMIT", txn, force=(protocol != "pc"))
            holds.append(time.perf_counter_ns() - prepared_at.pop(txn))  # locks released
            if protocol != "pc":
                conn.sendall(MSG.pack(ACK, txn))
        elif kind == STATS:
            blob = json.dumps({"holds": holds, "forced": log.forced}).encode()
            conn.sendall(struct.pack("!I", len(blob)) + blob)
            holds = []
            log.forced = 0
        elif kind == QUIT:
            break
    log.close()
    conn.close()


def run_config(protocol: str, n: int, txns: int, warmup: int, logdir: str) -> dict:
    sync = protocol != "2pc-nosync"
    wire = "2pc" if protocol == "2pc-nosync" else protocol
    ctx = mp.get_context("fork")
    port_q = ctx.Queue()
    procs = [ctx.Process(target=participant, args=(port_q, logdir, wire, sync), daemon=True) for _ in range(n)]
    for p in procs:
        p.start()
    socks = []
    for _ in range(n):
        s = socket.create_connection(("127.0.0.1", port_q.get(timeout=10)))
        s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        socks.append(s)
    sel = selectors.DefaultSelector()
    for s in socks:
        sel.register(s, selectors.EVENT_READ)
    log = Log(os.path.join(logdir, "coord.log"), sync)
    messages = 0

    def await_all(kind: int, txn: int) -> None:
        pending = set(range(n))
        while pending:
            for key, _ in sel.select():
                k, t = MSG.unpack(recv_exact(key.fileobj, MSG.size))
                assert k == kind and t == txn, (k, t, kind, txn)
                pending.discard(socks.index(key.fileobj))

    latencies, totals = [], []
    for txn in range(warmup + txns):
        if txn == warmup:
            log.forced = 0
            messages = 0
            for s in socks:  # reset participant counters after warmup
                s.sendall(MSG.pack(STATS, 0))
                size = struct.unpack("!I", recv_exact(s, 4))[0]
                recv_exact(s, size)
        t0 = time.perf_counter_ns()
        if wire == "pc":
            log.write(b"COLLECTING", txn, force=True)
        else:
            log.write(b"BEGIN", txn, force=False)
        for s in socks:
            s.sendall(MSG.pack(PREPARE, txn))
        messages += n
        if wire == "implicit":
            log.write(b"STAGING", txn, force=True)  # overlaps with the PREPAREs
        await_all(YES, txn)
        messages += n
        if wire != "implicit":
            log.write(b"COMMIT", txn, force=True)
        t_commit = time.perf_counter_ns()
        for s in socks:
            s.sendall(MSG.pack(COMMIT, txn))
        messages += n
        if wire != "pc":
            await_all(ACK, txn)
            messages += n
            log.write(b"END", txn, force=False)
        t_done = time.perf_counter_ns()
        if txn >= warmup:
            latencies.append(t_commit - t0)
            totals.append(t_done - t0)

    holds, forced = [], log.forced
    for s in socks:
        s.sendall(MSG.pack(STATS, 0))
        size = struct.unpack("!I", recv_exact(s, 4))[0]
        blob = json.loads(recv_exact(s, size))
        holds += blob["holds"]
        forced += blob["forced"]
    for s in socks:
        s.sendall(MSG.pack(QUIT, 0))
        s.close()
    for p in procs:
        p.join(timeout=10)
    log.close()
    for f in os.listdir(logdir):
        os.remove(os.path.join(logdir, f))
    return {
        "protocol": protocol,
        "n": n,
        "latency_us": [x / 1000 for x in latencies],
        "total_us": [x / 1000 for x in totals],
        "hold_us": [x / 1000 for x in holds],
        "messages_per_txn": messages / txns,
        "forced_per_txn": forced / txns,
    }


def fsync_baseline(logdir: str, count: int) -> list[float]:
    log = Log(os.path.join(logdir, "baseline.log"), True)
    out = []
    for i in range(count):
        t = time.perf_counter_ns()
        log.write(b"X", i, force=True)
        out.append((time.perf_counter_ns() - t) / 1000)
    log.close()
    os.remove(os.path.join(logdir, "baseline.log"))
    return out


def q(xs: list[float], p: float) -> float:
    s = sorted(xs)
    return s[min(len(s) - 1, int(p * len(s)))]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--txns", type=int, default=1000)
    ap.add_argument("--warmup", type=int, default=100)
    ap.add_argument("--reps", type=int, default=5)
    ap.add_argument("--ns", default="1,2,4,8,16")
    ap.add_argument("--protocols", default="2pc,pc,implicit,2pc-nosync")
    ap.add_argument("--logdir", default=None, help="directory on the disk to test (default: a temp dir in cwd)")
    ap.add_argument("--out", default="results.json")
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()

    logdir = args.logdir or tempfile.mkdtemp(prefix="2pc-logs-", dir=os.getcwd())
    ns = [int(x) for x in args.ns.split(",")]
    protocols = args.protocols.split(",")
    rng = random.Random(args.seed)
    started = time.time()
    reps = []
    for rep in range(args.reps):
        configs = [(p, n) for p in protocols for n in ns]
        rng.shuffle(configs)  # so drift in the machine doesn't line up with one config
        baseline = fsync_baseline(logdir, 2000)
        runs = []
        for p, n in configs:
            r = run_config(p, n, args.txns, args.warmup, logdir)
            runs.append(r)
            print(f"rep {rep} {p:10s} n={n:2d} p50 {q(r['latency_us'], .5):7.1f} us  p99 {q(r['latency_us'], .99):7.1f} us"
                  f"  msgs {r['messages_per_txn']:.0f} forced {r['forced_per_txn']:.0f}", flush=True)
        reps.append({"fsync_us": baseline, "runs": runs})
    os.rmdir(logdir)
    env = {
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "cpus": os.cpu_count(),
        "txns": args.txns,
        "warmup": args.warmup,
        "reps": args.reps,
        "seconds": round(time.time() - started, 1),
    }
    with open(args.out, "w") as f:
        json.dump({"env": env, "reps": reps}, f)
    print(json.dumps(env))


if __name__ == "__main__":
    main()
