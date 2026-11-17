// Rebuilds tiktoken's .tiktoken rank files from the copies bundled in the npm
// package js-tiktoken (openaipublic.blob.core.windows.net was unreachable).
// Check the output with sha256sum against expected_hash in
// tiktoken_ext/openai_public.py.
//   node rebuild_tiktoken.mjs <js-tiktoken package dir> <out dir>
import fs from "fs";
const [pkg, out] = process.argv.slice(2);
for (const name of ["r50k_base", "cl100k_base", "o200k_base"]) {
  const m = (await import(`${pkg}/dist/ranks/${name}.js`)).default;
  const rows = [];
  for (const x of m.bpe_ranks.split("\n").filter(Boolean)) {
    const [, off, ...toks] = x.split(" ");
    toks.forEach((t, i) => rows.push([t, Number(off) + i]));
  }
  rows.sort((a, b) => a[1] - b[1]);
  fs.writeFileSync(`${out}/${name}.tiktoken`, rows.map(([t, r]) => `${t} ${r}`).join("\n") + "\n");
}
