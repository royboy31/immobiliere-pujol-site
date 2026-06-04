// Local SEO sitemap — matches live WP local-sitemap1.xml
// Contains /local/ index page + all articles with local/ prefix slugs.
export const prerender = false;

import type { APIRoute } from 'astro';
import { entry, wrapUrlset, xmlResponse } from '../lib/sitemap';

interface ArticleMeta {
  slug: string;
  date?: string;
}

export const GET: APIRoute = async ({ request }) => {
  const urls: string[] = [];

  // /local/ index page (matches WP's first entry)
  urls.push(entry('/local/'));

  try {
    const origin = new URL(request.url).origin;
    const resp = await fetch(`${origin}/_data/sitemap-slugs.json`);
    if (resp.ok) {
      const data = (await resp.json()) as { articles: ArticleMeta[] };
      for (const a of data.articles) {
        if (a.slug.startsWith('local/')) {
          urls.push(entry(`/${a.slug}/`, a.date));
        }
      }
    }
  } catch { /* skip */ }

  return xmlResponse(wrapUrlset(urls));
};
