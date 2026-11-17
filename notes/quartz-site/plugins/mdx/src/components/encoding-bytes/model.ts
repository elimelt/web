// Byte-exact encoders and two decoders for one record type, free of the DOM.
//
// The record is one file of a PyPI release (name, version, filename, ... ,
// sha256), the type the note's experiments encode 36,519 times. Each encoder
// returns the encoding as labelled spans, so the figure can show which bytes
// identify a field, which carry types and lengths, and which carry the value.
// The output matches, byte for byte, Python's json (compact separators),
// msgpack 1.2, protobuf 7 (upb), thriftpy2's compact protocol and fastavro;
// test/encoding-bytes.test.mjs checks that against bytes the Python libraries
// wrote.

export interface Rec {
  name: string;
  version: string;
  filename: string;
  packagetype: string;
  python_version: string;
  requires_python: string | null;
  size: number;
  upload_time: number; // microseconds since the Unix epoch (< 2^53)
  yanked: boolean;
  sha256: string; // 64 hex digits
}

export const FIELDS = [
  "name",
  "version",
  "filename",
  "packagetype",
  "python_version",
  "requires_python",
  "size",
  "upload_time",
  "yanked",
  "sha256",
] as const;
export type Field = (typeof FIELDS)[number];

/** Field numbers in the .proto and .thrift schemas. */
export const TAG: Record<Field, number> = {
  name: 1,
  version: 2,
  filename: 3,
  packagetype: 4,
  python_version: 5,
  requires_python: 6,
  size: 7,
  upload_time: 8,
  yanked: 9,
  sha256: 10,
};

const KIND: Record<Field, "string" | "ostring" | "long" | "bool" | "bytes"> = {
  name: "string",
  version: "string",
  filename: "string",
  packagetype: "string",
  python_version: "string",
  requires_python: "ostring",
  size: "long",
  upload_time: "long",
  yanked: "bool",
  sha256: "bytes",
};

/** Three real records from the PyPI snapshot the note measures. */
export const RECORDS: { id: string; label: string; rec: Rec }[] = [
  {
    id: "numpy",
    label: "numpy 2.3.0 wheel",
    rec: {
      name: "numpy",
      version: "2.3.0",
      filename: "numpy-2.3.0-cp313-cp313-manylinux_2_28_x86_64.whl",
      packagetype: "bdist_wheel",
      python_version: "cp313",
      requires_python: ">=3.11",
      size: 16628765,
      upload_time: 1749307535076036,
      yanked: false,
      sha256: "87717eb24d4a8a64683b7a4e91ace04e2f5c7c77872f823f02a94feee186168f",
    },
  },
  {
    id: "requests",
    label: "requests 0.2.0 sdist",
    rec: {
      name: "requests",
      version: "0.2.0",
      filename: "requests-0.2.0.tar.gz",
      packagetype: "sdist",
      python_version: "source",
      requires_python: null,
      size: 5533,
      upload_time: 1297673382641660,
      yanked: false,
      sha256: "813202ace4d9301a3c00740c700e012fb9f3f8c73ddcfe02ab558a8df6f175fd",
    },
  },
  {
    id: "pip",
    label: "pip 20.0 wheel (yanked)",
    rec: {
      name: "pip",
      version: "20.0",
      filename: "pip-20.0-py2.py3-none-any.whl",
      packagetype: "bdist_wheel",
      python_version: "py2.py3",
      requires_python: ">=2.7,!=3.0.*,!=3.1.*,!=3.2.*,!=3.3.*,!=3.4.*",
      size: 1518959,
      upload_time: 1579606976407994,
      yanked: true,
      sha256: "eea07b449d969dbc8c062c157852cf8ed2ad1b8b5ac965a6b819e62929e41703",
    },
  },
];

export const recordById = (id?: string) => RECORDS.find((r) => r.id === id) ?? RECORDS[0];

/**
 * What a byte does. name: a field name spelled out; tag: a numeric field
 * identifier (with Thrift compact, also the type, and for booleans the value);
 * meta: a type marker, length prefix or union branch; value: the field's data;
 * punct: JSON syntax and end-of-struct markers.
 */
export type Role = "name" | "tag" | "meta" | "value" | "punct";
export const ROLES: Role[] = ["name", "tag", "meta", "value", "punct"];

export interface Span {
  field: Field | null;
  role: Role;
  bytes: number[];
  /** Print printable bytes as characters (string payloads and names). */
  text: boolean;
}

