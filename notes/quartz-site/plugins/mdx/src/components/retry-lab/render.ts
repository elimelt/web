// Markup for the retry lab: a space-time diagram of one sampled call, the
// exact distribution of executions per call, and the Linux measurement for the
// same setting when one exists.

import { esc } from "../../shared/format";
import { mulberry32 } from "../../shared/random";
import { BINS, distribution, LOSS_STEPS, MEASURED_SENDS, sampleCall, type Mode, type Params, type Trace } from "./model";
import { MEASURED, type Measured } from "./data";

export interface Props {
  mode?: unknown;
  q?: unknown;
  r?: unknown;
  seed?: unknown;
}

export const W = 600;
export const W_NARROW = 400;
/** Figures narrower than this many pixels redraw with the narrow coordinate system. */
export const NARROW_PX = 520;
export const MAX_SENDS = 8;

export interface State extends Params {
  seed: number;
}

const f1 = (v: number): string => v.toFixed(1);
export const pct = (v: number): string => {
  const x = v * 100;
  if (x === 0) return "0%";
  if (x < 0.1) return "<0.1%";
  if (x === 100) return "100%";
  return `${x.toFixed(1)}%`;
};

export function initialState(props: Props): State {
  const step = (v: unknown, d: number): number => {
    const x = Number(v);
    return LOSS_STEPS.includes(x) ? x : d;
  };
  return {
    mode: props.mode === "amo" ? "amo" : "alo",
    q: step(props.q, 0.2),
    r: step(props.r, 0.2),
    sends: MEASURED_SENDS,
    seed: Number.isFinite(Number(props.seed)) ? Number(props.seed) : 3,
  };
}

/**
 * The call drawn in the diagram: the first call from the seeded stream whose
 * sample is drawn with the current probabilities. Re-sampling with the same
 * seed after a slider moves keeps the same uniforms, so the diagram changes
 * only where the new probabilities change an outcome.
 */
export function traceFor(s: State): Trace {
  return sampleCall(s, mulberry32(s.seed));
}

export function measuredFor(s: Params): Measured | undefined {
  if (s.sends !== MEASURED_SENDS) return undefined;
  return MEASURED.find((m) => m.mode === s.mode && m.q === s.q && m.r === s.r);
}

// ---- space-time diagram -------------------------------------------------

function arrowHead(x1: number, y1: number, ux: number, uy: number): string {
  const h = 6;
  const bx = x1 - ux * h;
  const by = y1 - uy * h;
  const px = -uy * 3;
  const py = ux * 3;
  return `<polygon points="${f1(x1)},${f1(y1)} ${f1(bx + px)},${f1(by + py)} ${f1(bx - px)},${f1(by - py)}"/>`;
}

function message(x0: number, y0: number, x1: number, y1: number, dropped: boolean, cls: string): string {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  if (dropped) {
    const xm = x0 + (x1 - x0) * 0.55;
    const ym = y0 + (y1 - y0) * 0.55;
    return (
      `<g class="rl-msg ${cls} rl-dropped"><line x1="${f1(x0)}" y1="${f1(y0)}" x2="${f1(xm)}" y2="${f1(ym)}"/>` +
      `<path class="rl-x" d="M${f1(xm - 4)},${f1(ym - 4)}L${f1(xm + 4)},${f1(ym + 4)}M${f1(xm - 4)},${f1(ym + 4)}L${f1(xm + 4)},${f1(ym - 4)}"/></g>`
    );
  }
  return (
    `<g class="rl-msg ${cls}"><line x1="${f1(x0)}" y1="${f1(y0)}" x2="${f1(x1 - ux * 5)}" y2="${f1(y1 - uy * 5)}"/>` +
    `${arrowHead(x1, y1, ux, uy)}</g>`
  );
}

