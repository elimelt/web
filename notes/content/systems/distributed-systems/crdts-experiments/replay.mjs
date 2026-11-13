// Replays a real editing trace into Yjs and Automerge and records time and
// encoded size. Usage: node replay.mjs <trace.json.gz> <runs>
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import * as Y from "yjs";
import * as A from "@automerge/automerge";

const [file, runsArg] = process.argv.slice(2);
const runs = Number(runsArg ?? 5);
const trace = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8"));
const { txns, endContent } = trace;

let inserted = 0, deleted = 0, patches = 0;
for (const t of txns) for (const [, d, ins] of t.patches) { patches++; deleted += d; inserted += ins.length; }

function yjs(gc) {
  const doc = new Y.Doc({ gc });
  const text = doc.getText("t");
  const t0 = performance.now();
  for (const t of txns) doc.transact(() => {
    for (const [pos, del, ins] of t.patches) {
      if (del) text.delete(pos, del);
      if (ins) text.insert(pos, ins);
    }
  });
  const ms = performance.now() - t0;
  if (text.toString() !== endContent) throw new Error("yjs mismatch");
  const bytes = Y.encodeStateAsUpdate(doc).length;
  return { ms, bytes };
}

function automerge() {
  let doc = A.from({ t: "" });
  const t0 = performance.now();
  for (const t of txns) doc = A.change(doc, (d) => {
    for (const [pos, del, ins] of t.patches) A.splice(d, ["t"], pos, del, ins);
  });
  const ms = performance.now() - t0;
  if (doc.t !== endContent) throw new Error("automerge mismatch");
  const bytes = A.save(doc).length;
  return { ms, bytes };
}

const out = { trace: file.split("/").pop(), txns: txns.length, patches, inserted, deleted, finalChars: endContent.length, runs: {} };
const impls = { "yjs-gc": () => yjs(true), "yjs-nogc": () => yjs(false), automerge };
for (const [name, fn] of Object.entries(impls)) {
  out.runs[name] = [];
  for (let i = 0; i < runs; i++) out.runs[name].push(fn());
}
console.log(JSON.stringify(out));
