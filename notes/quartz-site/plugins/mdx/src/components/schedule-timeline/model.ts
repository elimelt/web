// Exact schedules of a handful of jobs on one server, for the timeline figure.
// Every policy here is the same rule as policy-experiments/policies.py beside
// the note, written again from the rule; the tests compare the two.

export interface Job {
  arrival: number;
  size: number;
}

/** One stretch of service: job `job` ran from start to end. When several
 * jobs share the server (processor sharing), each gets a lane. */
export interface Piece {
  job: number;
  start: number;
  end: number;
  lane: number;
  lanes: number;
  /** MLFQ level the job ran at. */
  level?: number;
}

export interface Schedule {
  pieces: Piece[];
  /** Completion time of each job. */
  done: number[];
}

export const POLICIES = ["order", "fifo", "sjf", "srpt", "rr", "ps", "mlfq"] as const;
export type Policy = (typeof POLICIES)[number];

export interface Params {
  /** Round robin quantum. */
  quantum: number;
  /** MLFQ: allotment at the top level; it doubles at each level down. */
  q0: number;
  levels: number;
  /** MLFQ: move every job back to the top this often; 0 for never. */
  boost: number;
}

export const DEFAULTS: Params = { quantum: 1, q0: 1, levels: 3, boost: 0 };

const EPS = 1e-9;

function byArrival(jobs: Job[]): number[] {
  return jobs.map((_, i) => i).sort((a, b) => jobs[a].arrival - jobs[b].arrival || a - b);
}

/** Appends a piece, merging it into the previous one when it continues it. */
function push(pieces: Piece[], p: Piece): void {
  if (p.end - p.start <= EPS) return;
  for (let k = pieces.length - 1; k >= 0; k--) {
    const q = pieces[k];
    if (q.end < p.start - EPS) break;
    if (q.job === p.job && Math.abs(q.end - p.start) <= EPS && q.lane === p.lane && q.lanes === p.lanes && q.level === p.level) {
      q.end = p.end;
      return;
    }
  }
  pieces.push(p);
}

/** Non-preemptive, in the given order of job indices, each job no earlier than its arrival. */
function inOrder(jobs: Job[], order: number[]): Schedule {
  const done = new Array<number>(jobs.length).fill(0);
  const pieces: Piece[] = [];
  let now = 0;
  for (const j of order) {
    const start = Math.max(now, jobs[j].arrival);
    now = start + jobs[j].size;
    done[j] = now;
    push(pieces, { job: j, start, end: now, lane: 0, lanes: 1 });
  }
  return { pieces, done };
}

function sjf(jobs: Job[]): Schedule {
  const n = jobs.length;
  const left = new Set(jobs.map((_, i) => i));
  const order: number[] = [];
  let now = 0;
  while (left.size) {
    let ready = [...left].filter((j) => jobs[j].arrival <= now + EPS);
    if (!ready.length) {
      now = Math.min(...[...left].map((j) => jobs[j].arrival));
      ready = [...left].filter((j) => jobs[j].arrival <= now + EPS);
    }
    const j = ready.reduce((a, b) => (jobs[b].size < jobs[a].size - EPS || (Math.abs(jobs[b].size - jobs[a].size) <= EPS && (jobs[b].arrival < jobs[a].arrival || (jobs[b].arrival === jobs[a].arrival && b < a))) ? b : a));
    order.push(j);
    left.delete(j);
    now = Math.max(now, jobs[j].arrival) + jobs[j].size;
  }
  return n ? inOrder(jobs, order) : { pieces: [], done: [] };
}

/** Preemptive; whoever has the least remaining work runs (ties: earlier arrival, then index). */
function srpt(jobs: Job[]): Schedule {
  const n = jobs.length;
  const rem = jobs.map((j) => j.size);
  const done = new Array<number>(n).fill(0);
  const pieces: Piece[] = [];
  const arrivals = [...new Set(jobs.map((j) => j.arrival))].sort((a, b) => a - b);
  let now = 0;
  let finished = 0;
  while (finished < n) {
    const live = jobs.map((_, i) => i).filter((i) => jobs[i].arrival <= now + EPS && rem[i] > EPS);
    const next = arrivals.find((t) => t > now + EPS) ?? Infinity;
    if (!live.length) {
      now = next;
      continue;
    }
    const j = live.reduce((a, b) => (rem[b] < rem[a] - EPS || (Math.abs(rem[b] - rem[a]) <= EPS && (jobs[b].arrival < jobs[a].arrival || (jobs[b].arrival === jobs[a].arrival && b < a))) ? b : a));
    const end = Math.min(now + rem[j], next);
    push(pieces, { job: j, start: now, end, lane: 0, lanes: 1 });
    rem[j] -= end - now;
    now = end;
    if (rem[j] <= EPS) {
      rem[j] = 0;
      done[j] = now;
      finished++;
    }
  }
  return { pieces, done };
}

