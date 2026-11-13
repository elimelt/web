// Discrete-event model of one bulk TCP transfer, built to isolate flow
// control. The sender always has data and is limited only by the receiver's
// advertised window: there is no congestion window. The path is one
// bottleneck link in each direction with a FIFO queue that never drops, plus
// a fixed propagation delay. The receiver holds every byte the window
// admitted until its application reads it, so the advertised right edge is
// "bytes read + buffer size".
//
// What it models, and where each rule comes from:
// - Window: the sender may have bytes up to (last ACK + last advertised
//   window) outstanding (RFC 9293 §3.8.6).
// - Zero window: with the window closed and nothing in flight the sender arms a
//   persist timer at the retransmission timeout and doubles it after every
//   probe (RFC 9293 §3.8.6.1). Probes carry no data, as Linux's do.
// - Silly window avoidance (both ends at once, RFC 9293 §3.8.6.2): the
//   receiver moves its right edge only in steps of at least min(MSS, buffer/2);
//   the sender waits until it can send a full MSS or half the largest window
//   it has seen.
// - Window updates: after the application reads, the receiver sends a pure
//   ACK when the window it would now offer is at least twice the one still
//   open, and that open window is at most half the buffer (Linux's rule in
//   __tcp_cleanup_rbuf, net/ipv4/tcp.c).
// - Loss recovery: cumulative ACKs, an ACK for every segment, fast retransmit
//   on three duplicate ACKs, NewReno-style partial ACKs, and a retransmission
//   timer from RFC 6298 with a 200 ms floor (Linux's minimum).
// Not modeled: congestion control, delayed ACKs, SACK, timestamps, header
// options, Nagle's algorithm for small writes, and Linux's buffer overhead
// (a real receiver advertises less than the buffer it was given).

export const MSS = 1460;
export const HEADER = 40;
export const MIN_RTO_MS = 200;
export const MAX_RTO_MS = 120_000;

export interface Params {
  rateMbps: number; // bottleneck rate in each direction
  rttMs: number; // round-trip propagation delay
  bufBytes: number; // receive buffer
  readBps: number; // application read rate in bytes/s; Infinity reads on arrival
  readChunk: number; // bytes per read call when readBps is finite
  stall: [number, number] | null; // ms interval in which the application reads nothing
  sws: boolean;
  loseFirstUpdate: boolean;
  durationMs: number;
  drops: number[]; // ids of data transmissions to lose
}

export type TxKind = "new" | "rtx" | "probe";
export interface Tx {
  id: number;
  t: number; // ms, leaves the sender
  seq: number;
  len: number;
  kind: TxKind;
  lost: boolean;
}
export interface AckAtSender {
  t: number;
  ack: number;
  right: number; // ack + advertised window
  update: boolean; // a pure window update sent after a read
}
export interface RcvSample {
  t: number;
  read: number; // bytes the application has read
  rcvNxt: number; // next in-order byte expected
  buffered: number; // bytes held: unread in-order plus out-of-order
  right: number; // advertised right edge
}
export interface SndSample {
  t: number;
  inFlight: number;
  window: number;
}
export interface Result {
  params: Params;
  txs: Tx[];
  acks: AckAtSender[];
  rcv: RcvSample[];
  snd: SndSample[];
  probes: number[]; // send times of zero-window probes
  updates: { t: number; lost: boolean }[];
  dataSegments: number;
  dataBytesSent: number;
  retransmits: number;
  fastRetransmits: number;
  timeouts: number;
  readBytes: number;
  maxBuffered: number;
  violations: string[]; // invariants the run broke; empty for a correct model
}

type Ev =
  | { k: "data"; seq: number; len: number; probe: boolean }
  | { k: "ack"; ack: number; right: number; update: boolean }
  | { k: "read" }
  | { k: "rto"; gen: number }
  | { k: "persist"; gen: number };

class Queue {
  private heap: { t: number; n: number; ev: Ev }[] = [];
  private n = 0;
  push(t: number, ev: Ev) {
    const h = this.heap;
    h.push({ t, n: this.n++, ev });
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(h[p], h[i])) break;
      [h[p], h[i]] = [h[i], h[p]];
      i = p;
    }
  }
  pop(): { t: number; ev: Ev } | undefined {
    const h = this.heap;
    if (!h.length) return undefined;
    const top = h[0];
    const last = h.pop()!;
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && this.less(h[l], h[m])) m = l;
        if (r < h.length && this.less(h[r], h[m])) m = r;
        if (m === i) break;
        [h[m], h[i]] = [h[i], h[m]];
        i = m;
      }
    }
    return top;
  }
  private less(a: { t: number; n: number }, b: { t: number; n: number }) {
    return a.t < b.t || (a.t === b.t && a.n < b.n);
  }
}

