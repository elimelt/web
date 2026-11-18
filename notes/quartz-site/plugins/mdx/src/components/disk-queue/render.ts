// Markup for the disk-queue figure: the simulated arm's path across the
// platter (track against time) for the first 150 ms after warm-up, and a
// table of the long-run averages for the chosen policy and queue depth beside
// FCFS at the same depth. The build draws it at the preset; the client
// redraws it from the same functions.

import { esc, num } from "../../shared/format";
import { BARRACUDA, POLICIES, POLICY_NAME, QDS, revMs, simulate, type Policy, type Result } from "./model";

export const W = 640;
export const H = 250;
export const WINDOW_MS = 150;
const M = { left: 46, right: 12, top: 12, bottom: 36 };
const x = (t: number) => M.left + (t / WINDOW_MS) * (W - M.left - M.right);
const y = (r: number) => M.top + r * (H - M.top - M.bottom);

const cache = new Map<string, Result>();
export function run(policy: Policy, qd: number): Result {
  const key = `${policy}:${qd}`;
  let r = cache.get(key);
  if (!r) {
    r = simulate({ policy, qd, n: 4000, seed: 7 });
    cache.set(key, r);
  }
  return r;
}

export function chart(policy: Policy, qd: number): string {
  const res = run(policy, qd);
  const t0 = res.served[0].start;
  const parts: string[] = [];
  for (let t = 0; t <= WINDOW_MS; t += 25) {
    const xx = x(t).toFixed(1);
    parts.push(`<line class="dq-grid" x1="${xx}" x2="${xx}" y1="${M.top}" y2="${H - M.bottom}"/>`);
    parts.push(`<text class="dq-tick" x="${xx}" y="${H - M.bottom + 14}" text-anchor="middle">${t}</text>`);
  }
  for (const [r, label] of [
    [0, "outer"],
    [1, "inner"],
  ] as const) {
    parts.push(`<text class="dq-tick" x="${M.left - 6}" y="${(y(r) + 4).toFixed(1)}" text-anchor="end">${label}</text>`);
  }
  parts.push(`<line class="dq-axisline" x1="${M.left}" x2="${M.left}" y1="${M.top}" y2="${H - M.bottom}"/>`);
  parts.push(`<text class="dq-axis" x="${(M.left + W - M.right) / 2}" y="${H - 4}" text-anchor="middle">time (ms)</text>`);
  const seek: string[] = [];
  const rot: string[] = [];
  const dots: string[] = [];
  let done = 0;
  for (let i = 0; i < res.served.length; i++) {
    const s = res.served[i];
    if (s.start - t0 > WINDOW_MS) break;
    // The first measured request starts from the track the last warm-up request left the arm on.
    const from = i === 0 ? res.startTrack : res.served[i - 1].r;
    const a = s.start - t0;
    const b = Math.min(s.seekEnd - t0, WINDOW_MS);
    const c = Math.min(s.rotEnd - t0, WINDOW_MS);
    // Clip the seek segment to the window along its own line.
    const fb = s.seekEnd - s.start > 0 ? (b - a) / (s.seekEnd - s.start) : 1;
    const rb = from + (s.r - from) * fb;
    seek.push(`M${x(a).toFixed(1)} ${y(from).toFixed(1)}L${x(b).toFixed(1)} ${y(rb).toFixed(1)}`);
    if (c > b) rot.push(`M${x(b).toFixed(1)} ${y(s.r).toFixed(1)}H${x(c).toFixed(1)}`);
    if (s.end - t0 <= WINDOW_MS) {
      dots.push(`<circle class="dq-done" cx="${x(s.end - t0).toFixed(1)}" cy="${y(s.r).toFixed(1)}" r="3"/>`);
      done++;
    }
  }
  parts.push(`<path class="dq-seek" d="${seek.join("")}"/>`);
  parts.push(`<path class="dq-rot" d="${rot.join("")}"/>`);
  parts.push(...dots);
  const label = `Simulated arm path under ${POLICY_NAME[policy]} at queue depth ${qd}: ${done} requests completed in the first ${WINDOW_MS} ms.`;
  return `<svg class="dq-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${parts.join("")}</svg>`;
}

