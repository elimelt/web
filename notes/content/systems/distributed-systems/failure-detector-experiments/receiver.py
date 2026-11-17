"""Heartbeat receiver: records, for every datagram, the sequence number, the
sender's System.nanoTime() and the receiver's CLOCK_MONOTONIC arrival time.
On Linux both read the same monotonic clock, so arrival - sent is the
transport-plus-scheduling delay of the datagram. Writes one CSV line per
heartbeat: seq,sent_ns,recv_ns."""
import socket, sys, time
port, out, seconds = int(sys.argv[1]), sys.argv[2], float(sys.argv[3])
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1 << 20)
s.bind(("127.0.0.1", port))
s.settimeout(1.0)
end = time.monotonic() + seconds
rows = []
while time.monotonic() < end:
    try:
        b = s.recv(64)
    except socket.timeout:
        continue
    t = time.monotonic_ns()
    rows.append((int.from_bytes(b[:8], "big"), int.from_bytes(b[8:16], "big"), t))
with open(out, "w") as f:
    f.write("seq,sent_ns,recv_ns\n")
    for r in rows:
        f.write("%d,%d,%d\n" % r)
print(len(rows), "heartbeats", file=sys.stderr)
