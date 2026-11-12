// Browser side of the CNN explorer. The page already holds the figure for the
// default digit; this enables its controls, lets the reader draw, and reruns
// the network on every change.

import { centered, digitPixels, digits, forward, shifted, type Pass, type Unit } from "./model";
import {
  detailPart,
  images,
  inputPart,
  maps1,
  maps2,
  probsPart,
  sourceNote,
  strongestUnit,
  type Encode,
  type Images,
  type Source,
} from "./render";

const canvases = new Map<string, CanvasRenderingContext2D>();
const context = (width: number, height: number): CanvasRenderingContext2D => {
  const key = `${width}x${height}`;
  let ctx = canvases.get(key);
  if (!ctx) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    ctx = canvas.getContext("2d")!;
    canvases.set(key, ctx);
  }
  return ctx;
};

const encode: Encode = (width, height, alpha) => {
  const ctx = context(width, height);
  const data = ctx.createImageData(width, height);
  for (let i = 0; i < alpha.length; i++) data.data[i * 4 + 3] = alpha[i];
  ctx.putImageData(data, 0, 0);
  return ctx.canvas.toDataURL();
};

// Drawing happens on a 280x280 canvas, ten times MNIST's resolution.
const RAW = 280;
const STROKE = 24;

/** Average each 10x10 block of a 280x280 canvas's opacity into one pixel. */
function downsample(ctx: CanvasRenderingContext2D): Float32Array {
  const alpha = ctx.getImageData(0, 0, RAW, RAW).data;
  const out = new Float32Array(784);
  for (let y = 0; y < RAW; y++) {
    for (let x = 0; x < RAW; x++) out[Math.floor(y / 10) * 28 + Math.floor(x / 10)] += alpha[(y * RAW + x) * 4 + 3];
  }
  return out.map((v) => v / (255 * 100));
}

/**
 * MNIST's own preprocessing: scale the digit's bounding box to fit 20x20
 * pixels, keeping its aspect ratio, then move its center of mass to the
 * middle of the 28x28 image.
 */
function mnistify(raw: CanvasRenderingContext2D): Float32Array {
  const alpha = raw.getImageData(0, 0, RAW, RAW).data;
  let x0 = RAW;
  let y0 = RAW;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < RAW; y++) {
    for (let x = 0; x < RAW; x++) {
      if (alpha[(y * RAW + x) * 4 + 3] > 12) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  }
  if (x1 < 0) return new Float32Array(784);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const s = 200 / Math.max(w, h);
  const fit = context(RAW, RAW + 1); // a second canvas of the same size
  fit.clearRect(0, 0, RAW, RAW + 1);
  fit.imageSmoothingEnabled = true;
  fit.imageSmoothingQuality = "high";
  fit.drawImage(raw.canvas, x0, y0, w, h, (RAW - w * s) / 2, (RAW - h * s) / 2, w * s, h * s);
  return centered(downsample(fit));
}

