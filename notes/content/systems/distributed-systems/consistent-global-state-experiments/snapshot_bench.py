#!/usr/bin/env python3
"""Uncoordinated snapshots versus Chandy-Lamport snapshots on real TCP channels.

N operating-system processes each hold a bank balance and transfer random
amounts to random peers over one TCP connection per ordered pair of processes
(so every channel is FIFO and reliable, as Chandy and Lamport assume). A
coordinator process periodically takes two snapshots of the same execution:

- "uncoordinated": it asks every process, over a separate control connection,
  to record its balance now. Nothing is recorded for the channels.
- "chandy-lamport": it asks one process to start the marker algorithm. Each
  process records its balance when it first sees a marker (or the start
  request), sends a marker on every outgoing channel, and records every
  transfer that arrives on an incoming channel until that channel's marker.

Every process logs every event with its vector clock and a CLOCK_MONOTONIC
timestamp. All processes run on one host, so the monotonic clock is one clock
shared by all of them; it is used only for reporting latency and skew, never
by the protocols.

Usage:
    python3 snapshot_bench.py --procs 4 --rate 1000 --duration 3 \
        --snapshots 30 --seed 1 --out run.json
"""

from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import os
import queue
import random
import socket
import struct
import threading
import time

INITIAL = 1000
HDR = struct.Struct("!I")


def send_obj(sock: socket.socket, obj) -> None:
    data = json.dumps(obj, separators=(",", ":")).encode()
    sock.sendall(HDR.pack(len(data)) + data)


def recv_exact(sock: socket.socket, n: int) -> bytes | None:
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            return None
        buf += chunk
    return bytes(buf)


def recv_obj(sock: socket.socket):
    hdr = recv_exact(sock, HDR.size)
    if hdr is None:
        return None
    (n,) = HDR.unpack(hdr)
    body = recv_exact(sock, n)
    return None if body is None else json.loads(body)


def reader(sock: socket.socket, src: int, q: queue.Queue) -> None:
    """Feed one incoming channel into the process's single event queue."""
    while True:
        obj = recv_obj(sock)
        if obj is None:
            return
        q.put((src, obj))


