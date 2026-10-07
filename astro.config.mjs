import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://elimelt.com',
  srcDir: './frontend/src',
  publicDir: './frontend/public',
  outDir: './dist/frontend',
  output: 'static',
  // Preserve prose whitespace around inline links across component boundaries.
  compressHTML: false,
  trailingSlash: 'always',
  server: { port: 3000 },
});
