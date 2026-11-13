// Data and arithmetic behind the speculative decoding figures. trace.json
// holds rounds recorded by measure.py: for every drafted position, the draft's
// and target's probabilities for the drafted token and for the tokens either
// model liked most, plus the uniform draw that decided acceptance. Nothing
// here samples; the figure replays what the models did.

import traceData from "../../../../../../content/ml/serving-systems/speculative-decoding/trace.json";
// Named imports let the bundler drop the parts of results.json the figures
// do not use (corpus and environment metadata).
import { alpha, costs, run_setup, runs } from "../../../../../../content/ml/serving-systems/speculative-decoding/results.json";

/** [token id, draft probability p, target probability q] */
export type Top = [number, number, number];

export interface Position {
  x: number;
  px: number;
  qx: number;
  u: number | null;
  top: Top[];
  /** sum over the whole vocabulary of min(p, q) at this position */
  alpha: number;
}

export interface Round {
  drafted: number[];
  accepted: number;
  emitted: number[];
  u_fix: number;
  positions: Position[];
  /** when every draft was accepted: [token, q] for the extra token's distribution */
  bonus_top?: [number, number][];
}

export interface Trace {
  prompt: number[];
  rounds: Round[];
  pieces: Record<string, string>;
}

export type Domain = "code" | "prose";
export const domains: Domain[] = ["code", "prose"];
export const domainLabel: Record<Domain, string> = { code: "Python code", prose: "Shakespeare" };

export const traces = traceData as unknown as Record<Domain, Trace>;

interface GammaRow {
  tokens_per_round: number;
  tokens_per_round_se: number;
  accept_rate: number;
  speedup: number;
  speedup_q25: number;
  speedup_q75: number;
}

interface Results {
  alpha: Record<string, { mean: number }>;
  runs: Record<string, { plain_tok_per_s: number; gamma: Record<string, GammaRow> }>;
  costs: Record<string, { target: number[]; draft: number[] }>;
  run_setup: { gammas: number[] };
}

export const results = { alpha, runs, costs, run_setup } as unknown as Results;

export const piece = (trace: Trace, id: number): string => trace.pieces[String(id)] ?? "?";

/** Acceptance test from Leviathan et al. and Chen et al.: keep x if u < min(1, q(x)/p(x)). */
export const acceptProb = (px: number, qx: number): number => Math.min(1, qx / px);
export const accepts = (pos: Position): boolean => pos.u !== null && pos.u < acceptProb(pos.px, pos.qx);

/**
 * Residual distribution after a rejection, max(q - p, 0) normalized. Its
 * total mass over the whole vocabulary is 1 - alpha, so the recorded alpha
 * gives the exact normalizer even though only the top tokens are stored.
 */
export const residual = (pos: Position, p: number, q: number): number =>
  pos.alpha < 1 ? Math.max(q - p, 0) / (1 - pos.alpha) : 0;

/** Expected tokens per target pass with i.i.d. acceptance rate alpha (Leviathan et al., eq. 1). */
export function expectedTokens(alpha: number, gamma: number): number {
  if (alpha >= 1) return gamma + 1;
  return (1 - alpha ** (gamma + 1)) / (1 - alpha);
}

/**
 * Wall-clock speedup over plain decoding when a draft step costs c target
 * steps and verifying gamma + 1 tokens costs v target steps. Leviathan et
 * al.'s theorem 3.8 is the case v = 1.
 */
export const speedup = (alpha: number, gamma: number, c: number, v = 1): number =>
  expectedTokens(alpha, gamma) / (gamma * c + v);

/** Cost ratios measured at batch size 1: c, and v for each gamma. */
export function measuredCosts(batch = "1"): { c: number; v: (gamma: number) => number } {
  const row = results.costs[batch];
  return { c: row.draft[0] / row.target[0], v: (g: number) => row.target[Math.min(g, row.target.length - 1)] / row.target[0] };
}

/** Text the reader sees before a round starts: the prompt plus every earlier round's output. */
export function tokensBefore(trace: Trace, round: number): number[] {
  const out = [...trace.prompt];
  for (let r = 0; r < round; r++) out.push(...trace.rounds[r].emitted);
  return out;
}

/** Running tokens per target pass up to and including a round. */
export function tokensPerPass(trace: Trace, round: number): number {
  let n = 0;
  for (let r = 0; r <= round; r++) n += trace.rounds[r].emitted.length;
  return n / (round + 1);
}

/** Acceptance rate seen while decoding: the share of drafts kept with one draft per round. */
export function decodingAlpha(key: string): number {
  return results.runs[key].gamma["1"].accept_rate;
}
