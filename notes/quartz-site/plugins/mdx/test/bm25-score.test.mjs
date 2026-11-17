// Checks the in-browser BM25 against figure_data.py's reference, which ranks
// the whole SciFact collection with ir_bench.BM25 (itself checked against the
// bm25s library by check_bm25s.py), and checks the scoring identities.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "../../../../content/ml/nlp/reading/information-retrieval-experiments");
const data = JSON.parse(readFileSync(path.join(dir, "bm25-figure.json"), "utf8"));
const expected = JSON.parse(readFileSync(path.join(dir, "bm25-figure-expected.json"), "utf8"));

const model = await load("components/bm25-score/model.ts");
const view = await load("components/bm25-score/view.ts");
const render = await load("components/bm25-score/render.ts");

test("top 10 and relevant rank match the whole-collection Python ranking", () => {
  for (const [qid, settings] of Object.entries(expected)) {
    const p = data.presets[qid];
    for (const s of settings) {
      const ranked = model.rankAll(data, p, s.k1, s.b);
      const top = ranked.slice(0, 10);
      // Python ranks all 5,183 documents; zero-score documents only appear if fewer than 10 contain a term.
      const exp = s.top.filter(([, sc]) => sc > 0);
      exp.forEach(([id, sc], r) => {
        assert.equal(String(p.ids[top[r].i]), id, `${qid} k1=${s.k1} b=${s.b} rank ${r + 1} id`);
        assert.ok(Math.abs(top[r].score - sc) < 1e-9, `${qid} k1=${s.k1} b=${s.b} rank ${r + 1} score ${top[r].score} vs ${sc}`);
      });
      assert.equal(model.relRank(p, ranked), s.rel_rank, `${qid} k1=${s.k1} b=${s.b} relevant rank`);
    }
  }
});

test("term contributions sum to the score, and the limiting cases of k1 and b hold", () => {
  for (const p of Object.values(data.presets)) {
    for (let i = 0; i < p.docs.length; i += 97) {
      const s = model.scoreDoc(data, p, i, 1.2, 0.75);
      assert.ok(Math.abs(s.parts.reduce((a, b) => a + b, 0) - s.score) < 1e-12);
      // k1 = 0: each present term contributes exactly qtf * idf, whatever its tf
      const z = model.scoreDoc(data, p, i, 0, 0.75);
      p.terms.forEach((_, j) => {
        const want = p.docs[i][j + 1] > 0 ? p.qtf[j] * model.idf(data.N, p.df[j]) : 0;
        assert.ok(Math.abs(z.parts[j] - want) < 1e-12);
      });
      // b = 0: length has no effect, so a document's score equals that of the same tf at any length
      const a = model.scoreDoc(data, p, i, 1.2, 0);
      const longer = { ...p, docs: p.docs.map((d, k) => (k === i ? [d[0] * 3, ...d.slice(1)] : d)) };
      assert.ok(Math.abs(model.scoreDoc(data, longer, i, 1.2, 0).score - a.score) < 1e-12);
      // each contribution is below its ceiling qtf * idf
      a.parts.forEach((x, j) => assert.ok(x <= p.qtf[j] * model.idf(data.N, p.df[j]) + 1e-12));
    }
  }
});

test("the slice is complete: df equals the number of slice documents containing each term", () => {
  for (const p of Object.values(data.presets)) {
    p.terms.forEach((_, j) => {
      assert.equal(p.docs.filter((d) => d[j + 1] > 0).length, p.df[j]);
    });
    assert.ok(p.docs.every((d) => d.slice(1).some((x) => x > 0)));
    // ids in corpus order and unique
    for (let i = 1; i < p.ids.length; i++) assert.notEqual(p.ids[i], p.ids[i - 1]);
  }
});

test("every document the figure can show has a title", () => {
  for (const [qid, p] of Object.entries(data.presets)) {
    for (let k1 = 0; k1 <= 30; k1++) {
      for (let b = 0; b <= 20; b++) {
        const ranked = model.rankAll(data, p, k1 / 10, b / 20);
        const r = model.relRank(p, ranked);
        const shown = ranked.slice(0, view.SHOW).map((s) => s.i);
        if (r && r > view.SHOW) shown.push(ranked[r - 1].i);
        for (const i of shown) assert.ok(p.titles[String(i)], `${qid} k1=${k1 / 10} b=${b / 20}: no title for slice doc ${i}`);
      }
    }
  }
});

test("render produces one figure per preset and the ordinal helper is right", () => {
  for (const qid of Object.keys(data.presets)) {
    const html = render.render({ query: qid });
    assert.equal((html.match(/<figure/g) ?? []).length, 1);
    assert.match(html, /bm-is-rel/);
  }
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(view.ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th"]);
});
