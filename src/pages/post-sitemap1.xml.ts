// Post (article) sitemap — matches live WP post-sitemap1.xml
// Reads article metadata from pre-built sitemap-slugs.json (lightweight, no bundling).
export const prerender = false;

import type { APIRoute } from 'astro';
import { entryWithImage, wrapUrlset, xmlResponse } from '../lib/sitemap';

interface ArticleMeta {
  slug: string;
  date?: string;
  title?: string;
  image?: string;
}

export const GET: APIRoute = async ({ request }) => {
  const urls: string[] = [];

  // Blog listing page (matches live)
  urls.push(entryWithImage('/blog-immobilier-marseille/'));

  try {
    const origin = new URL(request.url).origin;
    const resp = await fetch(`${origin}/_data/sitemap-slugs.json`);
    if (resp.ok) {
      const data = (await resp.json()) as { articles: ArticleMeta[] };
      for (const a of data.articles) {
        urls.push(entryWithImage(`/${a.slug}/`, a.date, a.image, a.title));
      }
    }
  } catch { /* skip */ }

  return xmlResponse(wrapUrlset(urls, true));
};
