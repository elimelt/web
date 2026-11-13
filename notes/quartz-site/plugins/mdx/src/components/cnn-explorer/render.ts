// Markup for the CNN explorer. The build renders the whole figure for the
// default digit, so the page shows real feature maps before any script runs;
// the client module redraws the same parts with the same functions.
//
// Images are alpha masks: each map becomes a small PNG whose opacity is the
// value, painted with a theme color through CSS mask-image, so one image works
// in light and dark mode. The PNG encoder is passed in because the build
// encodes with node:zlib and the browser with a canvas.

import { num } from "../../shared/format";
import { C1, C2, B1, digits, forward, inputGradient, receptiveField, testAccuracy, W1, type Pass, type Unit } from "./model";

/** Encode a width x height alpha mask (0..255 per pixel) as a PNG data URL. */
export type Encode = (width: number, height: number, alpha: Uint8Array) => string;

export interface Source {
  /** Index into `digits`, or -1 for the reader's own drawing. */
  digit: number;
  dy: number;
  dx: number;
}

export interface Images {
  input: string;
  act1: string[];
  act2: string[];
}

const fmt = (v: number, digits = 2): string => num(v, digits);
const pct = (v: number): string => (v >= 0.995 ? ">99%" : v < 0.005 ? "<1%" : `${Math.round(v * 100)}%`);

function mask(values: ArrayLike<number>, n: number, scale: number, max: number, encode: Encode, sign = 1): string {
  const size = n * scale;
  const alpha = new Uint8Array(size * size);
  const k = max > 0 ? 255 / max : 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = sign * values[Math.floor(y / scale) * n + Math.floor(x / scale)];
      alpha[y * size + x] = v > 0 ? Math.min(255, Math.round(v * k)) : 0;
    }
  }
  return encode(size, size, alpha);
}

const absMax = (values: ArrayLike<number>): number => {
  let m = 0;
  for (let i = 0; i < values.length; i++) m = Math.max(m, Math.abs(values[i]));
  return m;
};

const seq = (url: string, cls = "cx-seq") => `<span class="cx-img ${cls}" style="--m:url(${url})"></span>`;

function diverging(values: ArrayLike<number>, n: number, scale: number, encode: Encode): string {
  const max = absMax(values);
  return `<span class="cx-img cx-div"><span class="cx-pos" style="--m:url(${mask(values, n, scale, max, encode)})"></span><span class="cx-neg" style="--m:url(${mask(values, n, scale, max, encode, -1)})"></span></span>`;
}

/** Each layer shares one scale, so a map that barely fires looks faint. */
export function images(pass: Pass, encode: Encode): Images {
  const m1 = absMax(pass.act1);
  const m2 = absMax(pass.act2);
  return {
    input: mask(pass.input, 28, 8, 1, encode),
    act1: Array.from({ length: C1 }, (_, c) => mask(pass.act1.subarray(c * 784, (c + 1) * 784), 28, 4, m1, encode)),
    act2: Array.from({ length: C2 }, (_, c) => mask(pass.act2.subarray(c * 196, (c + 1) * 196), 14, 8, m2, encode)),
  };
}

let kernelCache: string | undefined;
function kernels(encode: Encode): string {
  if (kernelCache) return kernelCache;
  const max = absMax(W1);
  const cells = Array.from({ length: C1 }, (_, c) => {
    const w = W1.subarray(c * 25, (c + 1) * 25);
    return `<span class="cx-img cx-div cx-kernel" title="conv1 filter ${c + 1}"><span class="cx-pos" style="--m:url(${mask(w, 5, 16, max, encode)})"></span><span class="cx-neg" style="--m:url(${mask(w, 5, 16, max, encode, -1)})"></span></span>`;
  });
  kernelCache = cells.join("");
  return kernelCache;
}

const box = (unit: Unit): string => {
  const rf = receptiveField(unit);
  const p = (v: number) => `${((v / 28) * 100).toFixed(3)}%`;
  return `<span class="cx-rf" style="left:${p(rf.c0)};top:${p(rf.r0)};width:${p(rf.c1 - rf.c0)};height:${p(rf.r1 - rf.r0)}"></span>`;
};

const marker = (unit: Unit, n: number): string => {
  const p = (v: number) => `${((v / n) * 100).toFixed(3)}%`;
  return `<span class="cx-mark" style="left:${p(unit.col)};top:${p(unit.row)};width:${p(1)};height:${p(1)}"></span>`;
};

export function inputPart(img: Images, unit: Unit): string {
  return `${seq(img.input, "cx-ink")}${box(unit)}`;
}

