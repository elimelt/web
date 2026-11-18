// Preemptive uniprocessor scheduling of periodic tasks in discrete time:
// rate monotonic (fixed priority by period) and earliest deadline first, with
// implicit deadlines (D = T), synchronous release at t = 0, and late jobs run
// to completion. Also the schedulability tests the figure reports: the
// utilization, the Liu-Layland bound, the hyperbolic bound and response-time
// analysis. Checked against rt-experiments/tick_sim.py by the tests.

export interface Task {
  c: number;
  t: number;
}

export type Policy = "rm" | "edf";

export interface Job {
  task: number;
  k: number;
  release: number;
  deadline: number;
  /** End of the tick in which the job finished, or null if it had not finished by the horizon. */
  finish: number | null;
}

export interface Run {
  /** The task that ran in each tick, or -1 for an idle tick. */
  schedule: number[];
  jobs: Job[];
  /** Jobs that finished after their deadline, or whose deadline passed unfinished within the horizon. */
  misses: Job[];
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
export const lcm = (a: number, b: number): number => (a / gcd(a, b)) * b;
export const hyperperiod = (tasks: Task[]): number => tasks.reduce((h, x) => lcm(h, x.t), 1);
export const utilization = (tasks: Task[]): number => tasks.reduce((u, x) => u + x.c / x.t, 0);
export const llBound = (n: number): number => n * (2 ** (1 / n) - 1);
/** Bini, Buttazzo and Buttazzo's hyperbolic bound: the product of (U_i + 1). */
export const hyperbolicProduct = (tasks: Task[]): number => tasks.reduce((p, x) => p * (x.c / x.t + 1), 1);

/** Rate-monotonic priority order: shorter period first, ties by index. */
export function rmOrder(tasks: Task[]): number[] {
  return tasks.map((_, i) => i).sort((a, b) => tasks[a].t - tasks[b].t || a - b);
}

export function simulate(tasks: Task[], policy: Policy, horizon = hyperperiod(tasks)): Run {
  const rank = new Map(rmOrder(tasks).map((i, r) => [i, r]));
  const jobs: (Job & { left: number })[] = [];
  const schedule: number[] = [];
  for (let now = 0; now < horizon; now++) {
    tasks.forEach((x, i) => {
      if (now % x.t === 0) jobs.push({ task: i, k: now / x.t, release: now, deadline: now + x.t, finish: null, left: x.c });
    });
    let best: (typeof jobs)[number] | null = null;
    for (const j of jobs) {
      if (j.left <= 0) continue;
      if (!best) best = j;
      else if (policy === "rm") {
        const a = rank.get(j.task)!;
        const b = rank.get(best.task)!;
        if (a < b || (a === b && j.k < best.k)) best = j;
      } else if (j.deadline < best.deadline || (j.deadline === best.deadline && (j.release < best.release || (j.release === best.release && j.task < best.task)))) best = j;
    }
    if (!best) {
      schedule.push(-1);
      continue;
    }
    schedule.push(best.task);
    best.left -= 1;
    if (best.left === 0) best.finish = now + 1;
  }
  const out: Job[] = jobs.map(({ left: _left, ...j }) => j);
  const misses = out.filter((j) => (j.finish === null ? j.deadline <= horizon : j.finish > j.deadline));
  return { schedule, jobs: out, misses };
}

export interface Rta {
  /** R_i^(0) = C_i, then each iterate of the recurrence until it repeats or exceeds T_i. */
  iterates: number[];
  ok: boolean;
}

/** Response-time analysis (Joseph and Pandya 1986) for rate-monotonic priorities, D = T. */
export function rta(tasks: Task[]): Rta[] {
  const order = rmOrder(tasks);
  const out: Rta[] = new Array(tasks.length);
  order.forEach((i, pos) => {
    const { c, t } = tasks[i];
    const hp = order.slice(0, pos).map((j) => tasks[j]);
    let r = c;
    const iterates = [c];
    for (;;) {
      const next = c + hp.reduce((s, x) => s + Math.ceil(r / x.t) * x.c, 0);
      if (next > t) {
        iterates.push(next);
        out[i] = { iterates, ok: false };
        break;
      }
      if (next === r) {
        out[i] = { iterates, ok: true };
        break;
      }
      iterates.push(next);
      r = next;
    }
  });
  return out;
}

/** Parses "2:5, 4:7" into tasks (C:T). */
export function parseTasks(text: string): Task[] {
  return text
    .split(",")
    .map((s) => s.trim().split(":").map(Number))
    .filter(([c, t]) => Number.isInteger(c) && Number.isInteger(t) && c >= 1 && t >= 1 && c <= t)
    .map(([c, t]) => ({ c, t }));
}
