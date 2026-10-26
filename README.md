# Personal Site

This repository holds the public site (elimelt.com), the notes site in [`notes/`](notes/README.md) (notes.elimelt.com), the blog in [`blog/`](blog/README.md) (blog.elimelt.com), and the homelab in [`infra/`](infra/README.md). The three sites build and deploy independently.

The public frontend uses [Astro](https://astro.build) with TypeScript. Astro renders the portfolio and music pages to static HTML and bundles their interactive modules. The homelab homepage remains a separate TypeScript application.

## Development

Use Node.js 22.12 or newer.

```bash
npm ci
npm run dev
```

Open http://localhost:3000. Astro reloads page, component, style, and script changes automatically.

- `frontend/src/pages/` defines `/` and `/music/`.
- `frontend/src/layouts/` contains shared document structure.
- `frontend/src/components/` contains portfolio sections and music controls.
- `frontend/js/` contains portfolio behavior and API clients; `frontend/music/` contains music behavior and theory.
- `frontend/css/` contains global portfolio styles. Import styles from Astro components so the build bundles them.
- `frontend/public/` contains unchanged public assets, served at `/` (for example, `/assets/apple-touch.png`).

Edit the component that owns a section instead of a monolithic HTML file. Browser behavior belongs in a processed Astro `<script>` or an imported TypeScript module. Use npm imports for browser libraries; Astro resolves and bundles them. Keep server-only code out of browser scripts. Existing interactive modules assume a full page load; client-side routing is intentionally not enabled.

## Validation and deployment

- `npm run typecheck` checks Astro templates, browser code, build tooling, and API tests.
- `npm run build` builds the public site into `dist/frontend` and the standalone homepage into `dist/infra/homepage`.
- `npm test` runs type checks, builds both sites, and checks generated assets and music behavior.
- `npm run test:browser` tests the production build (run `npx playwright install chromium` once).
- `npm run preview` previews the public production build.
- `npm --prefix tests ci && npm --prefix tests test` runs the live API integration suite.

Pushing to `main` builds `dist/frontend` and uploads it to Cloudflare Pages, which serves https://elimelt.com (see `infra/sites/README.md`). The Astro output is static: no server adapter is needed. The standalone homepage is built for manual deployment; it has no configured production deployment target.

### Live features

The services, visitors, chat, notes search, and click-tracking features need the homelab API (`infra/api`, served at api.elimelt.com). It is offline, so the site is built without them: the sections, their nav links, and their scripts are left out of the output, and the page makes no requests to the API. The code is kept. To bring them back, start the API and build with `LIVE_FEATURES=true` (the flag is read in `astro.config.mjs`); run `LIVE_FEATURES=true npm run test:browser` against that build to include the tests that cover them.