export const FORMATS = [
  { id: "json", label: "JSON" },
  { id: "msgpack", label: "MessagePack" },
  { id: "protobuf", label: "Protobuf" },
  { id: "thrift", label: "Thrift compact" },
  { id: "avro", label: "Avro" },
] as const;
export type Format = (typeof FORMATS)[number]["id"];

// ---- byte helpers -------------------------------------------------------------

export const hexToBytes = (h: string): number[] => Array.from({ length: h.length / 2 }, (_, i) => parseInt(h.slice(2 * i, 2 * i + 2), 16));
export const bytesToHex = (b: ArrayLike<number>): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const ascii = (s: string): number[] => Array.from(new TextEncoder().encode(s));

/** Unsigned LEB128 varint, as protobuf, Avro and Thrift compact write it. */
export function varint(v: number | bigint): number[] {
  let x = BigInt(v);
  if (x < 0n) x = BigInt.asUintN(64, x);
  const out: number[] = [];
  do {
    let b = Number(x & 0x7fn);
    x >>= 7n;
    if (x) b |= 0x80;
    out.push(b);
  } while (x);
  return out;
}

/** Zigzag maps signed to unsigned: 0, -1, 1, -2 ... to 0, 1, 2, 3 ... */
export const zigzag = (v: number | bigint): bigint => {
  const x = BigInt(v);
  return x >= 0n ? x << 1n : (-x << 1n) - 1n;
};

const span = (field: Field | null, role: Role, bytes: number[], text = false): Span => ({ field, role, bytes, text });

// ---- encoders ---------------------------------------------------------------------

function base64(bytes: number[]): string {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b = 0, c = 0] = bytes.slice(i, i + 3);
    const n = (a << 16) | (b << 8) | c;
    s += abc[(n >> 18) & 63] + abc[(n >> 12) & 63];
    s += i + 1 < bytes.length ? abc[(n >> 6) & 63] : "=";
    s += i + 2 < bytes.length ? abc[n & 63] : "=";
  }
  return s;
}

/** A JSON string literal as Python's json.dumps writes it (ensure_ascii). */
function jsonString(s: string): string {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (c < 0x20 || (c > 0x7e && c <= 0xffff)) out += "\\u" + c.toString(16).padStart(4, "0");
    else if (c > 0xffff) {
      const v = c - 0x10000;
      out += "\\u" + (0xd800 + (v >> 10)).toString(16) + "\\u" + (0xdc00 + (v & 0x3ff)).toString(16);
    } else out += ch;
  }
  return out + '"';
}

/** Compact JSON, sha256 as base64: json.dumps(r, separators=(",", ":")). */
export function encodeJson(r: Rec): Span[] {
  const out: Span[] = [span(null, "punct", ascii("{"), true)];
  FIELDS.forEach((f, i) => {
    if (i) out.push(span(null, "punct", ascii(","), true));
    out.push(span(f, "name", ascii(jsonString(f)), true));
    out.push(span(f, "punct", ascii(":"), true));
    const v = r[f];
    let lit: string;
    if (v === null) lit = "null";
    else if (typeof v === "boolean") lit = v ? "true" : "false";
    else if (typeof v === "number") lit = String(v);
    else if (f === "sha256") lit = jsonString(base64(hexToBytes(v)));
    else lit = jsonString(v);
    out.push(span(f, "value", ascii(lit), true));
  });
  out.push(span(null, "punct", ascii("}"), true));
  return out;
}

function mpStrHeader(n: number): number[] {
  if (n < 32) return [0xa0 | n];
  if (n < 256) return [0xd9, n];
  return [0xda, n >> 8, n & 255];
}

function mpUint(v: number): { head: number[]; body: number[] } {
  const be = (x: bigint, n: number) => Array.from({ length: n }, (_, i) => Number((x >> BigInt(8 * (n - 1 - i))) & 0xffn));
  const x = BigInt(v);
  if (x < 128n) return { head: [], body: [Number(x)] };
  if (x < 256n) return { head: [0xcc], body: be(x, 1) };
  if (x < 65536n) return { head: [0xcd], body: be(x, 2) };
  if (x < 4294967296n) return { head: [0xce], body: be(x, 4) };
  return { head: [0xcf], body: be(x, 8) };
}

