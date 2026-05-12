// Arrondissement sitemap — matches live WP wpcf-code-post-sitemap1.xml
export const prerender = false;

import type { APIRoute } from 'astro';
import { entry, extractSlugs, wrapUrlset, xmlResponse } from '../lib/sitemap';

const arrondSlugs = extractSlugs(import.meta.glob('/src/content/arrondissements/*.json', { eager: false }));

export const GET: APIRoute = async () => {
  const urls: string[] = [];

  for (const slug of arrondSlugs) {
    urls.push(entry(`/arrondissement/${slug}/`));
  }

  return xmlResponse(wrapUrlset(urls));
};