export function sourceNote(source: Source): string {
  const shift =
    source.dx || source.dy
      ? `, moved ${Math.abs(source.dx)} px ${source.dx < 0 ? "left" : "right"} and ${Math.abs(source.dy)} px ${source.dy < 0 ? "up" : "down"}`
      : "";
  if (source.digit < 0) return `your drawing${shift}`;
  const d = digits[source.digit];
  return `MNIST test image ${d.index.toLocaleString("en-US")}, labeled ${d.label}${shift}`;
}

export function probsPart(pass: Pass): string {
  let best = 0;
  for (let i = 1; i < 10; i++) if (pass.probs[i] > pass.probs[best]) best = i;
  const rows = Array.from(pass.probs, (p, i) => {
    const width = Math.max(p * 100, 0.6).toFixed(2);
    return `<li${i === best ? ' class="cx-best"' : ""}><span class="cx-digit">${i}</span><span class="cx-bar"><span style="width:${width}%"></span></span><span class="cx-p">${pct(p)}</span></li>`;
  });
  const label = `The network's probabilities. It predicts ${best} at ${pct(pass.probs[best])}.`;
  return `<ol class="cx-bars" aria-label="${label}">${rows.join("")}</ol>`;
}

function maps(urls: string[], layer: 1 | 2, unit: Unit): string {
  const n = layer === 1 ? 28 : 14;
  return urls
    .map((url, c) => {
      const selected = unit.layer === layer && unit.channel === c;
      return `<span class="cx-map${selected ? " cx-selected" : ""}" data-layer="${layer}" data-channel="${c}" data-n="${n}" tabindex="0" role="button" aria-label="conv${layer} filter ${c + 1} output. Arrow keys move the selected position." aria-pressed="${selected}">${seq(url)}${selected ? marker(unit, n) : ""}</span>`;
    })
    .join("");
}

export const maps1 = (img: Images, unit: Unit) => maps(img.act1, 1, unit);
export const maps2 = (img: Images, unit: Unit) => maps(img.act2, 2, unit);

/** Share of the gradient's magnitude that falls in the middle 8x8 of the 14x14 window. */
function centralShare(grad: Float32Array, unit: Unit): number {
  const rf = receptiveField(unit);
  const midR = 2 * unit.row + 0.5;
  const midC = 2 * unit.col + 0.5;
  let all = 0;
  let mid = 0;
  for (let y = rf.r0; y < rf.r1; y++) {
    for (let x = rf.c0; x < rf.c1; x++) {
      const g = Math.abs(grad[y * 28 + x]);
      all += g;
      if (Math.abs(y - midR) <= 3.5 && Math.abs(x - midC) <= 3.5) mid += g;
    }
  }
  return all > 0 ? mid / all : 0;
}

export function detailPart(pass: Pass, unit: Unit, encode: Encode): string {
  const n = unit.layer === 1 ? 28 : 14;
  const at = (unit.channel * n + unit.row) * n + unit.col;
  const pre = unit.layer === 1 ? pass.pre1[at] : pass.pre2[at];
  const where = `conv${unit.layer} filter ${unit.channel + 1}, row ${unit.row + 1}, column ${unit.col + 1}`;
  const value = `Before ReLU it is <strong>${fmt(pre)}</strong>${pre > 0 ? "" : ", so ReLU outputs 0"}.`;

  if (unit.layer === 1) {
    const rows: string[] = [];
    let sum = 0;
    const max = absMax(W1.subarray(unit.channel * 25, unit.channel * 25 + 25)) || 1;
    for (let u = 0; u < 5; u++) {
      const cells: string[] = [];
      for (let v = 0; v < 5; v++) {
        const y = unit.row + u - 2;
        const x = unit.col + v - 2;
        const px = y >= 0 && y < 28 && x >= 0 && x < 28 ? pass.input[y * 28 + x] : 0;
        const w = W1[unit.channel * 25 + u * 5 + v];
        const prod = px * w;
        sum += prod;
        const tone = prod === 0 ? "" : ` style="--a:${(Math.min(1, Math.abs(prod) / max) * 0.85 + 0.15).toFixed(2)}" class="${prod > 0 ? "cx-up" : "cx-down"}"`;
        cells.push(`<td${tone}>${px === 0 ? "·" : fmt(prod)}</td>`);
      }
      rows.push(`<tr>${cells.join("")}</tr>`);
    }
    const bias = B1[unit.channel];
    return [
      `<p class="cx-where">${where}</p>`,
      `<p>${value} It is the sum of 25 products, pixel times filter weight, over the 5×5 box on the input, plus the filter's bias:</p>`,
      `<table class="cx-products" aria-label="Pixel times weight for each of the 25 positions. A dot marks a blank pixel.">${rows.join("")}</table>`,
      `<p class="cx-sum">${fmt(sum)} from the products ${bias < 0 ? "−" : "+"} ${fmt(Math.abs(bias))} bias = ${fmt(sum + bias)}</p>`,
      `<p class="cx-hint">Every position in this map uses the same 25 weights. Only the box moves.</p>`,
    ].join("");
  }

  const grad = inputGradient(pass, unit);
  const rf = receptiveField(unit);
  const share = centralShare(grad, unit);
  return [
    `<p class="cx-where">${where}</p>`,
    `<p>${value} It reads a 5×5 window on all 8 pooled conv1 maps, which reaches a ${rf.size}×${rf.size} box of input pixels.</p>`,
    `<div class="cx-grad">${diverging(grad, 28, 4, encode)}${box(unit)}</div>`,
    `<p class="cx-hint">The gradient of this value with respect to each input pixel, for this image: <span class="cx-key cx-up">blue</span> pixels would raise it if brighter, <span class="cx-key cx-down">red</span> ones would lower it. ${pct(share)} of the gradient's total size falls in the middle 8×8 of the box, which is a third of its area.</p>`,
  ].join("");
}