export function ladder(s: State, width: number = W): string {
  const t = traceFor(s);
  const narrow = width < 500;
  const LABEL = narrow ? 48 : 58;
  const RIGHT = 10;
  const yC = 22;
  const yS = 82;
  const H = 118;
  // One slot per possible send: the request takes 1 unit, the reply 1 unit,
  // and the timeout fires at 3 units after the send.
  const slots = s.sends;
  const unit = (width - LABEL - RIGHT) / (slots * 3 + 0.4);
  const x = (u: number): number => LABEL + u * unit;
  const out: string[] = [
    `<svg viewBox="0 0 ${width} ${H}" class="rl-ladder" role="img" aria-label="Space-time diagram of one sampled call: the client sends a request, retransmits after each timeout, and the server row shows each execution">`,
    `<line class="rl-lane" x1="${LABEL}" x2="${width - RIGHT}" y1="${yC}" y2="${yC}"/>`,
    `<line class="rl-lane" x1="${LABEL}" x2="${width - RIGHT}" y1="${yS}" y2="${yS}"/>`,
    `<text class="rl-label" x="${LABEL - 8}" y="${yC + 4}" text-anchor="end">client</text>`,
    `<text class="rl-label" x="${LABEL - 8}" y="${yS + 4}" text-anchor="end">server</text>`,
  ];
  // Unused send slots are drawn faintly, so the axis length is fixed.
  for (let i = t.sends.length; i < slots; i++) {
    out.push(`<circle class="rl-slot" cx="${f1(x(i * 3))}" cy="${yC}" r="2.5"/>`);
  }
  let execNo = 0;
  t.sends.forEach((snd, i) => {
    const t0 = i * 3;
    out.push(message(x(t0), yC, x(t0 + 1), yS, snd.outcome === "lost", "rl-req"));
    if (snd.outcome !== "lost") {
      const cx = x(t0 + 1);
      if (snd.executed) {
        execNo++;
        out.push(`<circle class="rl-exec${execNo > 1 ? " rl-dup" : ""}" cx="${f1(cx)}" cy="${yS}" r="5"/>`);
        out.push(`<text class="rl-note${execNo > 1 ? " rl-dup-text" : ""}" x="${f1(cx)}" y="${yS + 20}" text-anchor="middle">${execNo === 1 ? "run" : `run ${execNo}`}</text>`);
      } else {
        out.push(`<rect class="rl-replay" x="${f1(cx - 4.5)}" y="${yS - 4.5}" width="9" height="9"/>`);
        out.push(`<text class="rl-note" x="${f1(cx)}" y="${yS + 20}" text-anchor="middle">table</text>`);
      }
      out.push(message(x(t0 + 1), yS, x(t0 + 2), yC, snd.outcome === "orphan", "rl-rep"));
    }
    if (snd.outcome !== "success") {
      // timeout bracket on the client lane
      const tx = x(t0 + 3);
      out.push(`<path class="rl-timeout" d="M${f1(x(t0))},${yC - 9}H${f1(tx)}V${yC - 3}"/>`);
      if (i === 0) out.push(`<text class="rl-note" x="${f1((x(t0) + tx) / 2)}" y="${yC - 13}" text-anchor="middle">timeout</text>`);
    }
  });
  if (t.ok) {
    const last = t.sends.length - 1;
    out.push(`<circle class="rl-done" cx="${f1(x(last * 3 + 2))}" cy="${yC}" r="5"/>`);
  } else {
    const end = x(t.sends.length * 3);
    out.push(`<text class="rl-fail" x="${f1(Math.min(end + 2, width - RIGHT))}" y="${yC + 18}" text-anchor="end">error</text>`);
  }
  out.push(`</svg>`);
  return out.join("");
}

export function traceText(s: State): string {
  const t = traceFor(s);
  const n = t.sends.length;
  const sends = `${n} send${n === 1 ? "" : "s"}`;
  const runs = t.executions === 1 ? "once" : t.executions === 2 ? "twice" : `${t.executions} times`;
  const replays = t.sends.filter((x) => x.replayed).length;
  const rep = replays ? `, answered ${replays} later cop${replays === 1 ? "y" : "ies"} from its table` : "";
  if (t.ok) return `This call returned after ${sends}. The server ran the procedure ${t.executions === 0 ? "zero times" : runs}${rep}.`;
  return `This call failed after ${sends}, and the caller cannot tell how often it ran. The server ran it ${t.executions === 0 ? "zero times" : runs}${rep}.`;
}

