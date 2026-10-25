import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getPosts } from '../posts';

export async function GET(context: APIContext) {
  const posts = await getPosts();
  return rss({
    title: "Elijah Melton's blog",
    description: 'Writing on distributed systems, infrastructure, and whatever else.',
    site: context.site!,
    trailingSlash: true,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.date,
      link: `/posts/${post.id}/`,
    })),
  });
}
