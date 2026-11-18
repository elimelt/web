// Transfer-time model for the network performance note (systems/networks/0-foundation/3-performance).
//
// A packet-level simulation of one TCP response over a single bottleneck link:
// the sender emits MSS-sized segments onto a wire of rate R, each segment
// arrives one propagation delay d = RTT/2 later, and its ACK returns after
// another d. The congestion window starts at w0 segments and grows by one
// segment per ACK (slow start, no loss, no receive-window limit, one ACK per
// segment). The sender starts when the request reaches it: 1.5 RTT after
// connect() on a new connection (SYN, SYN-ACK, then ACK with the request) and
// 0.5 RTT after the request on an open one. The quantity of interest is when
// the last byte reaches the client.
//
// This is a model, not the Linux stack: it ignores delayed ACKs, pacing,
// BBR's and CUBIC's own growth rules, and loss. The measured points drawn
// beside it come from the real stack (performance-lab/results.json).

import dataJson from "../../../../../../content/systems/networks/0-foundation/performance-lab/transfer-times.json";

export const MSS = 1448; // payload bytes per segment with TCP timestamps, 1500-byte MTU
export const HEADER = 52; // IPv4 20 + TCP 20 + timestamp option 12
export const UDP_PAYLOAD = 1472;
export const IW = 10; // RFC 6928 initial window, Linux TCP_INIT_CWND

export interface Path {
  rateMbit: number;
  rttMs: number;
}

/** Seconds to serialize `bytes` at `rateMbit`. */
export const wireS = (bytes: number, rateMbit: number) => (bytes * 8) / (rateMbit * 1e6);

/** Bytes on the wire for n payload bytes sent as TCP segments. */
export const tcpWireBytes = (n: number) => n + HEADER * Math.max(1, Math.ceil(n / MSS));

/** Bytes on the wire for n payload bytes sent as a burst of UDP datagrams. */
export const udpWireBytes = (n: number) => n + 28 * Math.max(1, Math.ceil(n / UDP_PAYLOAD));

/** Bandwidth-delay product in bytes, using the round-trip time. */
export const bdpBytes = (p: Path) => (p.rateMbit * 1e6 * p.rttMs * 1e-3) / 8;

/** The path's floor for a one-way burst: d + L_wire / R, in ms. */
export const floorMs = (p: Path, n: number) => p.rttMs / 2 + wireS(udpWireBytes(n), p.rateMbit) * 1e3;

export type Start = "fresh" | "open";

/**
 * Arrival time (ms, from connect() for "fresh", from the request for "open")
 * of the last byte of every response size n = (k+1)·MSS for k < segments.
 * Returned array a has a[k] = arrival of segment k for a response of at least
 * k+1 segments; the sender's behavior for earlier segments does not depend on
 * how many follow, so one simulation serves every size.
 */
export function segmentArrivals(p: Path, w0: number, start: Start, segments: number): Float64Array {
  const d = p.rttMs / 2 / 1e3;
  const tx = wireS(MSS + HEADER, p.rateMbit);
  const t0 = (start === "fresh" ? 3 : 1) * d;
  const arrive = new Float64Array(segments);
  let cwnd = w0;
  let next = 0; // next segment to send
  let acked = 0; // segments whose ACK has returned
  let wireFree = t0;
  let now = t0;
  while (next < segments) {
    while (next < segments && next - acked < cwnd) {
      const depart = Math.max(wireFree, now) + tx; // last bit leaves the sender
      wireFree = depart;
      arrive[next] = depart + d;
      next++;
    }
    if (next >= segments) break;
    // Advance to the next ACK: segment `acked` arrives, its ACK takes d to return.
    now = arrive[acked] + d;
    acked++;
    cwnd += 1;
  }
  for (let i = 0; i < segments; i++) arrive[i] *= 1e3;
  return arrive;
}

/** Model transfer time in ms for one response of n bytes (n ≥ 1). */
export function modelMs(p: Path, n: number, w0: number, start: Start, arrivals?: Float64Array): number {
  const k = Math.max(1, Math.ceil(n / MSS));
  const a = arrivals && arrivals.length >= k ? arrivals : segmentArrivals(p, w0, start, k);
  // The last segment may be partial: it finishes serializing earlier by the missing bytes.
  const short = k * MSS - n;
  return a[k - 1] - wireS(short, p.rateMbit) * 1e3;
}

/** Number of round trips of slow start a response of n bytes needs, counting the first flight. */
export function flights(n: number, w0: number): number {
  let sent = 0;
  let w = w0;
  let f = 0;
  const k = Math.max(1, Math.ceil(n / MSS));
  while (sent < k) {
    sent += w;
    w *= 2;
    f++;
  }
  return f;
}

// ---------- measured data ----------

export type Mode = "udp" | "fresh" | "warm" | "idle";
export type Cc = "bbr" | "cubic";

export interface Point {
  rate: number;
  rtt: number;
  cc: string; // "udp" for the UDP burst
  mode: Mode;
  n: number;
  reps: number;
  med: number;
  min: number;
  max: number;
}

export interface Window {
  rate: number;
  rtt: number;
  cc: string;
  cwnd: number; // segments, median at the start of a warm response
  rto_ms: number; // median retransmission timeout on the idle connections
}

interface Data {
  environment: { kernel: string; cpu: string; cores: number };
  windows: Window[];
  points: Point[];
}

export const DATA = dataJson as unknown as Data;
export const RATES = [10, 100, 1000];
export const RTTS = [2, 20, 100];
export const SIZES = [...new Set(DATA.points.map((p) => p.n))].sort((a, b) => a - b);

export function measured(p: Path, mode: Mode, cc: Cc): Point[] {
  return DATA.points
    .filter((x) => x.rate === p.rateMbit && x.rtt === p.rttMs && x.mode === mode && (mode === "udp" || x.cc === cc))
    .sort((a, b) => a.n - b.n);
}

export function windowFor(p: Path, cc: Cc): Window | undefined {
  return DATA.windows.find((w) => w.rate === p.rateMbit && w.rtt === p.rttMs && w.cc === cc);
}

/**
 * The window Linux restarts an idle connection with (tcp_cwnd_restart in
 * net/ipv4/tcp_output.c, Linux 6.18): halve once for every RTO of idle time
 * beyond the first, but not below min(IW, cwnd). It applies only when
 * net.ipv4.tcp_slow_start_after_idle is 1, the connection has nothing in
 * flight, idle time exceeds one RTO, and the congestion module has no
 * cong_control hook; BBR has one, so a BBR connection keeps its window.
 */
export function restartWindow(cwnd: number, rtoMs: number, idleMs: number, cc: Cc, iw = IW): number {
  if (cc === "bbr" || idleMs <= rtoMs) return cwnd;
  const floor = Math.min(iw, cwnd);
  let w = cwnd;
  let delta = idleMs;
  while ((delta -= rtoMs) > 0 && w > floor) w = Math.floor(w / 2);
  return Math.max(w, floor);
}

/** Idle time in the experiment, from the server's last send to its next: 1 s of client sleep plus one RTT. */
export const idleMs = (p: Path) => 1000 + p.rttMs;

/** Bytes as a short label: 1 KiB, 64 KiB, 4 MiB. */
export function sizeLabel(n: number): string {
  if (n >= 1 << 20) return `${+(n / (1 << 20)).toFixed(n % (1 << 20) ? 1 : 0)} MiB`;
  if (n >= 1 << 10) return `${+(n / (1 << 10)).toFixed(n % (1 << 10) ? 1 : 0)} KiB`;
  return `${n} B`;
}
