// Markup for the queue-lab figure. The build runs the default experiment and
// renders the finished charts, so the page shows real results before any
// script loads; the client redraws the same parts with the same functions.

import {
  DISTS,
  POLICIES,
  SERVER_COUNTS,
  SEEDS,
  detail as runDetail,
  point as runPoint,
  quantile,
  spread,
  SWEEP_RHOS,
  theory,
  type Config,
  type Detail,
  type Dist,
  type Point,
  type Policy,
  type Stats,
} from "./model";

const W = 640;
const CH = 250;
const M = { left: 46, right: 14, top: 14, bottom: 34 };
const Y_MIN = 0.5;
const Y_MAX = 1000;

export const fmt = (v: number): string => {
  if (!Number.isFinite(v)) return "∞";
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
};

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function describe(config: Config): string {
  const servers = config.servers === 1 ? "1 server" : `${config.servers} servers, ${POLICIES[config.policy].short}`;
  return `${servers}, ${DISTS[config.dist].short} service`;
}

// ---- response time against load -------------------------------------------------

const plotW = W - M.left - M.right;
const plotH = CH - M.top - M.bottom;
const xOf = (rho: number) => M.left + rho * plotW;
export const rhoX = xOf;
const yOf = (v: number) => {
  const c = Math.min(Math.max(v, Y_MIN), Y_MAX);
  return M.top + (1 - (Math.log(c) - Math.log(Y_MIN)) / (Math.log(Y_MAX) - Math.log(Y_MIN))) * plotH;
};

function series(points: Point[], key: keyof Stats, cls: string, shape: "circle" | "square"): string {
  const parts: string[] = [];
  const mids = points.map((p) => ({ rho: p.rho, ...spread(p.runs, key) }));
  if (mids.length > 1) {
    const d = mids.map((m, i) => `${i ? "L" : "M"}${xOf(m.rho).toFixed(1)} ${yOf(m.mid).toFixed(1)}`).join("");
    parts.push(`<path class="ql-line ${cls}" d="${d}"/>`);
  }
  for (const m of mids) {
    const x = xOf(m.rho);
    if (m.hi > m.lo) parts.push(`<line class="ql-bar ${cls}" x1="${x}" x2="${x}" y1="${yOf(m.lo).toFixed(1)}" y2="${yOf(m.hi).toFixed(1)}"/>`);
    const y = yOf(m.mid);
    const title = `<title>load ${m.rho}: ${key === "mean" ? "mean" : "p99"} ${fmt(m.mid)} (seeds ${fmt(m.lo)} to ${fmt(m.hi)})</title>`;
    if (m.mid > Y_MAX) parts.push(`<path class="ql-pt ${cls}" d="M${x - 4} ${M.top + 7}L${x} ${M.top}L${x + 4} ${M.top + 7}Z">${title}</path>`);
    else if (shape === "circle") parts.push(`<circle class="ql-pt ${cls}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5">${title}</circle>`);
    else parts.push(`<rect class="ql-pt ${cls}" x="${(x - 3.5).toFixed(1)}" y="${(y - 3.5).toFixed(1)}" width="7" height="7">${title}</rect>`);
  }
  return parts.join("");
}

function theoryPath(config: Config, key: "mean" | "p99", cls: string): string {
  const pts: string[] = [];
  for (let rho = 0.02; rho <= 0.971; rho += 0.01) {
    const t = theory(config, rho);
    const v = t?.[key];
    if (v === undefined) return "";
    pts.push(`${pts.length ? "L" : "M"}${xOf(rho).toFixed(1)} ${yOf(v).toFixed(1)}`);
  }
  return `<path class="ql-theory ${cls}" d="${pts.join("")}"/>`;
}

export interface Ghost {
  config: Config;
  points: Point[];
}

