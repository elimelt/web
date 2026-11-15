// Browser side of the KV allocation figure. The page already holds the build's
// replay of the default allocator; this fetches the trace slices once the
// figure nears the viewport, then re-runs the allocator the reader picks and
// steps the memory map through the replay.

import { enableControls, frameScheduler, lookup } from "../../shared/dom";
import { chartSvg, mapSvg, nowText, summaryText, type Slices, type TraceKey, type View } from "./draw";
import { config, run, Sim, type Kind, type Run } from "./model";

let pending: Promise<Slices> | undefined;
const fetchSlices = (src: string): Promise<Slices> => {
  if (!pending) {
    pending = fetch(src).then((r) => {
      if (!r.ok) throw new Error(`${src}: ${r.status}`);
      return r.json() as Promise<Slices>;
    });
    pending.catch(() => (pending = undefined));
  }
  return pending;
};

export function mount(root: HTMLElement): () => void {
  const fig = root.querySelector<HTMLElement>("figure.kva");
  if (!fig) return () => {};
  const { part, input, button } = lookup(fig);
  const slider = input("t");
  const play = button("play");
  const blockSel = fig.querySelector<HTMLSelectElement>('select[name="block"]')!;
  const v: View = {
    kind: (fig.dataset.kind as Kind) ?? "max",
    trace: (fig.dataset.trace as TraceKey) ?? "conv",
    block: Number(fig.dataset.block ?? 16),
    t: Number(slider.value),
  };
  let data: Slices | undefined;
  let current: Run | undefined;
  let sim: Sim | undefined;
  let playing = false;
  let raf = 0;
  let alive = true;
  const runs = new Map<string, Run>();

  const reqs = () => data![v.trace];
  const cfg = () => config(v.kind, v.block);
  const generated = () => reqs().reduce((a, [, g]) => a + g, 0);

  /** Brings `sim` to the end of iteration v.t, replaying from the start only when moving back. */
  const seek = () => {
    if (!sim || sim.iteration > v.t) sim = new Sim(reqs(), cfg());
    while (sim.iteration < v.t && !sim.done) sim.step();
  };

  const draw = () => {
    if (!current || !sim) return;
    const b = cfg().budget;
    part("map").innerHTML = mapSvg(sim, b);
    part("chart").innerHTML = chartSvg(current.samples, b, v.t);
    part("now").innerHTML = nowText(sim.last, v.t, current.samples.length, sim, b);
  };
  const { schedule, cancel } = frameScheduler(draw);

  const sync = () => {
    for (const el of fig.querySelectorAll<HTMLButtonElement>('button[name="kind"]')) el.setAttribute("aria-pressed", String(el.value === v.kind));
    for (const el of fig.querySelectorAll<HTMLButtonElement>('button[name="trace"]')) el.setAttribute("aria-pressed", String(el.value === v.trace));
    blockSel.disabled = v.kind !== "paged";
    blockSel.value = String(v.block);
  };

  const recompute = () => {
    if (!data) return;
    const key = `${v.trace}/${v.kind}/${v.block}`;
    let r = runs.get(key);
    if (!r) {
      r = run(reqs(), cfg());
      runs.set(key, r);
    }
    current = r;
    const n = r.samples.length;
    slider.max = String(n);
    v.t = Math.max(1, Math.min(n, v.t));
    slider.value = String(v.t);
    sim = undefined;
    seek();
    part("summary").innerHTML = summaryText(r.summary, v.kind, generated());
    sync();
    schedule();
  };

  const setPlaying = (on: boolean) => {
    playing = on;
    play.textContent = on ? "Pause" : "Play";
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (!on || !current) return;
    const n = current.samples.length;
    if (v.t >= n) {
      v.t = 1;
      sim = undefined;
    }
    const stride = Math.max(1, Math.round(n / 900));
    const tick = () => {
      if (!alive || !playing || !current) return;
      v.t = Math.min(n, v.t + stride);
      slider.value = String(v.t);
      seek();
      draw();
      if (v.t >= n) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };

  const onClick = (e: Event) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b || b.disabled || !fig.contains(b)) return;
    if (b === play) setPlaying(!playing);
    else if (b.name === "kind") {
      v.kind = b.value as Kind;
      recompute();
    } else if (b.name === "trace") {
      v.trace = b.value as TraceKey;
      recompute();
    }
  };
  const onBlock = () => {
    v.block = Number(blockSel.value);
    recompute();
  };
  const onSlide = () => {
    v.t = Number(slider.value);
    seek();
    schedule();
  };

  fig.addEventListener("click", onClick);
  blockSel.addEventListener("change", onBlock);
  slider.addEventListener("input", onSlide);

  // Load the slices only when the figure comes near the viewport.
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      fetchSlices(fig.dataset.src ?? "")
        .then((d) => {
          if (!alive) return;
          data = d;
          enableControls(fig);
          recompute();
        })
        .catch((err) => {
          part("now").textContent = `The trace slice did not load (${String(err)}).`;
        });
    },
    { rootMargin: "300px" },
  );
  observer.observe(fig);

  return () => {
    alive = false;
    observer.disconnect();
    cancel();
    if (raf) cancelAnimationFrame(raf);
    fig.removeEventListener("click", onClick);
    blockSel.removeEventListener("change", onBlock);
    slider.removeEventListener("input", onSlide);
  };
}