export function doneInWindow(policy: Policy, qd: number): number {
  const res = run(policy, qd);
  const t0 = res.served[0].start;
  return res.served.filter((s) => s.end - t0 <= WINDOW_MS).length;
}

const ms = (v: number) => `${num(v, v >= 100 ? 0 : 1)} ms`;

export function readout(policy: Policy, qd: number): string {
  const a = run(policy, qd);
  const f = run("fcfs", qd);
  const same = policy === "fcfs";
  const rows: [string, string, string][] = [
    ["Requests per second", num(a.iops, 0), num(f.iops, 0)],
    ["Mean seek", ms(a.meanSeek), ms(f.meanSeek)],
    ["Mean rotational wait", ms(a.meanRot), ms(f.meanRot)],
    ["Mean response time", ms(a.meanResponse), ms(f.meanResponse)],
    ["99th percentile response", ms(a.p99Response), ms(f.p99Response)],
  ];
  const head = same
    ? `<tr><th>Queue depth ${qd}</th><th>FCFS</th></tr>`
    : `<tr><th>Queue depth ${qd}</th><th>${POLICY_NAME[policy]}</th><th>FCFS</th></tr>`;
  const body = rows.map((r) => (same ? `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>` : `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`));
  return `<table class="dq-table"><thead>${head}</thead><tbody>${body.join("")}</tbody></table>`;
}

export function status(policy: Policy, qd: number): string {
  return `${doneInWindow(policy, qd)} requests finished in the first ${WINDOW_MS} ms`;
}

export interface Props {
  policy?: string;
  qd?: number;
}

export function parseProps(props: Props): { policy: Policy; qd: number } {
  const policy = (POLICIES as string[]).includes(String(props.policy)) ? (props.policy as Policy) : "fcfs";
  const qd = typeof props.qd === "number" && QDS.includes(props.qd) ? props.qd : 1;
  return { policy, qd };
}

export function render(props: Props): string {
  const { policy, qd } = parseProps(props);
  const idx = QDS.indexOf(qd);
  const buttons = POLICIES.map(
    (p) => `<button type="button" name="${p}" aria-pressed="${p === policy}" disabled>${POLICY_NAME[p]}</button>`,
  ).join("");
  return [
    `<figure class="dq" data-policy="${policy}" data-qd="${qd}">`,
    `<div class="dq-controls">`,
    `<div class="dq-policy" role="group" aria-label="Scheduling policy">${buttons}</div>`,
    `<label class="dq-slider"><span>Queue depth <output name="qd-out">${qd}</output></span><input type="range" name="qd" min="0" max="${QDS.length - 1}" step="1" value="${idx}" disabled></label>`,
    `</div>`,
    `<div class="dq-legend" aria-hidden="true"><span class="dq-key dq-key-seek">seek</span><span class="dq-key dq-key-rot">rotational wait</span><span class="dq-key dq-key-done">request done</span><span class="dq-count" data-part="status">${esc(status(policy, qd))}</span></div>`,
    `<div class="dq-plot" data-part="chart">${chart(policy, qd)}</div>`,
    `<div class="dq-readout" data-part="readout" aria-live="polite">${readout(policy, qd)}</div>`,
    `<figcaption>Simulation, computed in the page: one arm and a ${BARRACUDA.rpm.toLocaleString("en-US")} RPM platter (${num(revMs(BARRACUDA), 2)} ms per revolution), ${BARRACUDA.avgSeekMs} ms average seek, ${BARRACUDA.mbps} MB/s media rate, the Barracuda parameters from OSTEP chapter 37. Every request is a 4 KiB read at a uniformly random track and angle; the queue is closed, so a new request arrives each time one completes, as with fio at a fixed iodepth. Averages are over 4,000 requests after 400 of warm-up.</figcaption>`,
    `</figure>`,
  ].join("");
}
