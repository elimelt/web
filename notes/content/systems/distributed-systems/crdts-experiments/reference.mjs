// Writes reference-sessions.json: random two-replica editing sessions and the
// text Automerge (whose text type is RGA) converges to for each. The figure's
// tests replay the same sessions through its own RGA and require the same
// text. fugue_ref.py then adds the result of an independent Fugue.
//
//   (cd ../../../../quartz-site/plugins/mdx && npm install)
//   npm install && node reference.mjs && python3 fugue_ref.py
import { writeFileSync } from "node:fs";
import * as A from "@automerge/automerge";
import { load } from "../../../../quartz-site/plugins/mdx/test/load.mjs";

const m = await load("components/list-crdt/model.ts");
const ACTOR = { o: "ff", A: "0a", B: "0b" };

function rng(seed) {
  let x = seed >>> 0 || 1;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** A session: base text, then rounds of local edits at A and B with a full sync after some rounds. */
function makeSession(seed) {
  const rand = rng(seed);
  const len = { A: 0, B: 0 };
  const base = "abcdefgh".slice(0, 1 + Math.floor(rand() * 8));
  len.A = len.B = base.length;
  const actions = [];
  const rounds = 2 + Math.floor(rand() * 5);
  for (let r = 0; r < rounds; r++) {
    for (const who of ["A", "B"]) {
      const n = Math.floor(rand() * 6);
      for (let i = 0; i < n; i++) {
        if (len[who] > 0 && rand() < 0.3) {
          actions.push({ r: who, del: Math.floor(rand() * len[who]) });
          len[who]--;
        } else {
          const ch = (who === "A" ? "ABCDEFGHIJ" : "0123456789")[Math.floor(rand() * 10)];
          actions.push({ r: who, ins: Math.floor(rand() * (len[who] + 1)), ch });
          len[who]++;
        }
      }
    }
    if (r === rounds - 1 || rand() < 0.5) {
      actions.push({ sync: true });
      // After a full sync both replicas hold every op; work out the shared length.
      const sim = replayModel("fugue", { base, actions });
      len.A = len.B = sim.docs.A.text().length;
    }
  }
  return { seed, base, actions };
}

/** Replays a session through the figure's model, to track each replica's length. */
function replayModel(algo, s) {
  const sim = m.newSim(algo, false, s.base);
  for (const a of s.actions) m.act(sim, a);
  return sim;
}

function replayAutomerge(s) {
  let origin = A.from({ t: "" }, { actor: ACTOR.o });
  for (let i = 0; i < s.base.length; i++) origin = A.change(origin, (d) => A.splice(d, ["t"], i, 0, s.base[i]));
  const doc = { A: A.clone(origin, { actor: ACTOR.A }), B: A.clone(origin, { actor: ACTOR.B }) };
  for (const a of s.actions) {
    if (a.sync) {
      const a2 = A.merge(doc.A, A.clone(doc.B));
      const b2 = A.merge(doc.B, A.clone(doc.A));
      doc.A = a2;
      doc.B = b2;
    } else if (a.del !== undefined) doc[a.r] = A.change(doc[a.r], (d) => A.splice(d, ["t"], a.del, 1));
    else doc[a.r] = A.change(doc[a.r], (d) => A.splice(d, ["t"], a.ins, 0, a.ch));
  }
  if (doc.A.t !== doc.B.t) throw new Error("automerge replicas differ after the final sync");
  return doc.A.t;
}

const sessions = [];
for (let seed = 1; sessions.length < 80; seed++) {
  const s = makeSession(seed);
  s.automerge = replayAutomerge(s);
  sessions.push(s);
}
writeFileSync(new URL("./reference-sessions.json", import.meta.url), JSON.stringify({ generator: "reference.mjs", automerge: "3.5.0", actors: ACTOR, sessions }) + "\n");
console.log(`wrote ${sessions.length} sessions`);
