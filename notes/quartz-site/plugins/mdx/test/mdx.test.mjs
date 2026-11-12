// Tests the built bundle, which is what Quartz loads. Run `npm run build` first.
import assert from "node:assert/strict";
import { test } from "node:test";
import plugin from "../dist/index.js";

const mdx = plugin();
const transform = (body, frontmatter = "title: T\nmdx: true") =>
  mdx.textTransform(null, `---\n${frontmatter}\n---\n\n${body}`);

test("leaves notes that aren't marked as MDX alone", () => {
  const src = "---\ntitle: T\n---\n\n<BenchmarkNoise />\n\n{not an expression}";
  assert.equal(mdx.textTransform(null, src), src);
});

test("swaps a component tag for a placeholder with its literal props", () => {
  const out = transform("Before [[a|b]] and $\\frac{x}{y}$.\n\n<BenchmarkNoise seed={-3} label=\"x\" flag />\n\nAfter.");
  const match = out.match(/<div data-mdx-component="BenchmarkNoise" data-mdx-props="([\w-]+)"><\/div>/);
  assert.ok(match, out);
  assert.deepEqual(JSON.parse(Buffer.from(match[1], "base64url").toString()), { seed: -3, label: "x", flag: true });
  assert.ok(out.includes("Before [[a|b]] and $\\frac{x}{y}$."));
  assert.ok(out.endsWith("\n\nAfter."));
});

test("drops MDX comments", () => {
  assert.ok(!transform("Text\n\n{/* hidden */}\n\nMore").includes("hidden"));
});

test("fails the build on what it can't render", () => {
  assert.throws(() => transform("import X from './x'\n\nText"), /import and export/);
  assert.throws(() => transform("Total: {1 + 1}"), /expressions/);
  assert.throws(() => transform("Inline <BenchmarkNoise /> here"), /own lines/);
  assert.throws(() => transform("<Missing />"), /unknown component <Missing>/);
  assert.throws(() => transform("<BenchmarkNoise seed={x} />"), /variable x/);
  assert.throws(() => transform("- item\n\n  <BenchmarkNoise />"), /top level/);
});

test("renders the component and links its module", () => {
  const html = { type: "html", value: transform("<BenchmarkNoise />").trim().split("\n\n").pop() };
  const tree = { type: "root", children: [html] };
  mdx.markdownPlugins()[0]()(tree);
  const node = tree.children[0];
  assert.equal(node.data.hName, "div");
  assert.match(node.data.hProperties.dataMdxModule, /^\/static\/mdx\/benchmark-noise\.js\?v=[0-9a-f]{10}$/);
  assert.match(node.data.hChildren[0].value, /^<figure class="bn"[\s\S]*Simulated data[\s\S]*<\/figure>$/);
});
