// Services sitemap — matches live WP services-sitemap1.xml
export const prerender = false;

import type { APIRoute } from 'astro';
import { entry, extractSlugs, wrapUrlset, xmlResponse } from '../lib/sitemap';

const serviceSlugs = extractSlugs(import.meta.glob('/src/content/services/*.md', { eager: false }));

export const GET: APIRoute = async () => {
  const urls: string[] = [];

  // Services listing page
  urls.push(entry('/services/'));

  for (const slug of serviceSlugs) {
    urls.push(entry(`/services/${slug}/`));
  }

  return xmlResponse(wrapUrlset(urls));
};
