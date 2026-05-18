// RSS 2.0 feed — matches WP /feed/ endpoint
export const prerender = false;

import type { APIRoute } from 'astro';

const SITE = 'https://www.immobiliere-pujol.fr';

interface ArticleMeta {
  slug: string;
  date?: string;
  title?: string;
  image?: string;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const GET: APIRoute = async ({ request }) => {
  let articles: ArticleMeta[] = [];

  try {
    const origin = new URL(request.url).origin;
    const resp = await fetch(`${origin}/_data/sitemap-slugs.json`);
    if (resp.ok) {
      const data = await resp.json();
      articles = data.articles || [];
    }
  } catch { /* skip */ }

  // Sort by date descending, take 50 most recent
  articles.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const items = articles.slice(0, 50);

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Immobilière Pujol</title>
  <link>${SITE}</link>
  <description>Blog immobilier Marseille – Immobilière Pujol</description>
  <language>fr</language>
  <atom:link href="${SITE}/feed/" rel="self" type="application/rss+xml"/>
  ${items.map(a => `<item>
    <title>${esc(a.title || a.slug)}</title>
    <link>${SITE}/${a.slug}/</link>
    <guid>${SITE}/${a.slug}/</guid>${a.date ? `
    <pubDate>${new Date(a.date).toUTCString()}</pubDate>` : ''}
  </item>`).join('\n  ')}
</channel>
</rss>`;

  return new Response(rss, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