/** msgpack.packb(r): a map keyed by field name, bytes as bin 8. */
export function encodeMsgpack(r: Rec): Span[] {
  const out: Span[] = [span(null, "meta", [0x80 | FIELDS.length])];
  for (const f of FIELDS) {
    out.push(span(f, "meta", mpStrHeader(f.length)));
    out.push(span(f, "name", ascii(f), true));
    const v = r[f];
    if (v === null) out.push(span(f, "value", [0xc0]));
    else if (typeof v === "boolean") out.push(span(f, "value", [v ? 0xc3 : 0xc2]));
    else if (typeof v === "number") {
      const { head, body } = mpUint(v);
      if (head.length) out.push(span(f, "meta", head));
      out.push(span(f, "value", body));
    } else if (f === "sha256") {
      out.push(span(f, "meta", [0xc4, 32]));
      out.push(span(f, "value", hexToBytes(v)));
    } else {
      const b = ascii(v);
      out.push(span(f, "meta", mpStrHeader(b.length)));
      out.push(span(f, "value", b, true));
    }
  }
  return out;
}

/** proto3 FileRecord.SerializeToString(): fields in number order, defaults omitted. */
export function encodeProtobuf(r: Rec): Span[] {
  const out: Span[] = [];
  for (const f of FIELDS) {
    const v = r[f];
    const kind = KIND[f];
    if (kind === "ostring" && v === null) continue; // optional, absent
    if ((kind === "string" || kind === "bytes") && v === "") continue;
    if (kind === "long" && v === 0) continue;
    if (kind === "bool" && v === false) continue;
    if (kind === "long" || kind === "bool") {
      out.push(span(f, "tag", varint((TAG[f] << 3) | 0)));
      out.push(span(f, "value", varint(typeof v === "boolean" ? Number(v) : (v as number))));
    } else {
      const b = f === "sha256" ? hexToBytes(v as string) : ascii(v as string);
      out.push(span(f, "tag", varint((TAG[f] << 3) | 2)));
      out.push(span(f, "meta", varint(b.length)));
      out.push(span(f, "value", b, f !== "sha256"));
    }
  }
  return out;
}

/** thriftpy2 compact protocol: delta-coded field headers, zigzag varints, stop byte. */
export function encodeThrift(r: Rec): Span[] {
  const out: Span[] = [];
  let last = 0;
  for (const f of FIELDS) {
    const v = r[f];
    if (v === null) continue; // optional, unset
    const kind = KIND[f];
    const type = kind === "bool" ? (v ? 1 : 2) : kind === "long" ? 6 : 8;
    const delta = TAG[f] - last;
    const head = delta > 0 && delta <= 15 ? [(delta << 4) | type] : [type, ...varint(zigzag(TAG[f]))];
    last = TAG[f];
    out.push(span(f, "tag", head));
    if (kind === "bool") continue; // the value is the header's type nibble
    if (kind === "long") out.push(span(f, "value", varint(zigzag(v as number))));
    else {
      const b = f === "sha256" ? hexToBytes(v as string) : ascii(v as string);
      out.push(span(f, "meta", varint(b.length)));
      out.push(span(f, "value", b, f !== "sha256"));
    }
  }
  out.push(span(null, "punct", [0]));
  return out;
}

/** fastavro.schemaless_writer: values in schema order, no names, no tags. */
export function encodeAvro(r: Rec, fields: readonly Field[] = FIELDS): Span[] {
  const out: Span[] = [];
  for (const f of fields) {
    const v = r[f];
    const kind = KIND[f];
    if (kind === "ostring") {
      out.push(span(f, "meta", varint(zigzag(v === null ? 0 : 1))));
      if (v === null) continue;
    }
    if (kind === "string" || kind === "ostring") {
      const b = ascii(v as string);
      out.push(span(f, "meta", varint(zigzag(b.length))));
      out.push(span(f, "value", b, true));
    } else if (kind === "long") out.push(span(f, "value", varint(zigzag(v as number))));
    else if (kind === "bool") out.push(span(f, "value", [v ? 1 : 0]));
    else out.push(span(f, "value", hexToBytes(v as string))); // fixed(32): raw bytes
  }
  return out;
}

export function encode(format: Format, r: Rec): Span[] {
  switch (format) {
    case "json":
      return encodeJson(r);
    case "msgpack":
      return encodeMsgpack(r);
    case "protobuf":
      return encodeProtobuf(r);
    case "thrift":
      return encodeThrift(r);
    case "avro":
      return encodeAvro(r);
  }
}

export const flatten = (spans: Span[]): number[] => spans.flatMap((s) => s.bytes);

/** Bytes per role, for the stacked bars. */
export function roleTotals(spans: Span[]): Record<Role, number> {
  const t = { name: 0, tag: 0, meta: 0, value: 0, punct: 0 } as Record<Role, number>;
  for (const s of spans) t[s.role] += s.bytes.length;
  return t;
}

// ---- decoders: a reader whose schema dropped requires_python ----------------------