// ---- distribution chart --------------------------------------------------

const BIN_LABEL = ["0", "1", "2", "3", "4+"];

export function bars(s: State, width: number = W): string {
  const d = distribution(s);
  const m = measuredFor(s);
  const narrow = width < 500;
  const L = narrow ? 40 : 46;
  const R = 10;
  const T = 18;
  const H = 200;
  const B = H - 40;
  const y = (p: number): number => B - p * (B - T);
  const slot = (width - L - R) / BINS;
  const bw = slot * 0.46;
  const out: string[] = [
    `<svg viewBox="0 0 ${width} ${H}" class="rl-bars" role="img" aria-label="Probability that a call executes 0, 1, 2, 3 or 4 or more times, split by whether the caller received a reply">`,
  ];
  for (const p of [0, 0.25, 0.5, 0.75, 1]) {
    out.push(`<line class="rl-grid" x1="${L}" x2="${width - R}" y1="${f1(y(p))}" y2="${f1(y(p))}"/>`);
    out.push(`<text class="rl-tick" x="${L - 6}" y="${f1(y(p) + 4)}" text-anchor="end">${p * 100}%</text>`);
  }
  for (let b = 0; b < BINS; b++) {
    const cx = L + slot * (b + 0.5);
    const x0 = cx - bw / 2;
    const okH = (B - T) * d.ok[b];
    const failH = (B - T) * d.fail[b];
    if (okH > 0) out.push(`<rect class="rl-bar-ok" x="${f1(x0)}" y="${f1(B - okH)}" width="${f1(bw)}" height="${f1(okH)}"/>`);
    if (failH > 0) out.push(`<rect class="rl-bar-fail" x="${f1(x0)}" y="${f1(B - okH - failH)}" width="${f1(bw)}" height="${f1(failH)}"/>`);
    const tot = d.ok[b] + d.fail[b];
    out.push(`<text class="rl-val" x="${f1(cx)}" y="${f1(Math.min(B - okH - failH - 5, B - 5))}" text-anchor="middle">${pct(tot)}</text>`);
    if (m) {
      const [mean, lo, hi] = m.hist[b];
      const my = y(mean);
      const mx = cx + bw / 2 + 7;
      out.push(`<g class="rl-meas"><line x1="${f1(mx)}" x2="${f1(mx)}" y1="${f1(y(hi))}" y2="${f1(y(lo))}"/><path d="M${f1(mx)},${f1(my - 4.5)}L${f1(mx + 4.5)},${f1(my)}L${f1(mx)},${f1(my + 4.5)}L${f1(mx - 4.5)},${f1(my)}Z"/></g>`);
    }
    out.push(`<text class="rl-tick" x="${f1(cx)}" y="${B + 16}" text-anchor="middle">${BIN_LABEL[b]}</text>`);
  }
  out.push(`<text class="rl-axis" x="${f1(L + (width - L - R) / 2)}" y="${H - 6}" text-anchor="middle">executions of one call</text>`);
  out.push(`</svg>`);
  return out.join("");
}

export function legend(s: State): string {
  const items = [
    ["rl-key-ok", "caller received a reply"],
    ["rl-key-fail", "caller gave up"],
  ];
  if (measuredFor(s)) items.push(["rl-key-meas", "measured (range over 3 runs)"]);
  return items.map(([c, t]) => `<li><span class="rl-key ${c}"></span>${esc(t)}</li>`).join("");
}

const range = ([mean, lo, hi]: [number, number, number]): string =>
  `<b>${pct(mean)}</b> <span class="rl-range">(${pct(lo)} to ${pct(hi)})</span>`;

