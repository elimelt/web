// Recorded results from policy-experiments/run_trace.py (aggregated by
// aggregate.py): mean slowdown of the jobs in each size-percentile bucket,
// with the mean, min and max over five seeds, for each policy and load. The
// figure only replays these numbers; nothing here simulates.

import data from "../../../../../../content/systems/scheduling/1-single-resource/policy-experiments/slowdown_by_size.json";

export interface Bucket {
  pct: [number, number];
  /** Smallest and largest job size in the bucket, in seconds. */
  size: [number, number];
}

export type Series = [number, number, number][];

export const BUCKETS = data.buckets as Bucket[];
export const LOADS = Object.keys(data.loads).sort();
const loads = data.loads as Record<string, Record<string, Series>>;

export const NAMES: Record<string, string> = {
  fifo: "FIFO",
  sjf: "SJF",
  srpt: "SRPT",
  ps: "PS",
  fb: "FB",
  mlfq: "MLFQ, 8 levels",
  mlfq16: "MLFQ, 16 levels",
  mlfq_boost1s: "MLFQ, boost every 1 s",
  srpt_est1: "SRPT on estimates",
  srpt_bounce1: "SRPT-Bounce on estimates",
};

export function series(load: string, policy: string): Series | undefined {
  return loads[load]?.[policy];
}

/** Every policy the data has at every load. */
export const POLICIES = Object.keys(NAMES).filter((p) => LOADS.every((l) => series(l, p)));

/** The largest value any of these policies reaches at any load, so the y axis stays put when the load changes. */
export function ceiling(policies: string[]): number {
  let hi = 1;
  for (const l of LOADS) for (const p of policies) for (const [, , max] of series(l, p) ?? []) hi = Math.max(hi, max);
  return 10 ** Math.ceil(Math.log10(hi) + 1e-9);
}
