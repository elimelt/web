import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist');
await rm(output, { recursive: true, force: true });
execFileSync(resolve(root, 'node_modules/.bin/astro'), ['build'], { cwd: root, stdio: 'inherit' });
await mkdir(resolve(output, 'infra/homepage'), { recursive: true });
await cp(resolve(root, 'infra/homepage'), resolve(output, 'infra/homepage'), {
  recursive: true,
  filter: (path) => !path.endsWith('.ts'),
});
execFileSync(resolve(root, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.homepage.json'], { cwd: root, stdio: 'inherit' });
console.log('Built Astro site in dist/frontend and homepage in dist/infra/homepage');