export function loadChart(config: Config, points: Point[], ghost?: Ghost): string {
  const parts: string[] = [];
  for (const tick of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]) {
    const y = yOf(tick);
    parts.push(
      `<line class="ql-grid" x1="${M.left}" x2="${W - M.right}" y1="${y}" y2="${y}"/>`,
      `<text class="ql-tick" x="${M.left - 6}" y="${y + 4}" text-anchor="end">${tick}</text>`,
    );
  }
  for (let r = 0; r <= 10; r += 1) {
    const x = xOf(r / 10);
    parts.push(`<text class="ql-tick" x="${x}" y="${CH - M.bottom + 15}" text-anchor="middle">${r === 10 ? "1" : r === 0 ? "0" : `.${r}`}</text>`);
  }
  parts.push(
    `<text class="ql-tick" x="${M.left + plotW / 2}" y="${CH - 3}" text-anchor="middle">load ρ (fraction of capacity in use)</text>`,
    `<text class="ql-tick" x="${M.left - 6}" y="${M.top - 3}" text-anchor="end" dy="-2"> </text>`,
    `<line class="ql-axis" x1="${M.left}" x2="${M.left}" y1="${M.top}" y2="${CH - M.bottom}"/>`,
  );
  if (ghost) {
    parts.push(`<g class="ql-ghost">${series(ghost.points, "mean", "ql-mean", "circle")}${series(ghost.points, "p99", "ql-p99", "square")}</g>`);
  }
  parts.push(theoryPath(config, "mean", "ql-mean"), theoryPath(config, "p99", "ql-p99"));
  parts.push(series(points, "mean", "ql-mean", "circle"), series(points, "p99", "ql-p99", "square"));
  const x = xOf(config.rho);
  parts.push(`<line class="ql-now" x1="${x}" x2="${x}" y1="${M.top}" y2="${CH - M.bottom}"/>`);
  const last = points[points.length - 1];
  const label = last
    ? `Response time against load for ${describe(config)}. At load ${last.rho}, mean ${fmt(spread(last.runs, "mean").mid)} and p99 ${fmt(spread(last.runs, "p99").mid)} mean service times.`
    : `Response time against load for ${describe(config)}.`;
  return `<svg class="ql-chart" viewBox="0 0 ${W} ${CH}" role="img" aria-label="${esc(label)}">${parts.join("")}</svg>`;
}

// ---- distribution at the chosen load ------------------------------------------

const DW = 300;
const DH = 220;
const DM = { left: 46, right: 10, top: 10, bottom: 34 };
const P_MIN = 1e-4;

export function ccdfChart(config: Config, d: Detail): string {
  const sorted = d.sorted;
  const n = sorted.length;
  const th = theory(config);
  const xmax = niceCeil(Math.max(quantile(sorted, 0.9999), th?.p99 ? th.p99 * 1.6 : 0));
  const pw = DW - DM.left - DM.right;
  const ph = DH - DM.top - DM.bottom;
  const x = (t: number) => DM.left + (Math.min(t, xmax) / xmax) * pw;
  const y = (p: number) => DM.top + (Math.log10(Math.max(p, P_MIN)) / Math.log10(P_MIN)) * ph;
  const parts: string[] = [];
  for (const p of [1, 0.1, 0.01, 0.001, 0.0001]) {
    parts.push(
      `<line class="${p === 0.01 ? "ql-grid ql-grid-strong" : "ql-grid"}" x1="${DM.left}" x2="${DW - DM.right}" y1="${y(p)}" y2="${y(p)}"/>`,
      `<text class="ql-tick" x="${DM.left - 6}" y="${y(p) + 4}" text-anchor="end">${p === 1 ? "1" : p === 0.1 ? "10%" : p === 0.01 ? "1%" : p === 0.001 ? "0.1%" : "0.01%"}</text>`,
    );
  }
  for (let i = 0; i <= 4; i++) {
    const t = (xmax * i) / 4;
    parts.push(`<text class="ql-tick" x="${x(t)}" y="${DH - DM.bottom + 15}" text-anchor="middle">${fmt(t).replace(/\.00$/, "")}</text>`);
  }
  parts.push(
    `<text class="ql-tick" x="${DM.left + pw / 2}" y="${DH - 3}" text-anchor="middle">response time t</text>`,
    `<line class="ql-axis" x1="${DM.left}" x2="${DM.left}" y1="${DM.top}" y2="${DH - DM.bottom}"/>`,
  );
  if (th?.ccdf) {
    const pts: string[] = [];
    for (let i = 0; i <= 120; i++) {
      const t = (xmax * i) / 120;
      const p = th.ccdf(t);
      if (p < P_MIN) break;
      pts.push(`${pts.length ? "L" : "M"}${x(t).toFixed(1)} ${y(p).toFixed(1)}`);
    }
    parts.push(`<path class="ql-theory ql-sim" d="${pts.join("")}"/>`);
  }
  // Empirical P(R > t) sampled on a log grid of probabilities, as a step line.
  const pts: string[] = [];
  let prevX = DM.left;
  for (let i = 0; i <= 160; i++) {
    const p = Math.pow(10, (i / 160) * Math.log10(P_MIN));
    const idx = Math.min(n - 1, Math.max(0, Math.ceil((1 - p) * n) - 1));
    const t = i === 0 ? 0 : sorted[idx];
    const px = x(t);
    if (i === 0) pts.push(`M${px.toFixed(1)} ${y(p).toFixed(1)}`);
    else pts.push(`L${Math.max(px, prevX).toFixed(1)} ${y(p).toFixed(1)}`);
    prevX = Math.max(px, prevX);
  }
  parts.push(`<path class="ql-line ql-sim" d="${pts.join("")}"/>`);
  const s = spread(d.point.runs, "p99").mid;
  const label = `Fraction of jobs slower than t at load ${config.rho}, ${describe(config)}. One job in a hundred takes longer than ${fmt(s)} mean service times.`;
  return `<svg class="ql-ccdf" viewBox="0 0 ${DW} ${DH}" role="img" aria-label="${esc(label)}">${parts.join("")}</svg>`;
}