/** Serialization time in ms for `bytes` on a link of `mbps`. */
export const wireMs = (bytes: number, mbps: number) => (bytes * 8) / (mbps * 1000);

/** Throughput the window allows, in Mbit/s of application data. */
export function predictedMbps(p: Params): { mbps: number; limit: "link" | "window" | "reader" } {
  const link = (p.rateMbps * MSS) / (MSS + HEADER);
  // One window per round trip; the round trip includes sending one segment and its ACK.
  const rtt = p.rttMs + wireMs(MSS + HEADER, p.rateMbps) + wireMs(HEADER, p.rateMbps);
  const window = (p.bufBytes * 8) / (rtt * 1000);
  const reader = Number.isFinite(p.readBps) ? (p.readBps * 8) / 1e6 : Infinity;
  const best = Math.min(link, window, reader);
  return { mbps: best, limit: best === reader ? "reader" : best === window ? "window" : "link" };
}

export function simulate(p: Params): Result {
  const q = new Queue();
  const half = p.rttMs / 2;
  const drops = new Set(p.drops);
  const res: Result = {
    params: p, txs: [], acks: [], rcv: [], snd: [], probes: [], updates: [],
    dataSegments: 0, dataBytesSent: 0, retransmits: 0, fastRetransmits: 0, timeouts: 0,
    readBytes: 0, maxBuffered: 0, violations: [],
  };
  const violate = (msg: string) => {
    if (res.violations.length < 20) res.violations.push(msg);
  };

  // Links, one FIFO per direction.
  let dataLinkFree = 0;
  let ackLinkFree = 0;

  // Sender.
  let sndUna = 0;
  let sndNxt = 0;
  let right = 0; // set from the handshake below
  let maxWnd = 0;
  let srtt = -1;
  let rttvar = 0;
  let rto = 1000; // RFC 6298 initial value
  let rtoGen = 0;
  let rtoArmed = false;
  let persistGen = 0;
  let persistArmed = false;
  let persistBackoff = 0;
  let timed: { seq: number; t: number } | null = null;
  let dupAcks = 0;
  let recover = -1; // in recovery while sndUna < recover
  let txId = 0;

  // Receiver.
  let rcvNxt = 0;
  let read = 0;
  let advRight = 0; // right edge last advertised
  const ooo = new Map<number, number>(); // seq -> len, out-of-order data
  let oooBytes = 0;
  let firstUpdateLost = false;

  const sampleRcv = (t: number) => {
    const buffered = rcvNxt - read + oooBytes;
    res.maxBuffered = Math.max(res.maxBuffered, buffered);
    if (buffered > p.bufBytes) violate(`buffer over capacity at ${t.toFixed(3)} ms`);
    res.rcv.push({ t, read, rcvNxt, buffered, right: advRight });
  };
  const sampleSnd = (t: number) => res.snd.push({ t, inFlight: sndNxt - sndUna, window: right - sndUna });

  // The right edge the receiver would advertise now.
  const candidateRight = () => {
    const full = read + p.bufBytes;
    if (!p.sws) return full;
    const step = Math.min(MSS, Math.floor(p.bufBytes / 2));
    return full - advRight >= step ? full : advRight;
  };

  // Linux sends a window update after a read when "this read freed lots of
  // space": the new window is at least twice the window still open.
  const wantsUpdate = () => {
    const open = advRight - rcvNxt;
    if (2 * open > p.bufBytes) return false;
    const next = candidateRight() - rcvNxt;
    return next > open && next >= 2 * open;
  };

  const sendAck = (t: number, update: boolean) => {
    advRight = Math.max(advRight, candidateRight());
    const start = Math.max(t, ackLinkFree);
    ackLinkFree = start + wireMs(HEADER, p.rateMbps);
    let lost = false;
    if (update) {
      if (p.loseFirstUpdate && !firstUpdateLost) {
        firstUpdateLost = true;
        lost = true;
      }
      res.updates.push({ t, lost });
    }
    if (!lost) q.push(ackLinkFree + half, { k: "ack", ack: rcvNxt, right: advRight, update });
  };

  const transmit = (t: number, seq: number, len: number, kind: TxKind) => {
    const id = kind === "probe" ? -1 : txId++;
    const lost = kind !== "probe" && drops.has(id);
    res.txs.push({ id, t, seq, len, kind, lost });
    if (kind === "probe") res.probes.push(t);
    else {
      res.dataSegments++;
      res.dataBytesSent += len;
      if (kind === "rtx") res.retransmits++;
    }
    const start = Math.max(t, dataLinkFree);
    dataLinkFree = start + wireMs(len + HEADER, p.rateMbps);
    if (!lost) q.push(dataLinkFree + half, { k: "data", seq, len, probe: kind === "probe" });
  };

  const armRto = (t: number) => {
    rtoArmed = true;
    q.push(t + rto, { k: "rto", gen: ++rtoGen });
  };
  const disarmRto = () => {
    rtoArmed = false;
    rtoGen++;
  };
  const armPersist = (t: number) => {
    if (persistArmed) return;
    persistArmed = true;
    const wait = Math.min(MAX_RTO_MS, rto * 2 ** persistBackoff);
    q.push(t + wait, { k: "persist", gen: ++persistGen });
  };
  const disarmPersist = () => {
    persistArmed = false;
    persistGen++;
    persistBackoff = 0;
  };

  const retransmitHead = (t: number) => {
    const len = Math.min(MSS, sndNxt - sndUna);
    if (len <= 0) return;
    transmit(t, sndUna, len, "rtx");
    if (timed && timed.seq >= sndUna) timed = null; // Karn: never time a retransmitted range
  };

  // Sender-side silly window avoidance: hold back a segment smaller than one
  // MSS unless it is at least half the largest window the receiver has offered.
  const canSend = () => {
    const len = Math.min(MSS, right - sndNxt);
    return len > 0 && !(p.sws && len < MSS && len < maxWnd / 2);
  };

  const trySend = (t: number) => {
    for (;;) {
      const len = Math.min(MSS, right - sndNxt);
      if (!canSend()) {
        if (sndNxt === sndUna) armPersist(t);
        break;
      }
      if (sndNxt + len > right) violate("sender overran the window");
      if (!timed) timed = { seq: sndNxt, t };
      transmit(t, sndNxt, len, "new");
      sndNxt += len;
      if (sndNxt - sndUna > right - sndUna) violate(`in flight above window at ${t.toFixed(3)} ms`);
      if (!rtoArmed) armRto(t);
    }
    sampleSnd(t);
  };

  const onAck = (t: number, ack: number, adv: number) => {
    const oldRight = right;
    if (ack > sndUna) {
      if (timed && ack > timed.seq) {
        const sample = t - timed.t;
        if (srtt < 0) {
          srtt = sample;
          rttvar = sample / 2;
        } else {
          rttvar = 0.75 * rttvar + 0.25 * Math.abs(srtt - sample);
          srtt = 0.875 * srtt + 0.125 * sample;
        }
        rto = Math.min(MAX_RTO_MS, Math.max(MIN_RTO_MS, srtt + 4 * rttvar));
        timed = null;
      }
      sndUna = ack;
      if (sndNxt < sndUna) sndNxt = sndUna;
      dupAcks = 0;
      if (recover >= 0) {
        if (sndUna < recover) retransmitHead(t); // partial ACK: next hole
        else recover = -1;
      }
      disarmRto();
      if (sndNxt > sndUna) armRto(t);
    } else if (ack === sndUna && sndNxt > sndUna && adv === oldRight) {
      dupAcks++;
      if (dupAcks === 3 && recover < 0) {
        recover = sndNxt;
        res.fastRetransmits++;
        retransmitHead(t);
      }
    }
    if (adv > right) right = adv;
    maxWnd = Math.max(maxWnd, right - sndUna);
    // A window that lets the sender go again ends the persist state; an ACK to
    // a probe that still shows a closed window leaves the backed-off timer running.
    if (persistArmed && (canSend() || sndNxt > sndUna)) disarmPersist();
    trySend(t);
  };

  const deliverInOrder = () => {
    let moved = true;
    while (moved) {
      moved = false;
      for (const [seq, len] of ooo) {
        if (seq <= rcvNxt) {
          const end = seq + len;
          ooo.delete(seq);
          oooBytes -= len;
          if (end > rcvNxt) rcvNxt = end;
          moved = true;
        }
      }
    }
  };

  const onData = (t: number, seq: number, len: number, probe: boolean) => {
    if (!probe && len > 0) {
      const end = seq + len;
      if (end > advRight) violate(`data beyond the advertised window at ${t.toFixed(3)} ms`);
      if (end > rcvNxt) {
        if (seq <= rcvNxt) {
          rcvNxt = end;
          deliverInOrder();
        } else if (!ooo.has(seq)) {
          ooo.set(seq, len);
          oooBytes += len;
        }
      }
      if (!Number.isFinite(p.readBps)) readNow(t);
    }
    sendAck(t, false);
    sampleRcv(t);
  };

  const stalled = (t: number) => p.stall !== null && t >= p.stall[0] && t < p.stall[1];

  const readNow = (t: number) => {
    if (stalled(t)) return;
    const n = rcvNxt - read;
    if (n <= 0) return;
    read += n;
    res.readBytes = read;
  };

  const onRead = (t: number) => {
    if (!stalled(t)) {
      const n = Math.min(p.readChunk, rcvNxt - read);
      if (n > 0) {
        read += n;
        res.readBytes = read;
        if (wantsUpdate()) sendAck(t, true);
        sampleRcv(t);
      }
    }
    q.push(t + (p.readChunk / p.readBps) * 1000, { k: "read" });
  };

  // Connection open: the SYN-ACK advertises the whole buffer. Data starts one
  // round trip after time zero, as it would after a handshake.
  advRight = p.bufBytes;
  right = advRight;
  maxWnd = right;
  if (Number.isFinite(p.readBps)) q.push(0, { k: "read" });
  else if (p.stall) q.push(p.stall[1], { k: "read" });
  trySend(0);
  sampleRcv(0);

  let steps = 0;
  for (;;) {
    const e = q.pop();
    if (!e || e.t > p.durationMs) break;
    if (++steps > 2_000_000) {
      violate("event limit reached");
      break;
    }
    const { t, ev } = e;
    switch (ev.k) {
      case "data":
        onData(t, ev.seq, ev.len, ev.probe);
        break;
      case "ack":
        onAck(t, ev.ack, ev.right);
        res.acks.push({ t, ack: ev.ack, right: ev.right, update: ev.update });
        break;
      case "read":
        if (Number.isFinite(p.readBps)) onRead(t);
        else {
          // Unlimited reader: the event marks the end of a stall.
          readNow(t);
          if (wantsUpdate()) sendAck(t, true);
          sampleRcv(t);
        }
        break;
      case "rto":
        if (ev.gen !== rtoGen || !rtoArmed) break;
        res.timeouts++;
        rto = Math.min(MAX_RTO_MS, rto * 2);
        recover = sndNxt;
        dupAcks = 0;
        rtoArmed = false;
        retransmitHead(t);
        armRto(t);
        break;
      case "persist":
        if (ev.gen !== persistGen || !persistArmed) break;
        persistArmed = false;
        if (canSend()) {
          persistBackoff = 0;
          trySend(t);
          break;
        }
        transmit(t, sndUna - 1, 0, "probe");
        persistBackoff++;
        armPersist(t);
        break;
    }
  }
  return res;
}

export interface Summary {
  goodputMbps: number; // application bytes read, averaged over the second half of the run
  meanSegment: number; // average new-data segment size in bytes
  overhead: number; // header bytes per application byte, data direction
  predicted: ReturnType<typeof predictedMbps>;
}

export function summarize(r: Result): Summary {
  const end = r.params.durationMs;
  const mid = end / 2;
  const readAt = (t: number) => {
    let v = 0;
    for (const s of r.rcv) {
      if (s.t > t) break;
      v = s.read;
    }
    return v;
  };
  const goodput = ((readAt(end) - readAt(mid)) * 8) / ((end - mid) * 1000);
  const fresh = r.txs.filter((x) => x.kind === "new");
  const bytes = fresh.reduce((a, x) => a + x.len, 0);
  return {
    goodputMbps: goodput,
    meanSegment: fresh.length ? bytes / fresh.length : 0,
    overhead: bytes ? (r.dataSegments * HEADER) / bytes : 0,
    predicted: predictedMbps(r.params),
  };
}
