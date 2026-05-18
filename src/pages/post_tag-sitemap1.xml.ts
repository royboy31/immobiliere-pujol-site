// Tag sitemap — matches live WP post_tag-sitemap1.xml
export const prerender = false;

import type { APIRoute } from 'astro';
import { entry, wrapUrlset, xmlResponse } from '../lib/sitemap';

export const GET: APIRoute = async ({ request }) => {
  const urls: string[] = [];

  try {
    const origin = new URL(request.url).origin;
    const resp = await fetch(`${origin}/_data/sitemap-slugs.json`);
    if (resp.ok) {
      const data = (await resp.json()) as { tags: string[] };
      for (const slug of data.tags) {
        urls.push(entry(`/tag/${slug}/`));
      }
    }
  } catch { /* skip */ }

  return xmlResponse(wrapUrlset(urls));
};
