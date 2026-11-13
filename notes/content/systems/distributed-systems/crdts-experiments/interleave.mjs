// Interleaving trials. Two replicas start from the same random text, each
// types a random word at the same random index while offline, then they sync.
// A trial interleaves if the merged text around that index is not one word
// followed by the other. Runs the figure's three list CRDTs and two libraries.
//
//   node interleave.mjs [trials]  > interleave-results.json
import * as Y from "yjs";
import * as Am from "@automerge/automerge";
import { load } from "../../../../quartz-site/plugins/mdx/test/load.mjs";

const m = await load("components/list-crdt/model.ts");
const TRIALS = Number(process.argv[2] ?? 1000);

function rng(seed) {
  let x = seed >>> 0 || 1;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const word = (rand, alphabet) => Array.from({ length: 3 + Math.floor(rand() * 6) }, () => alphabet[Math.floor(rand() * alphabet.length)]).join("");

function trial(seed) {
  const rand = rng(seed);
  const base = word(rand, "-.").padEnd(8, "-").slice(0, 3 + Math.floor(rand() * 6));
  return {
    base,
    at: Math.floor(rand() * (base.length + 1)),
    w1: word(rand, "abcdefghij"), // replica 1 types lowercase
    w2: word(rand, "QRSTUVWXYZ"), // replica 2 types uppercase
    swap: rand() < 0.5, // which replica id sorts first
    seed,
  };
}

const interleaved = (t, merged) => {
  const region = merged.slice(t.at, t.at + t.w1.length + t.w2.length);
  return region !== t.w1 + t.w2 && region !== t.w2 + t.w1;
};

function runModel(algo, t, back1, back2) {
  const [r1, r2] = t.swap ? ["B", "A"] : ["A", "B"];
  const docs = { A: m.createDoc(algo, "A", t.seed * 3 + 1), B: m.createDoc(algo, "B", t.seed * 3 + 2) };
  const o = m.createDoc(algo, "o", t.seed * 3);
  for (const op of m.splice(o, 0, 0, t.base)) { docs.A.apply(op); docs.B.apply(op); }
  const ops1 = m.keystrokes(t.w1, t.at, back1).map(([i, c]) => docs[r1].insert(i, c));
  const ops2 = m.keystrokes(t.w2, t.at, back2).map(([i, c]) => docs[r2].insert(i, c));
  for (const op of ops1) docs[r2].apply(op);
  for (const op of ops2) docs[r1].apply(op);
  if (docs.A.text() !== docs.B.text()) throw new Error(`${algo} diverged`);
  return docs.A.text();
}

function runYjs(t, back1, back2) {
  const base = new Y.Doc();
  base.getText("t").insert(0, t.base);
  const s = Y.encodeStateAsUpdate(base);
  const [c1, c2] = t.swap ? [2_000_000 + t.seed, 1_000_000 + t.seed] : [1_000_000 + t.seed, 2_000_000 + t.seed];
  const d1 = new Y.Doc(); d1.clientID = c1; Y.applyUpdate(d1, s);
  const d2 = new Y.Doc(); d2.clientID = c2; Y.applyUpdate(d2, s);
  for (const [i, c] of m.keystrokes(t.w1, t.at, back1)) d1.getText("t").insert(i, c);
  for (const [i, c] of m.keystrokes(t.w2, t.at, back2)) d2.getText("t").insert(i, c);
  Y.applyUpdate(d1, Y.encodeStateAsUpdate(d2));
  Y.applyUpdate(d2, Y.encodeStateAsUpdate(d1));
  const a = d1.getText("t").toString();
  if (a !== d2.getText("t").toString()) throw new Error("yjs diverged");
  return a;
}

function runAutomerge(t, back1, back2) {
  const base = Am.from({ t: t.base }, { actor: "ff" });
  const [a1, a2] = t.swap ? ["0b", "0a"] : ["0a", "0b"];
  let d1 = Am.clone(base, { actor: a1 }), d2 = Am.clone(base, { actor: a2 });
  for (const [i, c] of m.keystrokes(t.w1, t.at, back1)) d1 = Am.change(d1, (d) => Am.splice(d, ["t"], i, 0, c));
  for (const [i, c] of m.keystrokes(t.w2, t.at, back2)) d2 = Am.change(d2, (d) => Am.splice(d, ["t"], i, 0, c));
  const x = Am.merge(Am.clone(d1), d2), y = Am.merge(Am.clone(d2), d1);
  if (x.t !== y.t) throw new Error("automerge diverged");
  return x.t;
}

const impls = {
  fugue: (t, a, b) => runModel("fugue", t, a, b),
  rga: (t, a, b) => runModel("rga", t, a, b),
  logoot: (t, a, b) => runModel("logoot", t, a, b),
  "yjs 13.6.33": runYjs,
  "automerge 3.5.0": runAutomerge,
};
const modes = { "forwards/forwards": [false, false], "backwards/backwards": [true, true], "forwards/backwards": [false, true] };

const out = { trials: TRIALS, results: {}, examples: {} };
for (const [name, fn] of Object.entries(impls)) {
  out.results[name] = {};
  for (const [mode, [b1, b2]] of Object.entries(modes)) {
    let n = 0;
    for (let s = 1; s <= TRIALS; s++) {
      const t = trial(s);
      const merged = fn(t, b1, b2);
      if (interleaved(t, merged)) {
        n++;
        out.examples[`${name} ${mode}`] ??= { ...t, merged };
      }
    }
    out.results[name][mode] = n;
  }
}
console.log(JSON.stringify(out, null, 1));
