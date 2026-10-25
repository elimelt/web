import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const posts = defineCollection({
  // Each post is src/content/posts/<slug>.md or .mdx; the file name is the URL.
  loader: glob({ base: './src/content/posts', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    // Drafts render in `npm run dev` but are left out of the build.
    draft: z.boolean().default(false),
  }),
});

export const collections = { posts };
