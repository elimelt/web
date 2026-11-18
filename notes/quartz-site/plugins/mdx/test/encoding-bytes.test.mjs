// Checks the encoding figure's model against independent references: bytes
// that Python's json, msgpack, protobuf (upb), thriftpy2 and fastavro wrote
// for the same records (test/encoding-bytes.fixture.json, made by
// make_figure_fixture.py beside the note), and fastavro's own result when a
// reader decodes Avro bytes with the wrong schema.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { load } from "./load.mjs";

const m = await load("components/encoding-bytes/model.ts");
const r = await load("components/encoding-bytes/render.ts");
const cases = JSON.parse(readFileSync(new URL("./encoding-bytes.fixture.json", import.meta.url)));

test("every encoder matches the Python library byte for byte", () => {
  assert.ok(cases.length >= 30);
  for (const c of cases) {
    for (const { id } of m.FORMATS) {
      const got = m.bytesToHex(m.flatten(m.encode(id, c.record)));
      assert.equal(got, c.bytes[id], `${id} ${c.record.filename}`);
    }
  }
});

test("the three featured records are in the fixture unchanged", () => {
  for (const { rec } of m.RECORDS) {
    const c = cases.find((x) => x.record.filename === rec.filename);
    assert.ok(c, rec.filename);
    assert.deepEqual(rec, c.record);
  }
});

test("every byte belongs to exactly one span, and spans name real fields", () => {
  for (const c of cases)
    for (const { id } of m.FORMATS) {
      const spans = m.encode(id, c.record);
      const totals = m.roleTotals(spans);
      const sum = Object.values(totals).reduce((a, b) => a + b, 0);
      assert.equal(sum, c.bytes[id].length / 2);
      for (const s of spans) assert.ok(s.field === null || m.FIELDS.includes(s.field));
    }
});

test("only JSON and MessagePack spend bytes on field names; only Avro spends none on field identity", () => {
  for (const c of cases) {
    const t = Object.fromEntries(m.FORMATS.map(({ id }) => [id, m.roleTotals(m.encode(id, c.record))]));
    assert.ok(t.json.name > 0 && t.msgpack.name > 0);
    assert.equal(t.protobuf.name + t.thrift.name + t.avro.name, 0);
    assert.ok(t.protobuf.tag > 0 && t.thrift.tag > 0);
    assert.equal(t.avro.tag, 0);
  }
});

test("Avro read without the writer's schema agrees with fastavro, value for value", () => {
  for (const c of cases) {
    const bytes = m.hexToBytes(c.bytes.avro);
    const got = m.readAvro(bytes, false);
    if (!c.avro_misread.ok) {
      assert.ok(got.error, `${c.record.filename}: fastavro raised ${c.avro_misread.error}`);
      continue;
    }
    assert.equal(got.error, null, c.record.filename);
    assert.deepEqual(got.values, c.avro_misread.value, c.record.filename);
  }
});

test("Avro read with the writer's schema, and protobuf with tags, recover every value", () => {
  for (const c of cases) {
    const want = m.expectedV2(c.record);
    const av = m.readAvro(m.hexToBytes(c.bytes.avro), true);
    assert.equal(av.error, null);
    assert.equal(av.trailing, 0);
    assert.deepEqual(av.values, { ...want, sha256: c.record.sha256 });
    const pb = m.readProtobuf(m.hexToBytes(c.bytes.protobuf));
    assert.equal(pb.error, null);
    assert.deepEqual(pb.values, want);
    const unknown = pb.steps.filter((s) => s.note === "unknown");
    assert.equal(unknown.length, c.record.requires_python === null ? 0 : 1);
  }
});

test("protobuf keeps the unknown field and re-serializes it after the known ones, as upb does", () => {
  for (const c of cases) {
    const bytes = m.hexToBytes(c.bytes.protobuf);
    const pb = m.readProtobuf(bytes);
    const known = pb.steps.filter((s) => s.note === "read").flatMap((s) => bytes.slice(s.start, s.end));
    const unknown = pb.steps.filter((s) => s.note === "unknown").flatMap((s) => bytes.slice(s.start, s.end));
    assert.equal(m.bytesToHex([...known, ...unknown]), c.proto_v2_reserialized);
  }
});

test("varint and zigzag agree with closed forms", () => {
  for (const v of [0, 1, 63, 64, 127, 128, 300, 2 ** 31, 2 ** 53 - 1]) {
    const b = m.varint(v);
    let x = 0n;
    b.forEach((byte, i) => (x |= BigInt(byte & 0x7f) << BigInt(7 * i)));
    assert.equal(x, BigInt(v));
    assert.equal(b.length, Math.max(1, Math.ceil(Math.log2(v + 1) / 7)));
  }
  assert.deepEqual([0, -1, 1, -2, 2].map((v) => Number(m.zigzag(v))), [0, 1, 2, 3, 4]);
});

test("render produces a finished, disabled figure for each preset", () => {
  const a = r.render({});
  const b = r.render({ preset: "misread" });
  assert.match(a, /<figure class="eb"/);
  assert.match(b, /data-preset="misread"/);
  assert.ok(!/<button(?![^>]*disabled)[^>]*>/.test(a.replace(/<button[^>]*disabled[^>]*>/g, "")));
});
