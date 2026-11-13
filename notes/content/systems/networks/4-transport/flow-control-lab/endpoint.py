"""One end of a TCP transfer for the flow-control experiments.

Run inside a network namespace by run_experiments.py. The receiver reads the
connection in one of three patterns; the sender writes as fast as the socket
takes data and samples TCP_INFO so the peer's advertised window (tcpi_snd_wnd)
can be compared with the throughput it allows.
"""

import argparse
import json
import socket
import struct
import sys
import time

TCP_INFO = getattr(socket, "TCP_INFO", 11)
# struct tcp_info from include/uapi/linux/tcp.h (Linux 6.18), native alignment.
# The byte "wscale" packs tcpi_snd_wscale in its low 4 bits and
# tcpi_rcv_wscale in its high 4 bits.
INFO_FMT = "@8B24I4Q6I4Q2I2Q3I2I"
INFO_FIELDS = (
    ["state", "ca_state", "retransmits", "probes", "backoff", "options", "wscale", "flags"]
    + "rto ato snd_mss rcv_mss unacked sacked lost retrans fackets last_data_sent last_ack_sent "
    "last_data_recv last_ack_recv pmtu rcv_ssthresh rtt rttvar snd_ssthresh snd_cwnd advmss "
    "reordering rcv_rtt rcv_space total_retrans".split()
    + "pacing_rate max_pacing_rate bytes_acked bytes_received".split()
    + "segs_out segs_in notsent_bytes min_rtt data_segs_in data_segs_out".split()
    + "delivery_rate busy_time rwnd_limited sndbuf_limited".split()
    + "delivered delivered_ce".split()
    + "bytes_sent bytes_retrans".split()
    + "dsack_dups reord_seen rcv_ooopack".split()
    + "snd_wnd rcv_wnd".split()
)


def tcp_info(sock):
    raw = sock.getsockopt(socket.IPPROTO_TCP, TCP_INFO, 256)
    size = struct.calcsize(INFO_FMT)
    return dict(zip(INFO_FIELDS, struct.unpack(INFO_FMT, raw[:size])))


def receiver(args):
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    if args.rcvbuf:
        # Must be set before listen() so the SYN-ACK carries a window scale
        # big enough for the buffer; accepted sockets inherit it.
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, args.rcvbuf)
    srv.bind(("0.0.0.0", args.port))
    srv.listen(1)
    print(json.dumps({"ready": True}), flush=True)
    conn, _ = srv.accept()
    effective = conn.getsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF)
    total = 0
    start = time.monotonic()
    log = []
    if args.mode == "drain":
        while True:
            data = conn.recv(1 << 20)
            if not data:
                break
            total += len(data)
    elif args.mode in ("stall", "trickle"):
        # Read nothing for --stall seconds, then either drain or trickle.
        time.sleep(args.stall)
        resume = time.monotonic()
        log.append({"t": resume - start, "event": "resume"})
        while True:
            if args.mode == "trickle":
                data = conn.recv(args.chunk)
                time.sleep(args.interval)
            else:
                data = conn.recv(1 << 20)
            if not data:
                break
            total += len(data)
            if args.mode == "trickle" and time.monotonic() - resume > args.trickle_for:
                break
    info = tcp_info(conn)
    conn.close()
    print(json.dumps({"bytes": total, "so_rcvbuf_effective": effective,
                      "rcv_wscale": info["wscale"] >> 4, "log": log}), flush=True)


def sender(args):
    sock = socket.create_connection((args.host, args.port))
    payload = b"\0" * (1 << 16)
    sock.setblocking(False)
    start = time.monotonic()
    samples = []
    next_sample = start
    while True:
        now = time.monotonic()
        if now - start >= args.duration:
            break
        if now >= next_sample:
            info = tcp_info(sock)
            samples.append({
                "t": now - start,
                "bytes_acked": info["bytes_acked"],
                "snd_wnd": info["snd_wnd"],
                "cwnd_bytes": info["snd_cwnd"] * info["snd_mss"],
                "unacked_bytes": info["unacked"] * info["snd_mss"],
                "rtt_us": info["rtt"],
                "min_rtt_us": info["min_rtt"],
                "rwnd_limited_us": info["rwnd_limited"],
                "busy_us": info["busy_time"],
                "retrans": info["total_retrans"],
                "probes": info["probes"],
                "backoff": info["backoff"],
            })
            next_sample += args.sample
        try:
            sock.send(payload)
        except (ConnectionResetError, BrokenPipeError):
            break
        except BlockingIOError:
            import select
            select.select([], [sock], [], max(0.0, min(0.005, next_sample - time.monotonic())))
    info = tcp_info(sock)
    sock.close()
    print(json.dumps({"samples": samples, "snd_mss": info["snd_mss"],
                      "snd_wscale": info["wscale"] & 0xF}), flush=True)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("role", choices=["send", "recv"])
    p.add_argument("--host", default="10.9.0.2")
    p.add_argument("--port", type=int, default=5001)
    p.add_argument("--rcvbuf", type=int, default=0, help="SO_RCVBUF request in bytes; 0 = autotuning")
    p.add_argument("--mode", default="drain", choices=["drain", "stall", "trickle"])
    p.add_argument("--stall", type=float, default=0.0)
    p.add_argument("--chunk", type=int, default=200)
    p.add_argument("--interval", type=float, default=0.02)
    p.add_argument("--trickle-for", type=float, default=5.0)
    p.add_argument("--duration", type=float, default=5.0)
    p.add_argument("--sample", type=float, default=0.05)
    args = p.parse_args()
    (sender if args.role == "send" else receiver)(args)


if __name__ == "__main__":
    sys.exit(main())