/** The conv2 unit that fires hardest, so the figure opens on something worth looking at. */
export function strongestUnit(pass: Pass): Unit {
  let best = 0;
  for (let i = 1; i < pass.act2.length; i++) if (pass.act2[i] > pass.act2[best]) best = i;
  return { layer: 2, channel: Math.floor(best / 196), row: Math.floor((best % 196) / 14), col: best % 14 };
}

export interface Props {
  digit?: number;
}

export const defaultDigit = (props: Props): number => {
  const i = digits.findIndex((d) => d.label === props.digit);
  return i >= 0 ? i : digits.findIndex((d) => d.label === 7);
};

const button = (attrs: string, label: string) => `<button type="button" ${attrs} disabled>${label}</button>`;

/** The whole figure, rendered at build time. */
export function render(props: Props, encode: Encode): string {
  const digit = defaultDigit(props);
  const source: Source = { digit, dy: 0, dx: 0 };
  const pass = forward(Float32Array.from(digits[digit].pixels, (v) => v / 255));
  const img = images(pass, encode);
  const unit = strongestUnit(pass);
  const digitButtons = digits
    .map((d, i) => button(`name="digit" value="${i}" aria-pressed="${i === digit}"`, String(d.label)))
    .join("");
  return [
    `<figure class="cx" data-digit="${digit}">`,
    `<div class="cx-top">`,
    `<div class="cx-in">`,
    `<p class="cx-title">Input <span class="cx-note" data-part="source">${sourceNote(source)}</span></p>`,
    `<div class="cx-canvas" data-part="input" aria-label="The input image. Draw a digit here with a mouse, finger or pen.">${inputPart(img, unit)}</div>`,
    `<div class="cx-row" role="group" aria-label="Show an MNIST test digit">${digitButtons}</div>`,
    `<div class="cx-row" role="group" aria-label="Move the image one pixel">`,
    button('name="shift" value="0,-1" aria-label="Move left one pixel"', "←"),
    button('name="shift" value="-1,0" aria-label="Move up one pixel"', "↑"),
    button('name="shift" value="1,0" aria-label="Move down one pixel"', "↓"),
    button('name="shift" value="0,1" aria-label="Move right one pixel"', "→"),
    button('name="clear"', "Clear and draw"),
    `</div>`,
    `</div>`,
    `<div class="cx-out"><p class="cx-title">Prediction</p><div data-part="probs">${probsPart(pass)}</div></div>`,
    `</div>`,
    `<p class="cx-title">conv1: 8 filters of 5×5 weights, and what each one outputs <span class="cx-note">28×28 after ReLU</span></p>`,
    `<div class="cx-kernels" aria-label="The 8 trained conv1 filters. Blue weights are positive, red negative.">${kernels(encode)}</div>`,
    `<div class="cx-maps cx-maps1" data-part="maps1">${maps1(img, unit)}</div>`,
    `<p class="cx-title">conv2: 16 filters over the 8 pooled conv1 maps <span class="cx-note">14×14 after ReLU</span></p>`,
    `<div class="cx-maps cx-maps2" data-part="maps2">${maps2(img, unit)}</div>`,
    `<div class="cx-detail" data-part="detail" aria-live="polite">${detailPart(pass, unit, encode)}</div>`,
    `<figcaption>Real weights, run in your browser. This network has 11,274 weights, trained on MNIST's 60,000 training images by <code>cnn_mnist.py</code> next to this note, and it classifies ${(testAccuracy * 100).toFixed(2)}% of the 10,000 test images correctly. The digit buttons show the first test image of each class. Click or tab to any feature map to inspect one position; arrow keys move it.</figcaption>`,
    `</figure>`,
  ].join("");
}
