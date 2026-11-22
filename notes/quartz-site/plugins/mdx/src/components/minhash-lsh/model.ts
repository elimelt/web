// The MinHash and LSH figure's model: recorded MinHash agreement bits for
// 2,000 pairs of crawled pages with known Jaccard similarity, and what
// banding with b bands of r rows does with them. The figure's tests check
// every function here against an independent Python implementation
// (content/algorithms/probabilistic/minhash-experiments/figure_ref.py).

/** Hash functions recorded per pair. */
export const K = 256;
export const BYTES = 4 + K / 8;
export const BINS = 20;

export interface Pairs {
  n: number;
  /** Exact Jaccard similarity of each pair. */
  J: Float32Array;
  /** For each pair, K / 8 bytes: bit t of byte t >> 3 is set when the two pages' t-th MinHash values agree. */
  eq: Uint8Array;
}

/** pairs.bin.gz, inflated: per pair a little-endian float32 J and K / 8 agreement bytes. */
export function decode(bytes: Uint8Array): Pairs {
  const n = Math.floor(bytes.length / BYTES);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const J = new Float32Array(n);
  const eq = new Uint8Array(n * (K / 8));
  for (let i = 0; i < n; i++) {
    J[i] = view.getFloat32(i * BYTES, true);
    eq.set(bytes.subarray(i * BYTES + 4, (i + 1) * BYTES), i * (K / 8));
  }
  return { n, J, eq };
}

export function agrees(p: Pairs, i: number, t: number): boolean {
  return ((p.eq[i * (K / 8) + (t >> 3)] >> (t & 7)) & 1) === 1;
}

/** Agreements among the first k hash functions; matches / k estimates J. */
export function matches(p: Pairs, i: number, k: number): number {
  let m = 0;
  for (let t = 0; t < k; t++) if (agrees(p, i, t)) m++;
  return m;
}

/** A pair is a candidate when, in some band of r consecutive hash functions, all r agree. */
export function isCandidate(p: Pairs, i: number, b: number, r: number): boolean {
  for (let band = 0; band < b; band++) {
    let all = true;
    for (let t = band * r; t < (band + 1) * r; t++) {
      if (!agrees(p, i, t)) {
        all = false;
        break;
      }
    }
    if (all) return true;
  }
  return false;
}

/** Probability that a pair with similarity s becomes a candidate. */
export function sCurve(s: number, b: number, r: number): number {
  return 1 - (1 - s ** r) ** b;
}

/** The similarity at which the S-curve is steepest, approximately: (1/b)^(1/r). */
export function threshold(b: number, r: number): number {
  return (1 / b) ** (1 / r);
}

export interface Bin {
  lo: number;
  hi: number;
  pairs: number;
  candidates: number;
  /** Mean of the S-curve over the bin's pairs. */
  theory: number;
}

export interface Result {
  b: number;
  r: number;
  candidate: Uint8Array;
  estimate: Float64Array;
  bins: Bin[];
}

export function evaluate(p: Pairs, b: number, r: number): Result {
  if (b * r > K) throw new Error(`b * r = ${b * r} exceeds ${K}`);
  const candidate = new Uint8Array(p.n);
  const estimate = new Float64Array(p.n);
  const bins: Bin[] = Array.from({ length: BINS }, (_, j) => ({ lo: j / BINS, hi: (j + 1) / BINS, pairs: 0, candidates: 0, theory: 0 }));
  for (let i = 0; i < p.n; i++) {
    candidate[i] = isCandidate(p, i, b, r) ? 1 : 0;
    estimate[i] = matches(p, i, b * r) / (b * r);
    const bin = bins[Math.min(BINS - 1, Math.floor(p.J[i] * BINS))];
    bin.pairs++;
    bin.candidates += candidate[i];
    bin.theory += sCurve(p.J[i], b, r);
  }
  for (const bin of bins) if (bin.pairs) bin.theory /= bin.pairs;
  return { b, r, candidate, estimate, bins };
}

/** Clamps the number of bands so that b * r hash functions fit in K. */
export function clampBands(b: number, r: number): number {
  return Math.max(1, Math.min(b, Math.floor(K / r)));
}