function niceCeil(v: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 4, 5, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

// ---- table at the chosen load ----------------------------------------------------

const ROWS: { key: keyof Stats; label: string }[] = [
  { key: "mean", label: "Mean" },
  { key: "p50", label: "Median" },
  { key: "p99", label: "p99" },
  { key: "p999", label: "p99.9" },
];

export function table(config: Config, d: Detail): string {
  const th = theory(config);
  const exact = (key: keyof Stats): string => {
    if (!th) return "";
    if (key === "mean") return fmt(th.mean);
    if (key === "p99" && th.p99 !== undefined) return fmt(th.p99);
    if (th.ccdf && (key === "p50" || key === "p999")) {
      const q = key === "p50" ? 0.5 : 0.999;
      let lo = 0;
      let hi = 1;
      while (th.ccdf(hi) > 1 - q) hi *= 2;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (th.ccdf(mid) > 1 - q) lo = mid;
        else hi = mid;
      }
      return fmt((lo + hi) / 2);
    }
    return "";
  };
  const rows = ROWS.map(({ key, label }) => {
    const s = spread(d.point.runs, key);
    return `<tr><th scope="row">${label}</th><td>${fmt(s.mid)}</td><td class="ql-range">${fmt(s.lo)} to ${fmt(s.hi)}</td>${th ? `<td>${exact(key)}</td>` : ""}</tr>`;
  });
  const head = `<tr><th></th><th scope="col">Simulated</th><th scope="col">Seed range</th>${th ? `<th scope="col">${th.model} exact</th>` : ""}</tr>`;
  return `<table class="ql-table"><thead>${head}</thead><tbody>${rows.join("")}</tbody></table>`;
}

export function summary(config: Config, d: Detail): string {
  const mean = spread(d.point.runs, "mean").mid;
  const p99 = spread(d.point.runs, "p99").mid;
  const busy = config.servers === 1 ? "The server is" : "Each server is";
  return `${busy} busy ${Math.round(config.rho * 100)}% of the time. The average job takes <strong>${fmt(mean)}</strong> mean service times from arrival to finish, and one in a hundred takes longer than <strong>${fmt(p99)}</strong>.`;
}

// ---- whole figure -------------------------------------------------------------------

export interface Props {
  servers?: number;
  policy?: string;
  dist?: string;
  rho?: number;
  seed?: number;
}

