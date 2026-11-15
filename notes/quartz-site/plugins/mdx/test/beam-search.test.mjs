// Checks the in-browser beam search against figure_replay.py, an independent
// Python replay of the same recorded log-probabilities, which itself checks
// that its finished hypotheses match the live translation model's search.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "../../../../content/ml/nlp/decoding-strategies-experiments");
const data = JSON.parse(readFileSync(path.join(dir, "beam-figure.json"), "utf8"));
const expected = JSON.parse(readFileSync(path.join(dir, "beam-figure-expected.json"), "utf8"));

const model = await load("components/beam-search/model.ts");
const view = await load("components/beam-search/view.ts");
const p = model.prepare(data);
const plain = (hs) => hs.map((h) => [h.tokens, h.score]);
const close = (a, b, msg) => {
  assert.equal(a.length, b.length, msg);
  a.forEach(([t, s], i) => {
    assert.deepEqual(t, b[i][0], `${msg} #${i} tokens`);
    assert.ok(Math.abs(s - b[i][1]) < 1e-9, `${msg} #${i} score ${s} vs ${b[i][1]}`);
  });
};

test("every step matches the Python replay at every width", () => {
  for (let k = 1; k <= data.kmax; k++) {
    const run = model.search(p, k);
    const exp = expected[String(k)];
    assert.equal(run.steps.length, exp.steps.length, `width ${k} step count`);
    run.steps.forEach((st, i) => {
      close(plain(st.kept), exp.steps[i].kept, `k=${k} step ${i + 1} kept`);
      close(plain(st.pruned), exp.steps[i].pruned, `k=${k} step ${i + 1} pruned`);
      close(plain(st.finished), exp.steps[i].finished, `k=${k} step ${i + 1} finished`);
    });
    close(plain(run.finished), exp.finished, `k=${k} finished`);
    assert.equal(model.best(run.finished, "raw"), exp.raw, `k=${k} raw pick`);
    assert.equal(model.best(run.finished, "norm"), exp.norm, `k=${k} normalized pick`);
  }
});

test("matches the live model's finished hypotheses to the stored precision", () => {
  for (let k = 1; k <= data.kmax; k++) {
    const run = model.search(p, k);
    const live = data.live[String(k)];
    assert.deepEqual(run.finished.map((h) => h.tokens), live.map((h) => h[0]), `width ${k}`);
    run.finished.forEach((h, i) => assert.ok(Math.abs(h.score - live[i][1]) < 2e-3, `width ${k} #${i}`));
  }
});

test("invariants: beam size, candidate order, monotone scores, stopping rule", () => {
  for (let k = 1; k <= data.kmax; k++) {
    const run = model.search(p, k);
    let prevBest = 0;
    run.steps.forEach((st, i) => {
      const last = i === run.steps.length - 1;
      if (!last) assert.equal(st.kept.length, k);
      const all = [...st.kept, ...st.finished, ...st.pruned].map((h) => h.score);
      assert.ok(all.length <= 2 * k);
      const worstKept = Math.min(...st.kept.map((h) => h.score));
      for (const h of st.pruned) if (h.tokens.at(-1) !== model.EOS) assert.ok(h.score <= worstKept);
      const top = Math.max(...st.kept.map((h) => h.score));
      if (st.kept.length) {
        assert.ok(top <= prevBest + 1e-12, "log-probabilities only decrease");
        prevBest = top;
      }
    });
    assert.ok(run.finished.length >= k || run.steps.length === data.max_len);
    assert.ok(run.finished.length - run.steps.at(-1).finished.length < k, "stops at the first step with k finished");
  }
});

test("raw score prefers the short translation that normalization rejects", () => {
  const short = "Die Brücke wurde von Capt Samuel Brown entworfen.";
  const long = "Die Brücke wurde von dem englischen Royal Navy Officer Capt Samuel Brown entworfen.";
  for (let k = 1; k <= data.kmax; k++) {
    const fin = model.search(p, k).finished;
    assert.equal(model.detok(data.vocab, fin[model.best(fin, "raw")].tokens), short);
    assert.equal(model.detok(data.vocab, fin[model.best(fin, "norm")].tokens), k >= 3 ? long : short);
  }
});

test("renders a finished default figure with disabled controls", () => {
  const s = view.makeState(p, 3, "raw");
  const html = view.figureHtml(p, s, "/x.json");
  assert.match(html, /<figure class="bs"/);
  assert.ok(!/<button(?![^>]*disabled)[^>]*>/.test(html), "every button starts disabled");
  assert.match(html, /bs-best/);
  assert.match(html, new RegExp(`step ${s.run.steps.length} / ${s.run.steps.length}`));
});
