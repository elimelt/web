// Browser side of the queue-lab figure. The page already holds the charts the
// build rendered. This enables the controls, reruns the simulations when they
// change (in slices, so the page stays responsive), and animates the queues
// with the same Simulator that produced the numbers.

import { detail, point, Simulator, SWEEP_RHOS, BIMODAL_LONG, type Config, type Detail, type Dist, type Job, type Point, type Policy } from "./model";
import { ccdfChart, describe, loadChart, rhoLabel, rhoX, summary, table, type Ghost } from "./render";

const SPEED = 4; // mean service times per second of animation

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.ql");
  if (!figure) return () => {};
  const seed = Number(figure.dataset.seed) || 1;
  const config: Config = JSON.parse(figure.dataset.config ?? "{}");
  const q = <T extends Element>(sel: string) => figure.querySelector<T>(sel)!;
  const part = (name: string) => q<HTMLElement>(`[data-part="${name}"]`);
  const rhoInput = q<HTMLInputElement>('input[name="rho"]');
  const policySelect = q<HTMLSelectElement>('select[name="policy"]');
  const distSelect = q<HTMLSelectElement>('select[name="dist"]');
  const playButton = q<HTMLButtonElement>('button[name="play"]');
  const canvas = q<HTMLCanvasElement>("canvas.ql-anim");
  const ctx = canvas.getContext("2d");

  let points: Point[] = [];
  let ghost: Ghost | undefined;
  // Each bumps when its inputs change, so stale work stops at its next slice.
  // Moving the load slider reruns the detail panels but leaves a sweep running.
  let sweepToken = 0;
  let detailToken = 0;
  const timers = new Set<number>();
  const later = (fn: () => void, ms = 0) => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };

  const readControls = (): { rhoOnly: boolean } => {
    const before = JSON.stringify({ ...config, rho: 0 });
    config.rho = Number(rhoInput.value);
    const checked = figure.querySelector<HTMLInputElement>('input[name="servers"]:checked');
    config.servers = Number(checked?.value ?? config.servers);
    config.policy = policySelect.value as Policy;
    config.dist = distSelect.value as Dist;
    policySelect.disabled = config.servers === 1;
    q<HTMLOutputElement>('output[name="rho-out"]').value = rhoLabel(config.rho);
    return { rhoOnly: before === JSON.stringify({ ...config, rho: 0 }) };
  };

  const drawChart = () => {
    part("chart").innerHTML = loadChart(config, points, ghost);
  };

  const status = (text: string) => {
    part("status").textContent = text;
  };

  const runDetail = (my: number) => {
    later(() => {
      if (my !== detailToken) return;
      const snapshot = { ...config };
      const d: Detail = detail(snapshot, seed);
      if (my !== detailToken) return;
      part("rho-label").textContent = rhoLabel(snapshot.rho);
      part("ccdf").innerHTML = ccdfChart(snapshot, d);
      part("summary").innerHTML = summary(snapshot, d);
      part("table").innerHTML = table(snapshot, d);
    }, 120);
  };

  const runSweep = (my: number) => {
    const snapshot = { ...config };
    const fresh: Point[] = [];
    const step = (i: number) => {
      if (my !== sweepToken) return;
      if (i === SWEEP_RHOS.length) {
        status(`Response time in mean service times, on a log scale, for ${describe(snapshot)}. Each point is the average of 3 runs with different seeds; the bar spans them.`);
        return;
      }
      fresh.push(point(snapshot, SWEEP_RHOS[i], seed + 1000 * (i + 1)));
      points = fresh.slice();
      drawChart();
      status(`Simulating load ${SWEEP_RHOS[i]}…`);
      later(() => step(i + 1));
    };
    later(() => step(0), 30);
  };

  const onChange = () => {
    const prev = { ...config };
    const prevPoints = points;
    const { rhoOnly } = readControls();
    restartAnimation();
    if (rhoOnly) {
      const marker = part("chart").querySelector(".ql-now");
      marker?.setAttribute("x1", String(rhoX(config.rho)));
      marker?.setAttribute("x2", String(rhoX(config.rho)));
    } else {
      if (prevPoints.length === SWEEP_RHOS.length) {
        ghost = { config: prev, points: prevPoints };
        const key = part("ghost-key");
        key.textContent = `faded: ${describe(prev)}`;
        key.hidden = false;
      }
      points = [];
      drawChart();
      runSweep(++sweepToken);
    }
    runDetail(++detailToken);
  };

  // ---- animation --------------------------------------------------------------

  let sim: Simulator;
  let pending: Job;
  let active: Job[] = [];
  let simTime = 0;
  let last = 0;
  let frame = 0;
  let playing = false;
  let visible = true;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function restartAnimation() {
    sim = new Simulator({ ...config }, seed + 99);
    pending = sim.next();
    active = [];
    simTime = 0;
    paint();
  }

  const colors = () => {
    const style = getComputedStyle(figure);
    return {
      job: style.getPropertyValue("--secondary").trim() || "#284b63",
      long: style.getPropertyValue("--ql-p99").trim() || "#b8550b",
      line: style.getPropertyValue("--lightgray").trim() || "#ddd",
      text: style.getPropertyValue("--gray").trim() || "#888",
    };
  };

  function paint() {
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 640;
    const cssH = canvas.clientHeight || 150;
    if (canvas.width !== Math.round(cssW * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const col = colors();
    const c = config.servers;
    const shared = c > 1 && (config.policy === "shared" || config.policy === "lwl");
    const colW = Math.min(64, cssW / c);
    const left = (cssW - colW * c) / 2;
    const box = Math.max(6, Math.min(22, colW - 6));
    const dot = Math.max(4, Math.min(10, colW - 8));
    const baseY = cssH - 6;
    const waiting: Job[][] = Array.from({ length: c }, () => []);
    const sharedQueue: Job[] = [];
    for (const job of active) {
      const x0 = left + job.server * colW + (colW - box) / 2;
      if (simTime >= job.start) {
        ctx.strokeStyle = col.line;
        ctx.strokeRect(x0 + 0.5, baseY - box + 0.5, box - 1, box - 1);
        const done = Math.min(1, (simTime - job.start) / job.size);
        ctx.fillStyle = job.size >= BIMODAL_LONG - 1e-9 && config.dist === "bimodal" ? col.long : col.job;
        const h = box * (1 - done);
        ctx.fillRect(x0, baseY - h, box, h);
      } else if (shared) sharedQueue.push(job);
      else waiting[job.server].push(job);
    }
    for (let i = 0; i < c; i++) {
      const x0 = left + i * colW + (colW - box) / 2;
      ctx.strokeStyle = col.line;
      ctx.strokeRect(x0 + 0.5, baseY - box + 0.5, box - 1, box - 1);
    }
    const room = Math.floor((baseY - box - 22) / (dot + 2));
    const label = (text: string, x: number, y: number) => {
      ctx.fillStyle = col.text;
      ctx.font = "11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(text, x, y);
    };
    if (shared) {
      sharedQueue.sort((a, b) => a.arrival - b.arrival);
      const per = Math.floor((cssW - 20) / (dot + 2));
      const shown = Math.min(sharedQueue.length, per * 2);
      for (let k = 0; k < shown; k++) {
        const row = Math.floor(k / per);
        const x = 10 + (k % per) * (dot + 2);
        const y = baseY - box - 16 - (row + 1) * (dot + 2);
        ctx.fillStyle = sharedQueue[k].size >= BIMODAL_LONG - 1e-9 && config.dist === "bimodal" ? col.long : col.job;
        ctx.fillRect(x, y, dot, dot);
      }
      if (sharedQueue.length > shown) label(`+${sharedQueue.length - shown}`, cssW - 14, baseY - box - 18);
      label(`shared queue: ${sharedQueue.length} waiting`, cssW / 2, 12);
    } else {
      let total = 0;
      for (let i = 0; i < c; i++) {
        const list = waiting[i];
        total += list.length;
        list.sort((a, b) => a.arrival - b.arrival);
        const cx = left + i * colW + colW / 2;
        const shown = Math.min(list.length, room - 1);
        for (let k = 0; k < shown; k++) {
          ctx.fillStyle = list[k].size >= BIMODAL_LONG - 1e-9 && config.dist === "bimodal" ? col.long : col.job;
          ctx.fillRect(cx - dot / 2, baseY - box - 4 - (k + 1) * (dot + 2), dot, dot);
        }
        if (list.length > shown) label(`+${list.length - shown}`, cx, baseY - box - 6 - (shown + 1) * (dot + 2));
      }
      label(c === 1 ? `${total} waiting` : `${total} waiting across ${c} queues`, cssW / 2, 12);
    }
  }

  function tick(now: number) {
    frame = 0;
    if (!playing || !visible) return;
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
    last = now;
    simTime += dt * SPEED;
    while (pending.arrival <= simTime) {
      active.push(pending);
      pending = sim.next();
    }
    active = active.filter((j) => j.finish > simTime);
    paint();
    part("clock").textContent = `Simulated time ${simTime.toFixed(0)} mean service times; ${active.length} jobs in the system.`;
    frame = requestAnimationFrame(tick);
  }

  const setPlaying = (on: boolean) => {
    playing = on;
    playButton.textContent = on ? "Pause" : "Play";
    last = 0;
    if (on && !frame) frame = requestAnimationFrame(tick);
  };

  const observer = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    last = 0;
    if (visible && playing && !frame) frame = requestAnimationFrame(tick);
  });
  observer.observe(canvas);

  const onPlay = () => setPlaying(!playing);
  playButton.addEventListener("click", onPlay);
  figure.addEventListener("change", onChange);
  rhoInput.addEventListener("input", () => {
    q<HTMLOutputElement>('output[name="rho-out"]').value = rhoLabel(Number(rhoInput.value));
  });

  for (const el of figure.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button")) el.disabled = false;
  readControls();
  // Back and forward navigation can restore earlier control values; if they
  // differ from what the build rendered, recompute everything.
  const rendered = JSON.parse(figure.dataset.config ?? "{}");
  if (JSON.stringify(rendered) !== JSON.stringify(config)) {
    runSweep(++sweepToken);
    runDetail(++detailToken);
  } else {
    // The build's points are already on the page; recompute them quietly so
    // later changes can fade them in as the comparison.
    const my = ++sweepToken;
    const fresh: Point[] = [];
    const step = (i: number) => {
      if (my !== sweepToken || i === SWEEP_RHOS.length) return;
      fresh.push(point({ ...config }, SWEEP_RHOS[i], seed + 1000 * (i + 1)));
      if (fresh.length === SWEEP_RHOS.length) points = fresh;
      later(() => step(i + 1), 10);
    };
    later(() => step(0), 300);
  }
  restartAnimation();
  part("clock").textContent = "Press Play to watch the queues.";
  if (!reduced) setPlaying(true);

  return () => {
    sweepToken++;
    detailToken++;
    playing = false;
    if (frame) cancelAnimationFrame(frame);
    for (const id of timers) clearTimeout(id);
    observer.disconnect();
    playButton.removeEventListener("click", onPlay);
    figure.removeEventListener("change", onChange);
  };
}
