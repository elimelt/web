// Build-time PNG encoder for the alpha masks, using node:zlib. The browser
// encodes the same masks with a canvas instead (see client.ts).

import { deflateSync } from "node:zlib";

const table = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** Gray-plus-alpha PNG with black pixels whose opacity is `alpha`. */
export function encodeMask(width: number, height: number, alpha: Uint8Array): string {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 4; // gray + alpha
  const stride = width * 2 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    // Filter "up" turns every repeated row of an upscaled image into zeros.
    raw[y * stride] = y === 0 ? 0 : 2;
    for (let x = 0; x < width; x++) {
      const a = alpha[y * width + x];
      raw[y * stride + 2 + x * 2] = y === 0 ? a : (a - alpha[(y - 1) * width + x]) & 0xff;
    }
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}
