"""Endpoints for the transfer-time experiments.

    endpoint.py server --cc bbr       TCP file server plus UDP sink (receiver namespace)
    endpoint.py client --plan '{...}' runs a list of timed transfers (sender namespace)

The TCP server answers each 8-byte request (a big-endian byte count N) by
sending N bytes on the same connection, so one connection can carry several
transfers. Before replying it logs the connection's congestion window from
TCP_INFO. The UDP sink receives a numbered burst and reports when the last
datagram arrived. Both namespaces share CLOCK_MONOTONIC, so one-way times are
measured directly.
"""

import argparse
import json
import socket
import struct
import sys
import threading
import time

ADDR_SERVER = "10.10.0.2"
TCP_PORT, UDP_PORT = 5001, 5002
UDP_PAYLOAD = 1472  # 1500-byte MTU minus 20 (IPv4) and 8 (UDP)
CHUNK = bytes(1 << 20)


def tcp_info(sock):
    raw = sock.getsockopt(socket.IPPROTO_TCP, socket.TCP_INFO, 232)
    f = struct.unpack_from("8B24I", raw)
    u = f[8:]
    # u[0]=rto u[2]=snd_mss u[15]=rtt u[17]=snd_ssthresh u[18]=snd_cwnd
    return {"rto_us": u[0], "mss": u[2], "rtt_us": u[15], "ssthresh": u[17], "cwnd": u[18]}


def recv_exact(conn, n):
    buf = bytearray()
    while len(buf) < n:
        b = conn.recv(n - len(buf))
        if not b:
            raise ConnectionError("closed")
        buf += b
    return bytes(buf)


def serve_conn(conn, cc, log):
    conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_CONGESTION, cc.encode())
    try:
        while True:
            (n,) = struct.unpack("!Q", recv_exact(conn, 8))
            log.write(json.dumps({"n": n, "t_ns": time.monotonic_ns(), **tcp_info(conn)}) + "\n")
            log.flush()
            left = n
            while left:
                k = min(left, len(CHUNK))
                conn.sendall(memoryview(CHUNK)[:k])
                left -= k
    except (ConnectionError, OSError):
        pass
    finally:
        conn.close()


def udp_sink():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 64 << 20)
    s.bind((ADDR_SERVER, UDP_PORT))
    want, got, first, last, peer = None, 0, 0, 0, None
    while True:
        data, peer = s.recvfrom(2048)
        t = time.monotonic_ns()
        seq, total = struct.unpack_from("!II", data)
        if seq == 0 or want is None:
            want, got, first = total, 0, t
        got += 1
        last = t
        if seq == total - 1:
            s.sendto(json.dumps({"received": got, "expected": want, "first_ns": first,
                                 "last_ns": last}).encode(), peer)
            want = None


def server(args):
    threading.Thread(target=udp_sink, daemon=True).start()
    ls = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    ls.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    ls.setsockopt(socket.IPPROTO_TCP, socket.TCP_CONGESTION, args.cc.encode())
    ls.bind((ADDR_SERVER, TCP_PORT))
    ls.listen(16)
    log = open(args.log, "a")
    print(json.dumps({"ready": True}), flush=True)
    while True:
        conn, _ = ls.accept()
        threading.Thread(target=serve_conn, args=(conn, args.cc, log), daemon=True).start()


def fetch(sock, n):
    sock.sendall(struct.pack("!Q", n))
    left = n
    buf = bytearray(1 << 20)
    while left:
        k = sock.recv_into(buf, min(left, len(buf)))
        if not k:
            raise ConnectionError("closed early")
        left -= k


def connect():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    s.connect((ADDR_SERVER, TCP_PORT))
    return s


def trial(mode, n, primer, idle_s):
    """One timed transfer of n bytes. Returns seconds."""
    if mode == "fresh":  # new connection: handshake + request + slow start
        t0 = time.monotonic_ns()
        s = connect()
        fetch(s, n)
        t1 = time.monotonic_ns()
        s.close()
        return (t1 - t0) / 1e9
    s = connect()
    fetch(s, primer)  # open the congestion window
    if mode == "idle":
        time.sleep(idle_s)
    t0 = time.monotonic_ns()
    fetch(s, n)
    t1 = time.monotonic_ns()
    s.close()
    return (t1 - t0) / 1e9


def udp_burst(n):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 64 << 20)
    s.settimeout(10)
    total = max(1, -(-n // UDP_PAYLOAD))
    payload = bytes(UDP_PAYLOAD)
    dest = (ADDR_SERVER, UDP_PORT)
    t0 = time.monotonic_ns()
    for seq in range(total):
        size = UDP_PAYLOAD if seq < total - 1 else n - UDP_PAYLOAD * (total - 1)
        size = max(size, 8)
        pkt = bytearray(payload[:size])
        struct.pack_into("!II", pkt, 0, seq, total)
        while True:
            try:
                s.sendto(pkt, dest)
                break
            except BlockingIOError:
                time.sleep(0.0001)
    t_sent = time.monotonic_ns()
    rep = json.loads(s.recvfrom(4096)[0])
    s.close()
    return {"t_s": (rep["last_ns"] - t0) / 1e9, "send_loop_s": (t_sent - t0) / 1e9,
            "received": rep["received"], "expected": rep["expected"]}


def client(args):
    plan = json.loads(args.plan)
    out = []
    for item in plan["trials"]:
        if item["mode"] == "udp":
            r = udp_burst(item["n"])
            r.update(item)
            out.append(r)
        else:
            t = trial(item["mode"], item["n"], plan.get("primer", 0), plan.get("idle_s", 1.0))
            out.append({**item, "t_s": t})
        time.sleep(plan.get("gap_s", 0.2))
    json.dump(out, sys.stdout)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("role", choices=["server", "client"])
    p.add_argument("--cc", default="bbr")
    p.add_argument("--log", default="/dev/null")
    p.add_argument("--plan", default="{}")
    args = p.parse_args()
    server(args) if args.role == "server" else client(args)


if __name__ == "__main__":
    main()
