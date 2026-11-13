// Shared by the tests: bundles a TypeScript module from src/ with esbuild and
// imports it, so a test checks the same code the build and the browser run.
//
//   import { load } from "./load.mjs";
//   const model = await load("components/queue-lab/model.ts");

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src");
const dir = mkdtempSync(path.join(tmpdir(), "mdx-test-"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));

export async function load(entry) {
  const outfile = path.join(dir, `${entry.replace(/[/.]/g, "_")}.mjs`);
  await esbuild.build({ entryPoints: [path.join(src, entry)], outfile, bundle: true, format: "esm", platform: "node", logLevel: "silent" });
  return import(pathToFileURL(outfile).href);
}
