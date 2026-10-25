# Blog

blog.elimelt.com: an [Astro](https://astro.build) site with
[MDX](https://docs.astro.build/en/guides/integrations-guide/mdx/), built to
static files and served by Cloudflare Pages. It builds and deploys on its own
(`.github/workflows/blog-deploy.yml`).

```bash
cd blog
npm ci
npm run dev      # http://localhost:3001, drafts included
npm run build    # type checks, then builds dist/
```

## Writing a post

Add `src/content/posts/<slug>.md` or `.mdx`; the file name becomes
`/posts/<slug>/`. Frontmatter is checked against `src/content.config.ts`:

```yaml
---
title: Post title
description: One sentence for the index, feed and link previews.
date: 2026-10-25
updated: 2026-11-02   # optional
draft: true           # optional; shown in dev, left out of the build
---
```

## Interactive elements

Use `.mdx` and import components:

```mdx
import Figure from '../../components/Figure.astro';
import RandomWalk from '../../components/RandomWalk.astro';

<Figure caption="What the reader is looking at." wide>
  <RandomWalk walkers={300} />
</Figure>
```

`src/components/RandomWalk.astro` shows the pattern: markup plus a `<script>`
that defines a custom element. Astro bundles the script and loads it only on
pages that use the component, so posts without interactivity ship no
JavaScript. Anything that runs in a browser works the same way (canvas, WebGL,
npm libraries). To use a UI framework, add its integration (for example
`npx astro add react`) and render the component with a `client:*` directive such
as `client:visible`.

`Figure` frames a component and adds a caption; `wide` lets it extend past the
text column.

Styles are in `src/styles/global.css`; layouts are in `src/layouts/`.