export function mount(root: HTMLElement): () => void {
  const figure = root.querySelector<HTMLElement>("figure.cx");
  if (!figure) return () => {};
  const part = (name: string) => figure.querySelector<HTMLElement>(`[data-part="${name}"]`)!;
  const canvas = part("input");
  const raw = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  raw.canvas.width = raw.canvas.height = RAW;

  const source: Source = { digit: Number(figure.dataset.digit) || 0, dy: 0, dx: 0 };
  let base = digitPixels(digits[source.digit]);
  let pass: Pass = forward(base);
  let img: Images = images(pass, encode);
  let unit: Unit = strongestUnit(pass);
  let frame = 0;
  let drawing = false;
  let last: [number, number] | null = null;

  const placeSelection = () => {
    canvas.innerHTML = inputPart(img, unit);
    for (const map of figure.querySelectorAll<HTMLElement>(".cx-map")) {
      const on = Number(map.dataset.layer) === unit.layer && Number(map.dataset.channel) === unit.channel;
      map.classList.toggle("cx-selected", on);
      map.setAttribute("aria-pressed", String(on));
      map.querySelector(".cx-mark")?.remove();
      if (on) {
        const n = Number(map.dataset.n);
        const p = (v: number) => `${((v / n) * 100).toFixed(3)}%`;
        map.insertAdjacentHTML(
          "beforeend",
          `<span class="cx-mark" style="left:${p(unit.col)};top:${p(unit.row)};width:${p(1)};height:${p(1)}"></span>`,
        );
      }
    }
    part("detail").innerHTML = detailPart(pass, unit, encode);
  };

  const run = (pixels: Float32Array) => {
    pass = forward(pixels);
    img = images(pass, encode);
    const focused = document.activeElement as HTMLElement | null;
    const refocus = focused?.classList.contains("cx-map") ? `[data-layer="${focused.dataset.layer}"][data-channel="${focused.dataset.channel}"]` : null;
    part("source").textContent = sourceNote(source);
    part("probs").innerHTML = probsPart(pass);
    part("maps1").innerHTML = maps1(img, unit);
    part("maps2").innerHTML = maps2(img, unit);
    if (refocus) figure.querySelector<HTMLElement>(`.cx-map${refocus}`)?.focus();
    placeSelection();
  };
  const current = () => shifted(base, source.dy, source.dx);
  const schedule = (pixels: () => Float32Array) => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      run(pixels());
    });
  };

  const pressDigit = () => {
    for (const b of figure.querySelectorAll<HTMLButtonElement>('button[name="digit"]')) {
      b.setAttribute("aria-pressed", String(Number(b.value) === source.digit));
    }
  };

  const onClick = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!button || !figure.contains(button)) return;
    if (button.name === "digit") {
      source.digit = Number(button.value);
      source.dy = source.dx = 0;
      base = digitPixels(digits[source.digit]);
      unit = strongestUnit(forward(base));
    } else if (button.name === "shift") {
      const [dy, dx] = button.value.split(",").map(Number);
      source.dy = Math.max(-8, Math.min(8, source.dy + dy));
      source.dx = Math.max(-8, Math.min(8, source.dx + dx));
    } else if (button.name === "clear") {
      raw.clearRect(0, 0, RAW, RAW);
      source.digit = -1;
      source.dy = source.dx = 0;
      base = new Float32Array(784);
    }
    pressDigit();
    run(current());
  };

  const point = (event: PointerEvent): [number, number] => {
    const rect = canvas.getBoundingClientRect();
    return [((event.clientX - rect.left) / rect.width) * RAW, ((event.clientY - rect.top) / rect.height) * RAW];
  };
  const stroke = (to: [number, number]) => {
    const from = last ?? to;
    raw.beginPath();
    raw.moveTo(from[0], from[1]);
    raw.lineTo(to[0] + 0.01, to[1]);
    raw.stroke();
    last = to;
  };
  const onDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    if (source.digit >= 0 || source.dx || source.dy) {
      raw.clearRect(0, 0, RAW, RAW);
      source.digit = -1;
      source.dy = source.dx = 0;
      pressDigit();
    }
    drawing = true;
    last = null;
    canvas.setPointerCapture(event.pointerId);
    raw.lineWidth = STROKE;
    raw.lineCap = raw.lineJoin = "round";
    raw.strokeStyle = "#000";
    stroke(point(event));
    schedule(() => downsample(raw));
  };
  const onMove = (event: PointerEvent) => {
    if (!drawing) return;
    for (const e of event.getCoalescedEvents?.() ?? [event]) stroke(point(e));
    schedule(() => downsample(raw));
  };
  const onUp = () => {
    if (!drawing) return;
    drawing = false;
    last = null;
    base = mnistify(raw);
    schedule(current);
  };

  const select = (next: Unit) => {
    unit = next;
    placeSelection();
  };
  const unitAt = (map: HTMLElement, event: PointerEvent): Unit => {
    const n = Number(map.dataset.n);
    const rect = map.getBoundingClientRect();
    const clamp = (v: number) => Math.max(0, Math.min(n - 1, Math.floor(v * n)));
    return {
      layer: Number(map.dataset.layer) as 1 | 2,
      channel: Number(map.dataset.channel),
      row: clamp((event.clientY - rect.top) / rect.height),
      col: clamp((event.clientX - rect.left) / rect.width),
    };
  };
  const onMapPointer = (event: PointerEvent) => {
    const map = (event.target as HTMLElement).closest<HTMLElement>(".cx-map");
    if (map) select(unitAt(map, event));
  };
  const onMapFocus = (event: FocusEvent) => {
    const map = (event.target as HTMLElement).closest<HTMLElement>(".cx-map");
    if (!map) return;
    const layer = Number(map.dataset.layer) as 1 | 2;
    const channel = Number(map.dataset.channel);
    if (layer === unit.layer && channel === unit.channel) return;
    const scale = layer === unit.layer ? 1 : layer === 2 ? 0.5 : 2;
    const n = Number(map.dataset.n);
    const fit = (v: number) => Math.max(0, Math.min(n - 1, Math.floor(v * scale)));
    select({ layer, channel, row: fit(unit.row), col: fit(unit.col) });
  };
  const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  const onKey = (event: KeyboardEvent) => {
    const map = (event.target as HTMLElement).closest<HTMLElement>(".cx-map");
    const move = moves[event.key];
    if (!map || !move) return;
    event.preventDefault();
    const n = Number(map.dataset.n);
    select({
      ...unit,
      row: Math.max(0, Math.min(n - 1, unit.row + move[0])),
      col: Math.max(0, Math.min(n - 1, unit.col + move[1])),
    });
  };

  figure.addEventListener("click", onClick);
  figure.addEventListener("pointerdown", onMapPointer);
  figure.addEventListener("focusin", onMapFocus);
  figure.addEventListener("keydown", onKey);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  for (const button of figure.querySelectorAll<HTMLButtonElement>("button")) button.disabled = false;
  figure.classList.add("cx-live");

  return () => {
    figure.removeEventListener("click", onClick);
    figure.removeEventListener("pointerdown", onMapPointer);
    figure.removeEventListener("focusin", onMapFocus);
    figure.removeEventListener("keydown", onKey);
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerup", onUp);
    canvas.removeEventListener("pointercancel", onUp);
    if (frame) cancelAnimationFrame(frame);
  };
}