export function readout(s: State): string {
  const d = distribution(s);
  const rows: [string, string, string][] = [
    ["Caller receives a reply", pct(d.pOk), ""],
    ["Executed two or more times", pct(d.pDup), ""],
    ["Error, but executed", pct(d.pFailExecuted), ""],
    ["Error, never executed", pct(d.pFailNone), ""],
  ];
  const m = measuredFor(s);
  if (m) {
    rows[0][2] = range(m.ok);
    rows[1][2] = range(m.dup);
    rows[2][2] = range(m.failExec);
    rows[3][2] = range(m.failNone);
  }
  const head = `<tr><th></th><th>model</th><th>${m ? "measured" : ""}</th></tr>`;
  const body = rows.map(([a, b, c]) => `<tr><th scope="row">${a}</th><td><b>${b}</b></td><td>${c}</td></tr>`).join("");
  const note = m
    ? `Measured on Linux loopback with the kernel dropping packets at random: ${m.runs} runs of ${m.calls.toLocaleString("en-US")} calls; realized drop rates ${pct(m.reqDrop)} of requests and ${pct(m.repDrop)} of replies.`
    : s.sends !== MEASURED_SENDS
      ? `Measurements exist only for ${MEASURED_SENDS} sends.`
      : "This combination of request and reply loss was not measured.";
  return `<table class="rl-table">${head}${body}</table><p class="rl-measured">${esc(note)}</p>`;
}

// ---- controls ---------------------------------------------------------------

const pressed = (on: boolean): string => `aria-pressed="${on}"`;
const MODE_LABEL: Record<Mode, string> = { alo: "At least once", amo: "At most once" };

export function controls(s: State): string {
  const modes = (["alo", "amo"] as Mode[])
    .map((m) => `<button type="button" name="mode" value="${m}" ${pressed(s.mode === m)} disabled>${MODE_LABEL[m]}</button>`)
    .join("");
  const slider = (name: string, label: string, idx: number, max: number, out: string) =>
    `<label class="rl-slider"><span>${label} <output name="${name}-out">${out}</output></span>` +
    `<input type="range" name="${name}" min="0" max="${max}" step="1" value="${idx}" disabled></label>`;
  return (
    `<div class="rl-row"><span class="rl-row-label">Server executes</span><span class="rl-buttons">${modes}</span></div>` +
    `<div class="rl-sliders">` +
    slider("q", "Request loss", LOSS_STEPS.indexOf(s.q), LOSS_STEPS.length - 1, pct(s.q)) +
    slider("r", "Reply loss", LOSS_STEPS.indexOf(s.r), LOSS_STEPS.length - 1, pct(s.r)) +
    `<label class="rl-slider"><span>Sends before giving up <output name="sends-out">${s.sends}</output></span>` +
    `<input type="range" name="sends" min="1" max="${MAX_SENDS}" step="1" value="${s.sends}" disabled></label>` +
    `</div>`
  );
}

export const CAPTION =
  "The bars are the exact distribution for independent losses with a timeout longer than the round trip; the diagram is one call sampled from the same model (seeded, so it repeats). Diamonds are the measurement: a Go UDP client and server on Linux loopback, with iptables dropping requests and replies at random.";

export function body(s: State): string {
  return (
    `<form class="rl-controls">${controls(s)}</form>` +
    `<div class="rl-trace-head"><span data-part="trace-text">${esc(traceText(s))}</span>` +
    `<button type="button" name="resample" disabled>Sample another call</button></div>` +
    `<div class="rl-plot" data-part="ladder">${ladder(s)}</div>` +
    `<div class="rl-plot" data-part="bars">${bars(s)}</div>` +
    `<ul class="rl-legend" data-part="legend">${legend(s)}</ul>` +
    `<div class="rl-readout" data-part="readout" aria-live="polite">${readout(s)}</div>`
  );
}

export function render(props: Props): string {
  const s = initialState(props);
  return `<figure class="rl" data-mode="${s.mode}" data-q="${s.q}" data-r="${s.r}" data-seed="${s.seed}">${body(s)}<figcaption>${esc(CAPTION)}</figcaption></figure>`;
}
