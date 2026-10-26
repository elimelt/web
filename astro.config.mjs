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
  vite: {
    define: {
      // Services, visitors, chat, notes search and click tracking talk to the
      // homelab API at api.elimelt.com. The site ships without them; build with
      // LIVE_FEATURES=true once that API is running again.
      __LIVE_FEATURES__: JSON.stringify(process.env.LIVE_FEATURES === 'true'),
    },
  },
});
