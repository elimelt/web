# Personal Site

The site, music app, homelab homepage, and integration tests are written in TypeScript.

```bash
npm ci
npm run dev
```

Open http://localhost:3000. Rebuild after changing source files.

- `npm run typecheck` checks browser code, build tooling, and API tests.
- `npm run build` compiles the site into `dist/frontend` and the standalone homepage into `dist/infra/homepage`, copying their static assets.
- `npm test` runs type checks, builds both sites, and checks asset paths and music behavior.
- `npm run test:browser` smoke-tests the generated pages (run `npx playwright install chromium` once).
- `npm --prefix tests ci && npm --prefix tests test` runs the live API integration suite.

Browser imports and HTML script URLs retain `.js` extensions; TypeScript resolves those imports to `.ts` sources and emits the expected JavaScript files. Serve the build output, not the source directories.

Pushing to `main` builds and deploys `dist/frontend` to GitHub Pages at https://elimelt.com. The standalone homepage is built for manual deployment; it has no configured production deployment target.