export function configFrom(props: Props): { config: Config; seed: number } {
  const servers = SERVER_COUNTS.includes(Number(props.servers)) ? Number(props.servers) : 1;
  const policy = (props.policy && props.policy in POLICIES ? props.policy : "shared") as Policy;
  const dist = (props.dist && props.dist in DISTS ? props.dist : "exp") as Dist;
  const rho = typeof props.rho === "number" ? Math.min(Math.max(props.rho, 0.05), 0.95) : 0.8;
  const seed = typeof props.seed === "number" ? props.seed : 1;
  return { config: { servers, policy, dist, rho }, seed };
}

export const rhoLabel = (rho: number): string => rho.toFixed(2);

export function sweep(config: Config, seed: number): Point[] {
  return SWEEP_RHOS.map((rho, i) => runPoint(config, rho, seed + 1000 * (i + 1)));
}

const options = (rec: Record<string, { label: string }>, chosen: string) =>
  Object.entries(rec)
    .map(([k, v]) => `<option value="${k}"${k === chosen ? " selected" : ""}>${esc(v.label)}</option>`)
    .join("");

export function render(props: Props): string {
  const { config, seed } = configFrom(props);
  const points = sweep(config, seed);
  const d = runDetail(config, seed);
  const serverButtons = SERVER_COUNTS.map(
    (c) => `<label class="ql-seg"><input type="radio" name="servers" value="${c}"${c === config.servers ? " checked" : ""} disabled><span>${c}</span></label>`,
  ).join("");
  return [
    `<figure class="ql" data-config="${esc(JSON.stringify(config))}" data-seed="${seed}">`,
    `<div class="ql-controls">`,
    `<label class="ql-slider"><span>Load ρ <output name="rho-out">${rhoLabel(config.rho)}</output></span><input type="range" name="rho" min="0.05" max="0.95" step="0.01" value="${config.rho}" disabled></label>`,
    `<fieldset class="ql-servers"><legend>Servers</legend><div class="ql-segs">${serverButtons}</div></fieldset>`,
    `<label class="ql-select"><span>Dispatch</span><select name="policy" disabled>${options(POLICIES, config.policy)}</select></label>`,
    `<label class="ql-select"><span>Service time</span><select name="dist" disabled>${options(DISTS, config.dist)}</select></label>`,
    `</div>`,
    `<div class="ql-stage"><canvas class="ql-anim" width="640" height="150" aria-label="Animation of the simulated queues: one column per server, with the job in service at the bottom and waiting jobs stacked above it."></canvas>`,
    `<div class="ql-stage-bar"><button type="button" name="play" disabled>Play</button><span class="ql-clock" data-part="clock">Animation runs once the page's script loads.</span></div></div>`,
    `<div class="ql-legend" aria-hidden="true"><span class="ql-key ql-mean">● mean</span><span class="ql-key ql-p99">■ p99</span><span class="ql-key">- - exact, where a formula exists</span><span class="ql-key ql-key-ghost" data-part="ghost-key" hidden></span></div>`,
    `<div class="ql-plot" data-part="chart">${loadChart(config, points)}</div>`,
    `<p class="ql-status" data-part="status" aria-live="polite">Response time in mean service times, on a log scale. Each point is the average of ${SEEDS} runs with different seeds; the bar spans them.</p>`,
    `<div class="ql-detail">`,
    `<div class="ql-dist"><div class="ql-subhead">Fraction of jobs slower than t, at ρ = <span data-part="rho-label">${rhoLabel(config.rho)}</span></div><div data-part="ccdf">${ccdfChart(config, d)}</div></div>`,
    `<div class="ql-nums"><p class="ql-summary" data-part="summary">${summary(config, d)}</p><div data-part="table">${table(config, d)}</div></div>`,
    `</div>`,
    `<figcaption>Simulated with Poisson arrivals and FCFS servers; times are in units of the mean service time. Dashed lines are exact results for the M/M/1, M/M/c, M/D/1 and M/G/1 cases this figure covers.</figcaption>`,
    `</figure>`,
  ].join("");
}
