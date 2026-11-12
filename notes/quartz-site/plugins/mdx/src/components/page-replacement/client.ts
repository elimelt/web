// Browser side of the page replacement figure. The page already holds the
// controls and the fault curves; this loads the selected reference string,
// draws where each policy's faults fall, and steps through it.

import { BELADY, curve, makeSim, nextUses, POLICIES, run, type Policy, type Sim, type Step } from "./model";
import { curveSvg, defaultFrames, describe, framesLabel, knownMeta, legend, stepPanel, TRACE_KEYS, type Meta, type TraceKey } from "./render";

interface Loaded {
  meta: Meta;
  trace: Uint16Array;
  next: Int32Array;
}

async function fetchTrace(url: string): Promise<Uint16Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  let bytes = new Uint8Array(await res.arrayBuffer());
  // Some servers decompress .gz files on the way, so only inflate real gzip data.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
}

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.pr");
  if (!figure) return () => {};
  const base = figure.dataset.base ?? "";
  const part = (name: string) => figure.querySelector<HTMLElement>(`[data-part="${name}"]`)!;
  const slider = figure.querySelector<HTMLInputElement>('input[name="frames"]')!;
  const out = figure.querySelector<HTMLOutputElement>('output[name="frames-out"]')!;
  const canvas = part("map").querySelector("canvas")!;
  const cache = new Map<TraceKey, Promise<Loaded>>();
  let key = (figure.dataset.trace as TraceKey) ?? "gzip9";
  let data: Loaded | undefined;
  let frames = Number(slider.value);
  let focus: Policy = "lru";
  let t = 0;
  let sims: Record<Policy, Sim> | undefined;
  let steps: Record<Policy, Step> | undefined;
  let faulted: Uint8Array | undefined;
  let density: { cols: number; rows: number; counts: Uint32Array } | undefined;
  let frame = 0;
  let alive = true;

  const load = (k: TraceKey): Promise<Loaded> => {
    let p = cache.get(k);
    if (!p) {
      p = (async () => {
        if (k === "belady") {
          const next = nextUses(BELADY);
          const curves = Object.fromEntries(POLICIES.map((q) => [q, curve(BELADY, next, q, 5)])) as Record<Policy, number[]>;
          return { meta: knownMeta(k, curves), trace: BELADY, next };
        }
        const trace = await fetchTrace(`${base}${k}.u16.gz`);
        return { meta: knownMeta(k), trace, next: nextUses(trace) };
      })();
      cache.set(k, p);
    }
    return p;
  };

  const colors = () => {
    const css = getComputedStyle(figure);
    const get = (n: string) => css.getPropertyValue(n).trim();
    return { ink: get("--pr-ink") || "#888", cursor: get("--pr-cursor") || "#e34948", policy: get(`--pr-${focus}`) || "#2a78d6" };
  };

  /** Simulate every policy from the start through reference `to`. */
  const goto = (to: number) => {
    if (!data) return;
    t = Math.max(0, Math.min(data.meta.refs - 1, to));
    sims = Object.fromEntries(POLICIES.map((p) => [p, makeSim(p, frames, data!.next)])) as Record<Policy, Sim>;
    const s = {} as Record<Policy, Step>;
    for (let i = 0; i <= t; i++) for (const p of POLICIES) s[p] = sims[p].step(i, data.trace[i]);
    steps = s;
  };
  const forward = (): boolean => {
    if (!data || !sims || t + 1 >= data.meta.refs) return false;
    t++;
    const s = {} as Record<Policy, Step>;
    for (const p of POLICIES) s[p] = sims[p].step(t, data.trace[t]);
    steps = s;
    return true;
  };

  const sizeCanvas = () => {
    const width = Math.max(200, Math.round(canvas.parentElement!.clientWidth));
    const height = data?.meta.key === "belady" ? 110 : 170;
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    if (data) {
      const cols = Math.min(data.meta.refs, Math.round(width));
      const rows = Math.min(data.meta.pages, Math.round(height / 2));
      const counts = new Uint32Array(cols * rows);
      const { trace, meta } = data;
      for (let i = 0; i < trace.length; i++) counts[Math.floor((trace[i] * rows) / meta.pages) * cols + Math.floor((i * cols) / meta.refs)]++;
      density = { cols, rows, counts };
    }
  };

  const drawMap = () => {
    const ctx = canvas.getContext("2d");
    if (!ctx || !data || !density) return;
    const { cols, rows, counts } = density;
    const { trace, meta } = data;
    const cw = canvas.width / cols;
    const rh = canvas.height / rows;
    const c = colors();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let max = 0;
    for (const v of counts) if (v > max) max = v;
    ctx.fillStyle = c.ink;
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < cols; k++) {
        const v = counts[r * cols + k];
        if (!v) continue;
        ctx.globalAlpha = 0.15 + 0.45 * Math.sqrt(v / max);
        ctx.fillRect(k * cw, r * rh, Math.max(cw, 1), Math.max(rh, 1));
      }
    }
    if (faulted) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = c.policy;
      const seen = new Uint8Array(cols * rows);
      for (let i = 0; i < trace.length; i++) {
        if (!faulted[i]) continue;
        const b = Math.floor((trace[i] * rows) / meta.pages) * cols + Math.floor((i * cols) / meta.refs);
        if (seen[b]) continue;
        seen[b] = 1;
        const k = b % cols;
        const r = (b - k) / cols;
        ctx.fillRect(k * cw, r * rh, Math.max(cw, 1.5), Math.max(rh, 1.5));
      }
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = c.cursor;
    ctx.lineWidth = Math.max(1, window.devicePixelRatio || 1);
    const x = ((t + 0.5) / meta.refs) * canvas.width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  };

  const drawStep = () => {
    if (!data || !sims || !steps) return;
    const faultsSoFar = Object.fromEntries(POLICIES.map((p) => [p, sims![p].faults])) as Record<Policy, number>;
    part("step").innerHTML = stepPanel({ meta: data.meta, trace: data.trace, t, frames, focus, steps, sims, faultsSoFar });
  };

  const drawCurves = () => {
    if (!data) return;
    part("curve").innerHTML = curveSvg(data.meta, frames);
    part("legend").innerHTML = legend(data.meta, frames);
    out.value = framesLabel(data.meta, frames);
  };

  const recompute = () => {
    if (!data) return;
    faulted = run(data.trace, data.next, focus, frames).faulted;
  };

  /** The first reference where the focused policy has to evict something. */
  const firstEviction = (): number => {
    if (!data) return 0;
    const sim = makeSim(focus, frames, data.next);
    for (let i = 0; i < data.trace.length; i++) if (sim.step(i, data.trace[i]).victim >= 0) return i;
    return 0;
  };

  const schedule = () => {
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        drawCurves();
        drawMap();
        drawStep();
      });
  };

  const selectTrace = async (k: TraceKey) => {
    key = k;
    for (const b of figure.querySelectorAll<HTMLButtonElement>('button[name="trace"]')) b.setAttribute("aria-pressed", String(b.value === k));
    part("step").innerHTML = `<p class="pr-dim">Loading the reference string…</p>`;
    let loaded: Loaded;
    try {
      loaded = await load(k);
    } catch (e) {
      part("step").innerHTML = `<p class="pr-dim">Couldn't load this trace (${String(e)}).</p>`;
      return;
    }
    if (!alive || key !== k) return;
    data = loaded;
    part("desc").textContent = describe(data.meta);
    slider.max = String(data.meta.pages);
    frames = defaultFrames(data.meta);
    slider.value = String(frames);
    sizeCanvas();
    recompute();
    goto(firstEviction());
    schedule();
  };

  const onClick = (e: Event) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b || b.disabled) return;
    if (b.name === "trace" && TRACE_KEYS.includes(b.value as TraceKey)) void selectTrace(b.value as TraceKey);
    else if (b.name === "focus") {
      focus = b.value as Policy;
      for (const x of figure.querySelectorAll<HTMLButtonElement>('button[name="focus"]')) x.setAttribute("aria-pressed", String(x.value === focus));
      recompute();
      schedule();
    } else if (b.name === "step") {
      if (b.value === "1") forward();
      else goto(t - 1);
      schedule();
    } else if (b.name === "next-fault") {
      while (forward() && steps![focus].hit);
      schedule();
    }
  };
  const onInput = () => {
    if (!data) return;
    frames = Number(slider.value);
    recompute();
    goto(t);
    schedule();
  };
  const onMapClick = (e: MouseEvent) => {
    if (!data) return;
    const rect = canvas.getBoundingClientRect();
    goto(Math.floor(((e.clientX - rect.left) / rect.width) * data.meta.refs));
    schedule();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") forward();
    else if (e.key === "ArrowLeft") goto(t - 1);
    else return;
    e.preventDefault();
    schedule();
  };
  const resize = new ResizeObserver(() => {
    sizeCanvas();
    schedule();
  });

  figure.addEventListener("click", onClick);
  slider.addEventListener("input", onInput);
  canvas.addEventListener("click", onMapClick);
  canvas.addEventListener("keydown", onKey);
  resize.observe(part("map"));
  for (const c of figure.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button")) c.disabled = false;
  void selectTrace(key);

  return () => {
    alive = false;
    figure.removeEventListener("click", onClick);
    slider.removeEventListener("input", onInput);
    canvas.removeEventListener("click", onMapClick);
    canvas.removeEventListener("keydown", onKey);
    resize.disconnect();
    if (frame) cancelAnimationFrame(frame);
  };
}
