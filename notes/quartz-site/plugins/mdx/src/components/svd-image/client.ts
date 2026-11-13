// Browser side of the low-rank image figure. Loads the photo, decomposes it
// with the Jacobi SVD (yielding between sweeps so the page stays responsive),
// then redraws A_k and A - A_k whenever the rank changes.

import { jacobiSvd, reconstruct, shuffled, type Svd } from "./jacobi";
import { DEFAULT_K, spectrum, statsPart } from "./render";

const RESID_SCALE = 0.25;
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function paint(canvas: HTMLCanvasElement, values: ArrayLike<number>, n: number, map: (v: number) => number) {
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    const g = Math.max(0, Math.min(255, Math.round(255 * map(values[i]))));
    img.data[4 * i] = img.data[4 * i + 1] = img.data[4 * i + 2] = g;
    img.data[4 * i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

async function loadPixels(src: string): Promise<{ pixels: Float64Array; n: number }> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const n = img.naturalWidth;
  if (img.naturalHeight !== n) throw new Error("expected a square image");
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = n;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, n, n).data;
  const pixels = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) pixels[i] = data[4 * i] / 255;
  return { pixels, n };
}

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.si");
  if (!figure?.dataset.src) return () => {};
  const part = (name: string) => figure.querySelector<HTMLElement>(`[data-part="${name}"]`)!;
  const slider = figure.querySelector<HTMLInputElement>('input[name="k"]')!;
  const toggle = figure.querySelector<HTMLInputElement>('input[name="shuffle"]')!;
  const kOut = figure.querySelector<HTMLOutputElement>('output[name="k-out"]')!;
  const approxCanvas = part("approx").querySelector("canvas")!;
  const residCanvas = part("resid").querySelector("canvas")!;
  const origCanvas = document.createElement("canvas");
  let alive = true;
  let frame = 0;
  let n = 0;
  let photo: Float64Array | null = null;
  const sources: Record<"photo" | "shuffled", { pixels: Float64Array; svd?: Svd; norm2?: number; tail?: Float64Array }> = {
    photo: { pixels: new Float64Array() },
    shuffled: { pixels: new Float64Array() },
  };
  let busy: Promise<void> | null = null;
  let approx: Float64Array = new Float64Array();

  const which = (): "photo" | "shuffled" => (toggle.checked ? "shuffled" : "photo");

  const decompose = async (key: "photo" | "shuffled") => {
    const src = sources[key];
    if (src.svd) return;
    const t0 = performance.now();
    const label = key === "photo" ? "the photo" : "the shuffled pixels";
    part("status").textContent = `Decomposing ${label} (${n} × ${n}) in your browser…`;
    src.svd = await jacobiSvd(src.pixels, n, n, async (sweep, rotations) => {
      part("status").textContent = `Decomposing ${label}: sweep ${sweep}, ${rotations.toLocaleString("en-US")} column pairs rotated…`;
      await nextFrame();
      if (!alive) throw new Error("unmounted");
    });
    const s = src.svd.s;
    const tail = new Float64Array(n + 1);
    for (let i = n - 1; i >= 0; i--) tail[i] = tail[i + 1] + s[i] * s[i];
    src.tail = tail;
    src.norm2 = tail[0];
    const ms = performance.now() - t0;
    part("status").textContent = `Decomposed ${label} in ${(ms / 1000).toFixed(1)} s (${src.svd.sweeps} Jacobi sweeps).`;
  };

  const draw = () => {
    frame = 0;
    const key = which();
    const src = sources[key];
    const k = Number(slider.value);
    kOut.value = String(k);
    part("approx-cap").textContent = `rank ${k}`;
    paint(origCanvas, src.pixels, n, (v) => v);
    if (!src.svd || !src.tail || !src.norm2) return;
    approx = reconstruct(src.svd, k, approx.length === n * n ? approx : undefined);
    paint(approxCanvas, approx, n, (v) => v);
    let err = 0;
    const resid = new Float64Array(n * n);
    for (let i = 0; i < n * n; i++) {
      resid[i] = src.pixels[i] - approx[i];
      err += resid[i] * resid[i];
    }
    paint(residCanvas, resid, n, (v) => 0.5 + v / (2 * RESID_SCALE));
    const mse = err / (n * n);
    part("stats").innerHTML = statsPart({
      k,
      m: n,
      n,
      energy: 1 - src.tail[k] / src.norm2,
      measured: Math.sqrt(err / src.norm2),
      predicted: Math.sqrt(src.tail[k] / src.norm2),
      psnr: mse > 1e-20 ? 10 * Math.log10(1 / mse) : Infinity,
    });
    part("spectrum").innerHTML = spectrum(
      { photo: sources.photo.svd!.s, shuffled: sources.shuffled.svd?.s },
      k,
    );
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };

  const run = async (key: "photo" | "shuffled") => {
    slider.disabled = toggle.disabled = true;
    try {
      await decompose(key);
    } finally {
      if (alive) {
        slider.disabled = toggle.disabled = false;
        schedule();
      }
    }
  };

  const start = async () => {
    try {
      const loaded = await loadPixels(figure.dataset.src!);
      if (!alive) return;
      n = loaded.n;
      photo = loaded.pixels;
      sources.photo.pixels = photo;
      sources.shuffled.pixels = shuffled(photo, 1);
      origCanvas.width = origCanvas.height = n;
      approxCanvas.width = approxCanvas.height = residCanvas.width = residCanvas.height = n;
      part("orig").replaceChildren(origCanvas);
      slider.max = String(n);
      busy = run("photo");
      await busy;
    } catch (error) {
      if (alive) part("status").textContent = `The figure couldn't run: ${(error as Error).message}`;
    }
  };

  const onToggle = () => {
    if (!photo) return;
    busy = run(which());
  };

  // Decompose only once the figure is close to the viewport.
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        observer.disconnect();
        void start();
      }
    },
    { rootMargin: "400px" },
  );
  observer.observe(figure);
  slider.value = slider.value || String(DEFAULT_K);
  slider.addEventListener("input", schedule);
  toggle.addEventListener("change", onToggle);

  return () => {
    alive = false;
    observer.disconnect();
    slider.removeEventListener("input", schedule);
    toggle.removeEventListener("change", onToggle);
    if (frame) cancelAnimationFrame(frame);
    void busy;
  };
}