/** Processor sharing: every job present gets an equal share of the server. */
function ps(jobs: Job[]): Schedule {
  const n = jobs.length;
  const rem = jobs.map((j) => j.size);
  const done = new Array<number>(n).fill(0);
  const pieces: Piece[] = [];
  const arrivals = [...new Set(jobs.map((j) => j.arrival))].sort((a, b) => a - b);
  let now = 0;
  let finished = 0;
  while (finished < n) {
    const live = jobs.map((_, i) => i).filter((i) => jobs[i].arrival <= now + EPS && rem[i] > EPS);
    const next = arrivals.find((t) => t > now + EPS) ?? Infinity;
    if (!live.length) {
      now = next;
      continue;
    }
    const m = live.length;
    const least = Math.min(...live.map((i) => rem[i]));
    const end = Math.min(now + least * m, next);
    live.forEach((j, lane) => push(pieces, { job: j, start: now, end, lane, lanes: m }));
    for (const j of live) {
      rem[j] -= (end - now) / m;
      if (rem[j] <= EPS) {
        rem[j] = 0;
        done[j] = end;
        finished++;
      }
    }
    now = end;
  }
  return { pieces, done };
}

/** Round robin. A job that arrives during a slice queues ahead of the job the slice preempts. */
function rr(jobs: Job[], quantum: number): Schedule {
  const n = jobs.length;
  const rem = jobs.map((j) => j.size);
  const done = new Array<number>(n).fill(0);
  const pieces: Piece[] = [];
  const order = byArrival(jobs);
  const queue: number[] = [];
  let now = 0;
  let i = 0;
  const admit = () => {
    while (i < n && jobs[order[i]].arrival <= now + EPS) queue.push(order[i++]);
  };
  while (i < n || queue.length) {
    if (!queue.length) now = Math.max(now, jobs[order[i]].arrival);
    admit();
    const j = queue.shift()!;
    const run = Math.min(quantum, rem[j]);
    push(pieces, { job: j, start: now, end: now + run, lane: 0, lanes: 1 });
    now += run;
    rem[j] -= run;
    admit();
    if (rem[j] <= EPS) done[j] = now;
    else queue.push(j);
  }
  return { pieces, done };
}

/** Multi-level feedback queue with CPU-bound jobs, following OSTEP's five rules. */
function mlfq(jobs: Job[], p: Params): Schedule {
  const n = jobs.length;
  const quanta = Array.from({ length: p.levels }, (_, k) => p.q0 * 2 ** k);
  const rem = jobs.map((j) => j.size);
  const left = new Array<number>(n).fill(0);
  const done = new Array<number>(n).fill(0);
  const pieces: Piece[] = [];
  const qs: number[][] = quanta.map(() => []);
  const order = byArrival(jobs);
  let now = 0;
  let i = 0;
  let present = 0;
  let nextBoost = p.boost > 0 ? p.boost : Infinity;
  while (i < n || present) {
    if (!present) {
      now = Math.max(now, jobs[order[i]].arrival);
      while (nextBoost <= now + EPS) nextBoost += p.boost;
    }
    while (i < n && jobs[order[i]].arrival <= now + EPS) {
      const j = order[i++];
      qs[0].push(j);
      left[j] = quanta[0];
      present++;
    }
    const k = qs.findIndex((q) => q.length > 0);
    const j = qs[k][0];
    const next = i < n ? jobs[order[i]].arrival : Infinity;
    const end = now + Math.min(rem[j], left[j]);
    const stop = Math.min(end, nextBoost, k > 0 ? next : end);
    push(pieces, { job: j, start: now, end: stop, lane: 0, lanes: 1, level: k });
    rem[j] -= stop - now;
    left[j] -= stop - now;
    now = stop;
    if (rem[j] <= EPS) {
      qs[k].shift();
      done[j] = now;
      present--;
    } else if (left[j] <= EPS) {
      qs[k].shift();
      const nk = Math.min(k + 1, p.levels - 1);
      left[j] = quanta[nk];
      qs[nk].push(j);
    }
    if (now >= nextBoost - EPS) {
      const all = qs.flat();
      for (const q of qs) q.length = 0;
      qs[0].push(...all);
      for (const x of all) left[x] = quanta[0];
      nextBoost += p.boost;
    }
  }
  return { pieces, done };
}

export function simulate(policy: Policy, jobs: Job[], params: Partial<Params> = {}, order?: number[]): Schedule {
  const p = { ...DEFAULTS, ...params };
  switch (policy) {
    case "order":
      return inOrder(jobs, order ?? jobs.map((_, i) => i));
    case "fifo":
      return inOrder(jobs, byArrival(jobs));
    case "sjf":
      return sjf(jobs);
    case "srpt":
      return srpt(jobs);
    case "rr":
      return rr(jobs, p.quantum);
    case "ps":
      return ps(jobs);
    case "mlfq":
      return mlfq(jobs, p);
  }
}

/** Mean response time (completion minus arrival). */
export function meanResponse(jobs: Job[], s: Schedule): number {
  return jobs.reduce((t, j, i) => t + s.done[i] - j.arrival, 0) / Math.max(jobs.length, 1);
}

/** Parses "0:8, 0:4, 0:1" (arrival:size per job). */
export function parseJobs(text: string): Job[] {
  return text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const [a, s] = t.split(":").map(Number);
      return { arrival: a, size: s };
    })
    .filter((j) => Number.isFinite(j.arrival) && Number.isFinite(j.size) && j.size > 0 && j.arrival >= 0);
}

/** Change in the sum of completion times when adjacent jobs at positions k
 * and k+1 of a back-to-back order swap: the first job's size leaves the
 * second's completion and the second's enters the first's. */
export function swapDelta(jobs: Job[], order: number[], k: number): number {
  return jobs[order[k + 1]].size - jobs[order[k]].size;
}

export const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