/** Version 2 of the schema deletes requires_python (field 6). */
export const V2_FIELDS: readonly Field[] = FIELDS.filter((f) => f !== "requires_python");

export type Value = string | number | boolean | null;

export interface ReadStep {
  field: Field | null; // null: bytes the reader skipped without a field to put them in
  start: number;
  end: number;
  value?: Value;
  note: "read" | "skipped" | "unknown";
}

export interface ReadResult {
  steps: ReadStep[];
  values: Partial<Record<Field, Value>>;
  error: string | null;
  trailing: number; // bytes left unread when decoding stopped
}

class Cursor {
  pos = 0;
  constructor(readonly b: number[]) {}
  byte(): number {
    if (this.pos >= this.b.length) throw new Error("EOFError");
    return this.b[this.pos++];
  }
  take(n: number): number[] {
    if (n < 0 || this.pos + n > this.b.length) throw new Error("EOFError");
    const out = this.b.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  uvarint(): bigint {
    let x = 0n;
    let shift = 0n;
    for (;;) {
      const b = this.byte();
      x |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return x;
      shift += 7n;
    }
  }
  long(): number {
    const u = this.uvarint();
    return Number(BigInt.asIntN(64, (u >> 1n) ^ -(u & 1n)));
  }
}

const utf8 = (b: number[]) => new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(b));

function avroValue(c: Cursor, kind: (typeof KIND)[Field]): Value {
  if (kind === "ostring") {
    const branch = c.long();
    if (branch === 0) return null;
    if (branch !== 1) throw new Error("IndexError");
    kind = "string";
  }
  if (kind === "string") return utf8(c.take(c.long()));
  if (kind === "long") return c.long();
  if (kind === "bool") return c.byte() !== 0;
  return bytesToHex(c.take(32));
}

/**
 * Decode Avro bytes written with the full schema by a reader whose schema
 * lacks requires_python. With the writer's schema the reader walks the bytes
 * as written and drops requires_python (schema resolution). Without it, the
 * reader walks the bytes as if its own schema had written them.
 */
export function readAvro(bytes: number[], writerSchemaKnown: boolean): ReadResult {
  const c = new Cursor(bytes);
  const steps: ReadStep[] = [];
  const values: Partial<Record<Field, Value>> = {};
  const walk = writerSchemaKnown ? FIELDS : V2_FIELDS;
  let error: string | null = null;
  try {
    for (const f of walk) {
      const start = c.pos;
      const v = avroValue(c, KIND[f]);
      const kept = V2_FIELDS.includes(f);
      steps.push({ field: f, start, end: c.pos, value: v, note: kept ? "read" : "skipped" });
      if (kept) values[f] = v;
    }
  } catch (e) {
    error = (e as Error).message;
  }
  return { steps, values, error, trailing: error ? 0 : bytes.length - c.pos };
}

/**
 * Decode protobuf bytes with the version 2 message. Field 6 is not in its
 * schema; the wire type in the tag tells the parser how long the field is,
 * so it is skipped (and kept as an unknown field) rather than misread.
 */
export function readProtobuf(bytes: number[]): ReadResult {
  const c = new Cursor(bytes);
  const steps: ReadStep[] = [];
  const values: Partial<Record<Field, Value>> = {};
  const byTag = new Map(V2_FIELDS.map((f) => [TAG[f], f]));
  for (const f of V2_FIELDS) {
    const k = KIND[f];
    values[f] = k === "long" ? 0 : k === "bool" ? false : "";
  }
  let error: string | null = null;
  try {
    while (c.pos < bytes.length) {
      const start = c.pos;
      const key = Number(c.uvarint());
      const tag = key >> 3;
      const wt = key & 7;
      let v: Value;
      if (wt === 0) v = Number(c.uvarint());
      else if (wt === 2) v = bytesToHex(c.take(Number(c.uvarint())));
      else throw new Error(`unsupported wire type ${wt}`);
      const f = byTag.get(tag);
      if (!f) {
        steps.push({ field: null, start, end: c.pos, note: "unknown" });
        continue;
      }
      const kind = KIND[f];
      if (kind === "bool") v = v !== 0;
      else if (kind === "string") v = utf8(hexToBytes(v as string));
      values[f] = v;
      steps.push({ field: f, start, end: c.pos, value: v, note: "read" });
    }
  } catch (e) {
    error = (e as Error).message;
  }
  return { steps, values, error, trailing: 0 };
}

/** The value a correct reader of version 2 should see for each field. */
export function expectedV2(r: Rec): Partial<Record<Field, Value>> {
  return Object.fromEntries(V2_FIELDS.map((f) => [f, r[f]]));
}
