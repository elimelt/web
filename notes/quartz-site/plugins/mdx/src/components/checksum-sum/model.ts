// The Internet checksum (RFC 1071) over one real IPv4 header, and the
// scenarios the note walks through. No DOM here, so the tests and the build
// run the same code as the browser.

/**
 * A 20-byte IPv4 header captured from a real TCP connection (frame 4 of
 * http2-data-reassembly.pcap in Wireshark's test suite): a 569-byte packet
 * from 172.16.5.1 to 172.16.5.10, TTL 64. The sixth word is the checksum
 * the sender computed.
 */
export const HEADER = [0x4500, 0x0239, 0xc8c3, 0x4000, 0x4006, 0x0dd0, 0xac10, 0x0501, 0xac10, 0x050a];

export const FIELDS = [
  "version, length, ToS",
  "total length",
  "identification",
  "flags, offset",
  "TTL, protocol",
  "checksum",
  "source address",
  "source address",
  "dest. address",
  "dest. address",
];

/** Add two 16-bit values in ones' complement: carries wrap around to bit 0. */
export function add1c(a: number, b: number): number {
  const s = a + b;
  return (s & 0xffff) + (s >>> 16);
}

/** Running ones' complement sums: entry i is the sum of words 0..i. */
export function runningSums(words: number[]): number[] {
  const out: number[] = [];
  let s = 0;
  for (const w of words) {
    s = add1c(s, w);
    out.push(s);
  }
  return out;
}

/** The value a sender writes in the checksum field (sum taken with it zeroed). */
export function checksumFor(words: number[], field = 5): number {
  const zeroed = words.map((w, i) => (i === field ? 0 : w));
  return ~runningSums(zeroed).at(-1)! & 0xffff;
}

/** Receiver: the header passes when everything, checksum included, sums to 0xFFFF. */
export const passes = (words: number[]): boolean => runningSums(words).at(-1) === 0xffff;

export const hex = (v: number): string => v.toString(16).toUpperCase().padStart(4, "0");

/** Dotted IPv4 address from two words. */
export const addr = (hi: number, lo: number): string => [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");

export interface Scenario {
  id: string;
  /** The words as received. */
  words: number[];
}

const flip = (words: number[], ...bits: [number, number][]) => {
  const out = [...words];
  for (const [w, b] of bits) out[w] ^= 1 << b;
  return out;
};

export const SCENARIOS: Record<string, Scenario> = {
  // The header exactly as captured.
  clean: { id: "clean", words: HEADER },
  // One flip: TTL 64 becomes 80.
  flip: { id: "flip", words: flip(HEADER, [4, 12]) },
  // Two flips in the same column, one 0 to 1 and one 1 to 0: the
  // destination becomes 172.16.5.11 and the identification changes by one.
  cancel: { id: "cancel", words: flip(HEADER, [9, 0], [2, 0]) },
  // Source and destination trade places: the same words in another order.
  swap: { id: "swap", words: [...HEADER.slice(0, 6), ...HEADER.slice(8, 10), ...HEADER.slice(6, 8)] },
};

export const scenarioById = (id: string | undefined): Scenario => SCENARIOS[id ?? "clean"] ?? SCENARIOS.clean;

/** Bits that differ from the header as sent, as [word, bit] pairs. */
export function changedBits(words: number[]): [number, number][] {
  const out: [number, number][] = [];
  words.forEach((w, i) => {
    const d = w ^ HEADER[i];
    for (let b = 15; b >= 0; b--) if ((d >> b) & 1) out.push([i, b]);
  });
  return out;
}
