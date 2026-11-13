// Markup for the low-rank image figure. The build renders the photo, the
// controls and the photo's singular value spectrum (from the NumPy run); the
// client computes the SVD itself and fills in the reconstructions.

export interface Spectra {
  photo: ArrayLike<number>;
  shuffled?: ArrayLike<number>;
}

const W = 520;
const H = 190;
const M = { left: 44, right: 12, top: 14, bottom: 30 };

const fmt = (x: number, digits = 2): string => x.toFixed(digits).replace("-", "−");
export const pct = (x: number, digits = 1): string => `${fmt(100 * x, digits)}%`;

export function spectrum(spectra: Spectra, k: number): string {
  const n = spectra.photo.length;
  const lo = -4;
  const hi = 3;
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const x = (i: number) => M.left + ((i - 1) / (n - 1)) * plotW;
  const y = (s: number) => M.top + (1 - (Math.log10(Math.max(s, 10 ** lo)) - lo) / (hi - lo)) * plotH;
  const parts: string[] = [];
  for (let e = lo; e <= hi; e++) {
    parts.push(
      `<line class="si-grid" x1="${M.left}" x2="${W - M.right}" y1="${y(10 ** e).toFixed(1)}" y2="${y(10 ** e).toFixed(1)}"/>`,
      `<text class="si-tick" x="${M.left - 6}" y="${(y(10 ** e) + 4).toFixed(1)}" text-anchor="end">10${sup(e)}</text>`,
    );
  }
  for (const i of [1, 64, 128, 192, 256].filter((i) => i <= n)) {
    parts.push(`<text class="si-tick" x="${x(i).toFixed(1)}" y="${H - 12}" text-anchor="middle">${i}</text>`);
  }
  parts.push(`<text class="si-tick" x="${W - M.right}" y="${H - 1}" text-anchor="end">index i</text>`, `<text class="si-tick" x="${M.left + 6}" y="${M.top + 12}">σᵢ, log scale</text>`);
  const xk = x(Math.min(k + 0.5, n));
  parts.push(`<rect class="si-tail" x="${xk.toFixed(1)}" y="${M.top}" width="${(W - M.right - xk).toFixed(1)}" height="${plotH}"/>`);
  const path = (s: ArrayLike<number>) => Array.from(s, (v, i) => `${i ? "L" : "M"}${x(i + 1).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  if (spectra.shuffled) {
    parts.push(`<path class="si-line si-shuf" d="${path(spectra.shuffled)}"/>`);
    const lx = M.left + plotW * 0.42;
    parts.push(
      `<line class="si-line si-photo" x1="${lx}" x2="${lx + 22}" y1="${M.top + 9}" y2="${M.top + 9}"/><text class="si-tick" x="${lx + 27}" y="${M.top + 13}">photo</text>`,
      `<line class="si-line si-shuf" x1="${lx + 70}" x2="${lx + 92}" y1="${M.top + 9}" y2="${M.top + 9}"/><text class="si-tick" x="${lx + 97}" y="${M.top + 13}">shuffled pixels</text>`,
    );
  }
  parts.push(`<path class="si-line si-photo" d="${path(spectra.photo)}"/>`);
  parts.push(`<line class="si-k" x1="${xk.toFixed(1)}" x2="${xk.toFixed(1)}" y1="${M.top}" y2="${M.top + plotH}"/>`);
  parts.push(`<text class="si-tick si-taillabel" x="${(W - M.right - 6).toFixed(1)}" y="${M.top + 14}" text-anchor="end">dropped: σ${toSub(k + 1)} … σ${toSub(n)}</text>`);
  const label = `Singular values of the ${spectra.shuffled ? "photo and of its shuffled pixels" : "photo"} on a log scale, with the first ${k} kept.`;
  return `<svg class="si-spectrum" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">${parts.join("")}</svg>`;
}

const sup = (n: number): string => String(n).replace(/-/g, "⁻").replace(/\d/g, (d) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[Number(d)]);
const toSub = (n: number): string => String(n).replace(/\d/g, (d) => "₀₁₂₃₄₅₆₇₈₉"[Number(d)]);

export interface Stats {
  k: number;
  m: number;
  n: number;
  energy: number;
  measured: number;
  predicted: number;
  psnr: number;
}

export function statsPart(s: Stats): string {
  const stored = s.k * (s.m + s.n + 1);
  return (
    `<dl class="sg-stats si-stats">` +
    `<div><dt>numbers stored</dt><dd>${stored.toLocaleString("en-US")} <small>(${pct(stored / (s.m * s.n))} of ${(s.m * s.n).toLocaleString("en-US")})</small></dd></div>` +
    `<div><dt>energy kept, Σᵢ≤ₖ σᵢ² / Σ σᵢ²</dt><dd>${pct(s.energy, 2)}</dd></div>` +
    `<div><dt>‖A − Aₖ‖<sub>F</sub> / ‖A‖<sub>F</sub>, from the pixels</dt><dd>${s.measured.toFixed(5)}</dd></div>` +
    `<div><dt>√(Σᵢ&gt;ₖ σᵢ²) / ‖A‖<sub>F</sub>, from the spectrum</dt><dd>${s.predicted.toFixed(5)}</dd></div>` +
    `<div><dt>PSNR</dt><dd>${Number.isFinite(s.psnr) ? `${fmt(s.psnr, 1)} dB` : "exact"}</dd></div>` +
    `</dl>`
  );
}

export const DEFAULT_K = 20;

export function render(props: { src?: string }, photo: ArrayLike<number>): string {
  const src = typeof props.src === "string" ? props.src : "";
  return (
    `<figure class="sg si" data-src="${src.replace(/"/g, "&quot;")}">` +
    `<div class="si-controls">` +
    `<label class="sp-slider"><span>rank k <output name="k-out">${DEFAULT_K}</output></span><input type="range" name="k" min="1" max="${photo.length}" step="1" value="${DEFAULT_K}" disabled/></label>` +
    `<label class="si-toggle"><input type="checkbox" name="shuffle" disabled/> Shuffle the pixels</label>` +
    `</div>` +
    `<div class="si-images">` +
    `<div class="si-panel"><div class="si-frame" data-part="orig"><img src="${src.replace(/"/g, "&quot;")}" width="256" height="256" alt="Grayscale photo of astronaut Eileen Collins, 256 by 256 pixels" loading="lazy"/></div><div class="sg-cap"><b>A</b><span>256 × 256 pixels</span></div></div>` +
    `<div class="si-panel"><div class="si-frame" data-part="approx"><canvas width="256" height="256"></canvas></div><div class="sg-cap"><b>Aₖ</b><span data-part="approx-cap">rank ${DEFAULT_K}</span></div></div>` +
    `<div class="si-panel"><div class="si-frame" data-part="resid"><canvas width="256" height="256"></canvas></div><div class="sg-cap"><b>A − Aₖ</b><span>gray is 0, black and white ±0.25</span></div></div>` +
    `</div>` +
    `<p class="sg-note si-status" data-part="status" role="status">The decomposition runs in your browser once the figure scrolls into view.</p>` +
    `<div data-part="spectrum">${spectrum({ photo }, DEFAULT_K)}</div>` +
    `<div data-part="stats"></div>` +
    `<figcaption>The photo is skimage's astronaut test image (NASA, public domain), converted to luma and averaged down to 256 × 256. The figure decomposes it with a one-sided Jacobi SVD written in TypeScript; a test checks its singular values against NumPy's. Shuffling keeps every pixel value and destroys the spatial structure.</figcaption>` +
    `</figure>`
  );
}
