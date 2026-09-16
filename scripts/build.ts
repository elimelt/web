import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist');
await rm(output, { recursive: true, force: true });
for (const directory of ['frontend', 'infra/homepage']) {
  await mkdir(resolve(output, directory), { recursive: true });
  await cp(resolve(root, directory), resolve(output, directory), {
    recursive: true,
    filter: (path) => !path.endsWith('.ts'),
  });
}
execFileSync(resolve(root, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.json'], { cwd: root, stdio: 'inherit' });
await mkdir(resolve(output, 'frontend/js/vendor'), { recursive: true });
await cp(resolve(root, 'node_modules/dompurify/dist/purify.es.mjs'), resolve(output, 'frontend/js/vendor/purify.js'));
await cp(resolve(root, 'node_modules/dompurify/LICENSE'), resolve(output, 'frontend/js/vendor/DOMPurify-LICENSE'));
const maplibreOutput = resolve(output, 'frontend/js/vendor/maplibre-gl');
await mkdir(maplibreOutput, { recursive: true });
for (const file of ['maplibre-gl.mjs', 'maplibre-gl-shared.mjs', 'maplibre-gl-worker.mjs', 'maplibre-gl.css']) {
  await cp(resolve(root, 'node_modules/maplibre-gl/dist', file), resolve(maplibreOutput, file));
}
await cp(resolve(root, 'node_modules/maplibre-gl/LICENSE.txt'), resolve(maplibreOutput, 'LICENSE.txt'));
console.log('Built site in dist/frontend and homepage in dist/infra/homepage');
