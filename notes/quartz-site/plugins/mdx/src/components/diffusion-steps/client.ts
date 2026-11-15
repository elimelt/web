// Browser side of the diffusion figure. Forward mode recomputes the closed-form
// noising as the slider moves. Reverse mode fetches the trained weights when
// the figure scrolls into view, runs the sampler in the browser (yielding
// between steps so the page stays responsive), then lets the reader scrub or
// play through the stored trajectory.

import { enableControls, frameScheduler, lookup, prefersReducedMotion, whenVisible } from "../../shared/dom";
import { num } from "../../shared/format";
import { gaussians, loadNet, noised, sampler, schedule, timesteps, T, type Eta, type Net, type ScheduleName, type Trajectory, type Weights } from "./model";
import { clampPx, forwardReadout, px, py, reverseReadout } from "./render";

const nets = new Map<string, Promise<Net>>();
function fetchNet(src: string): Promise<Net> {
  let net = nets.get(src);
  if (!net) {
    net = fetch(src)
      .then((r) => {
        if (!r.ok) throw new Error(`${src}: HTTP ${r.status}`);
        return r.json() as Promise<Weights>;
      })
      .then(loadNet);
    net.catch(() => nets.delete(src));
    nets.set(src, net);
  }
  return net;
}

function place(circles: SVGCircleElement[], xy: ArrayLike<number>) {
  for (let i = 0; i < circles.length; i++) {
    circles[i].setAttribute("cx", clampPx(px(xy[2 * i])).toFixed(1));
    circles[i].setAttribute("cy", clampPx(py(xy[2 * i + 1])).toFixed(1));
  }
}

const yieldToPage = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.dfs");
  if (!figure) return () => {};
  const { part, input, output, button } = lookup(figure);
  const slider = input("t");
  const out = output("t-out");
  const play = button("play");
  const readout = part("readout");
  const xtDots = Array.from(part("xt").querySelectorAll<SVGCircleElement>("circle"));
  const ds = figure.dataset;
  const ab = schedule((ds.schedule ?? "linear") as ScheduleName);
  const seed = Number(ds.seed) || 1;
  const forward = ds.mode === "forward";
  const max = Number(slider.max);

  let alive = true;
  let anim = 0;
  const cleanups: (() => void)[] = [];

  // ---- drawing -----------------------------------------------------------
  let draw: () => void;
  let ready = forward;
  let trajectory: Trajectory | null = null;
  const x0Group = ds.show === "x0" ? part("x0") : null;
  const x0Dots = x0Group ? Array.from(x0Group.querySelectorAll<SVGCircleElement>("circle")) : [];

  if (forward) {
    const values = (ds.points ?? "").split(" ").map(Number);
    const points: number[][] = [];
    for (let i = 0; i + 1 < values.length; i += 2) points.push([values[i], values[i + 1]]);
    const eps = gaussians(2 * points.length, seed);
    draw = () => {
      const t = Number(slider.value);
      out.value = `t = ${t}`;
      place(xtDots, noised(points, eps, ab, t));
      readout.innerHTML = forwardReadout(ab, t);
    };
  } else {
    const k = Number(ds.steps) || T;
    const ts = timesteps(k);
    draw = () => {
      if (!trajectory) return;
      const done = Math.min(Number(slider.value), trajectory.states.length - 1);
      out.value = `${done.toLocaleString("en-US")} / ${k.toLocaleString("en-US")}`;
      place(xtDots, trajectory.states[done]);
      if (x0Group) {
        // The guess the network makes from the points as they are now; after
        // the last step the points themselves are the answer.
        const guess = trajectory.x0[done];
        x0Group.classList.toggle("dfs-hidden", !guess);
        if (guess) place(x0Dots, guess);
      }
      readout.innerHTML = reverseReadout(k, done, ts);
    };
  }
  const { schedule: redraw, cancel } = frameScheduler(draw);

  // ---- play --------------------------------------------------------------
  const stop = () => {
    if (anim) cancelAnimationFrame(anim);
    anim = 0;
    play.textContent = "Play";
  };
  const start = () => {
    if (!ready) return;
    let from = Number(slider.value);
    if (from >= max) from = 0;
    // Few-step samplers get time to show each step; long runs take about 5 s.
    const duration = Math.min(5000, Math.max(1600, (forward ? 4 : max) * 450));
    const t0 = performance.now() - (from / max) * duration;
    play.textContent = "Pause";
    const tick = (now: number) => {
      const value = Math.min(max, Math.round(((now - t0) / duration) * max));
      slider.value = String(value);
      draw();
      if (value >= max || !alive) return stop();
      anim = requestAnimationFrame(tick);
    };
    anim = requestAnimationFrame(tick);
  };
  const onPlay = () => (anim ? stop() : start());
  const onInput = () => {
    stop();
    redraw();
  };

  // ---- reverse mode: load the network and run the sampler ------------------
  if (!forward) {
    const k = Number(ds.steps) || T;
    const n = xtDots.length;
    const eta: Eta = ds.sampler === "ddim" ? 0 : ds.sampler === "ddpm-beta" ? "beta" : 1;
    let started = false;
    const run = async () => {
      if (started) return;
      started = true;
      readout.textContent = "Loading the trained network…";
      let net: Net;
      try {
        net = await fetchNet(ds.src ?? "");
      } catch (err) {
        readout.textContent = "The trained network didn't load, so this figure can't run.";
        console.error(err);
        started = false;
        return;
      }
      const s = sampler(net, gaussians(2 * n, seed), k, eta, ab, (step, count) => gaussians(count, (seed * 7919 + step + 1) | 0));
      const t0 = performance.now();
      let last = t0;
      while (s.step()) {
        if (!alive) return;
        if (performance.now() - last > 30) {
          const doneSteps = s.trajectory.states.length - 1;
          readout.textContent = `Running the network in your browser: step ${doneSteps.toLocaleString("en-US")} of ${k.toLocaleString("en-US")}…`;
          await yieldToPage();
          last = performance.now();
        }
      }
      trajectory = s.trajectory;
      ready = true;
      enableControls(figure);
      const ms = performance.now() - t0;
      draw();
      part("timing").textContent = `${k.toLocaleString("en-US")} network call${k === 1 ? "" : "s"} on ${n} points took ${ms < 100 ? "under 0.1" : num(ms / 1000, 1)} s in your browser.`;
      if (!prefersReducedMotion() && Number(slider.value) === 0) start();
    };
    cleanups.push(whenVisible(figure, (visible) => visible && void run()));
  } else {
    enableControls(figure);
    draw();
  }

  figure.addEventListener("input", onInput);
  play.addEventListener("click", onPlay);

  return () => {
    alive = false;
    stop();
    cancel();
    figure.removeEventListener("input", onInput);
    play.removeEventListener("click", onPlay);
    for (const c of cleanups) c();
  };
}