def node(i: int, n: int, port0: int, rate: float, seed: int, out: str, ready) -> None:
    rng = random.Random(seed * 1000 + i)
    lsock = socket.socket()
    lsock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    lsock.bind(("127.0.0.1", port0 + i))
    lsock.listen(n + 1)
    ready.put(i)

    # Outgoing data channel i -> j for every j != i.
    outs: dict[int, socket.socket] = {}
    for j in range(n):
        if j == i:
            continue
        while True:
            try:
                s = socket.create_connection(("127.0.0.1", port0 + j))
                break
            except ConnectionRefusedError:
                time.sleep(0.01)
        s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        send_obj(s, {"hello": i})
        outs[j] = s

    # Incoming: n - 1 peers plus the coordinator (hello -1).
    q: queue.Queue = queue.Queue()
    ctrl = None
    for _ in range(n):
        s, _ = lsock.accept()
        s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        src = recv_obj(s)["hello"]
        if src == -1:
            ctrl = s
        threading.Thread(target=reader, args=(s, src, q), daemon=True).start()

    balance = INITIAL
    vc = [0] * n
    napp = 0  # application events (sends and receives) so far
    sent = 0
    log: list = []  # (kind, peer, msgid, amount, t_ns, napp, vc...)
    cl: dict[int, dict] = {}  # Chandy-Lamport state per snapshot id
    peers = [j for j in range(n) if j != i]

    def record(kind, peer=-1, mid=-1, amt=0):
        log.append([kind, peer, mid, amt, time.monotonic_ns(), napp, *vc])

    def cl_start(sid, via):
        st = {"balance": balance, "napp": napp, "vc": list(vc), "chan": {}, "open": set(peers)}
        cl[sid] = st
        record("cl_record", via, sid)
        for j in peers:
            st["chan"][j] = []
        if via >= 0:
            st["open"].discard(via)  # the marker's own channel is empty
            record("mk_recv", via, sid)
        for j in peers:
            send_obj(outs[j], {"mk": sid})
            record("mk_send", j, sid)
        if not st["open"]:
            record("cl_done", -1, sid)

    next_send = time.monotonic() + (rng.expovariate(rate) if rate > 0 else 0.0)
    running = True
    sending = True
    while running:
        timeout = max(0.0, next_send - time.monotonic()) if sending else 1.0
        try:
            src, msg = q.get(timeout=timeout) if timeout > 0 else q.get_nowait()
        except queue.Empty:
            if not sending:
                continue
            # Transfer to a random peer.
            j = rng.choice(peers)
            amt = rng.randint(1, min(50, balance)) if balance > 0 else 0
            if amt:
                balance -= amt
                vc[i] += 1
                napp += 1
                mid = i * 10**9 + sent
                sent += 1
                send_obj(outs[j], {"t": mid, "a": amt, "vc": vc})
                record("send", j, mid, amt)
            next_send = time.monotonic() + (rng.expovariate(rate) if rate > 0 else 0.0)
            continue
        if "t" in msg:
            balance += msg["a"]
            vc = [max(a, b) for a, b in zip(vc, msg["vc"])]
            vc[i] += 1
            napp += 1
            record("recv", src, msg["t"], msg["a"])
            for sid, st in cl.items():
                if src in st["open"]:
                    st["chan"][src].append([msg["t"], msg["a"]])
        elif "mk" in msg:
            sid = msg["mk"]
            if sid not in cl:
                cl_start(sid, src)
            else:
                st = cl[sid]
                st["open"].discard(src)
                record("mk_recv", src, sid)
                if not st["open"]:
                    record("cl_done", -1, sid)
        elif "naive" in msg:
            record("naive", -1, msg["naive"], balance)
        elif "cl" in msg:
            cl_start(msg["cl"], -1)
        elif "quiesce" in msg:
            sending = False
        elif "stop" in msg:
            running = False

    # The coordinator quiesces every process before stopping it, so no
    # transfer is in flight when the logs are written.
    snaps = {
        sid: {"balance": st["balance"], "napp": st["napp"], "vc": st["vc"], "chan": st["chan"]}
        for sid, st in cl.items()
    }
    with open(out, "w") as f:
        json.dump({"proc": i, "final_balance": balance, "log": log, "cl": snaps}, f)
    for s in outs.values():
        s.close()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--procs", type=int, default=4)
    ap.add_argument("--rate", type=float, default=1000.0, help="transfers/s per process; 0 = unthrottled")
    ap.add_argument("--duration", type=float, default=3.0)
    ap.add_argument("--snapshots", type=int, default=30)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--port", type=int, default=0)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    n = args.procs
    port0 = args.port or 20000 + (os.getpid() % 2000) * 10
    tmpdir = args.out + ".d"
    os.makedirs(tmpdir, exist_ok=True)
    ctx = mp.get_context("fork")
    ready = ctx.Queue()
    procs = [
        ctx.Process(target=node, args=(i, n, port0, args.rate, args.seed, f"{tmpdir}/{i}.json", ready))
        for i in range(n)
    ]
    for p in procs:
        p.start()
    for _ in range(n):
        ready.get()
    ctrl = []
    for i in range(n):
        while True:
            try:
                s = socket.create_connection(("127.0.0.1", port0 + i))
                break
            except ConnectionRefusedError:
                time.sleep(0.01)
        s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        send_obj(s, {"hello": -1})
        ctrl.append(s)

    rng = random.Random(args.seed)
    time.sleep(0.2)  # warm up
    gap = args.duration / args.snapshots
    issued = []
    for sid in range(args.snapshots):
        time.sleep(gap * rng.uniform(0.5, 1.5))
        order = list(range(n))
        rng.shuffle(order)
        t0 = time.monotonic_ns()
        for i in order:
            send_obj(ctrl[i], {"naive": sid})
        init = rng.randrange(n)
        send_obj(ctrl[init], {"cl": sid})
        issued.append({"sid": sid, "t_ns": t0, "initiator": init})
    time.sleep(0.3)
    for s in ctrl:
        send_obj(s, {"quiesce": 1})
    time.sleep(0.3)
    for s in ctrl:
        send_obj(s, {"stop": 1})
    for p in procs:
        p.join(30)

    nodes = []
    for i in range(n):
        with open(f"{tmpdir}/{i}.json") as f:
            nodes.append(json.load(f))
    with open(args.out, "w") as f:
        json.dump({"args": vars(args), "initial": INITIAL, "issued": issued, "nodes": nodes}, f)
    for i in range(n):
        os.remove(f"{tmpdir}/{i}.json")
    os.rmdir(tmpdir)


if __name__ == "__main__":
    main()
