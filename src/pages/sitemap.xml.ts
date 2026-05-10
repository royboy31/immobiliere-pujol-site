// Dynamic sitemap — generates XML at request time.
// Active annonces are fetched from R2 (always up-to-date).
// Static content slugs are resolved at build time via getCollection.
export const prerender = false;

import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

const SITE = 'https://www.immobiliere-pujol.fr';
const R2_ACTIVE = 'https://pub-a37eed540afe4dc9b4479da74ba265e1.r2.dev/annonces/active.json';

// ── Resolve static content slugs at build time (module-level) ──
// NOTE: annonces collection is excluded — too large (5k+ files, 36MB).
// Active annonces are fetched live from R2 instead.
const articleSlugs = (await getCollection('articles')).map(e => e.id);
const pageSlugs = (await getCollection('pages')).map(e => e.id);
const serviceSlugs = (await getCollection('services')).map(e => e.id);
const serviceImmoSlugs = (await getCollection('serviceImmobilier')).map(e => e.id);
const arrondSlugs = (await getCollection('arrondissements')).map(e => e.id);
const expertSlugs = (await getCollection('experts')).map(e => e.id);

function entry(path: string, lastmod?: string, priority?: number, changefreq?: string): string {
  let xml = `  <url>\n    <loc>${SITE}${path}</loc>`;
  if (lastmod) xml += `\n    <lastmod>${lastmod}</lastmod>`;
  if (changefreq) xml += `\n    <changefreq>${changefreq}</changefreq>`;
  if (priority !== undefined) xml += `\n    <priority>${priority}</priority>`;
  xml += `\n  </url>`;
  return xml;
}

export const GET: APIRoute = async () => {
  const today = new Date().toISOString().split('T')[0];
  const urls: string[] = [];

  // ── Core pages ──
  urls.push(entry('/', today, 1.0, 'daily'));
  urls.push(entry('/annonces/', today, 0.9, 'daily'));
  urls.push(entry('/annonces/locations/', today, 0.9, 'daily'));
  urls.push(entry('/annonces/ventes/', today, 0.9, 'daily'));
  urls.push(entry('/contact-immobiliere-pujol/', undefined, 0.5));
  urls.push(entry('/estimez-le-prix-de-vente-de-votre-bien-en-2mn/', undefined, 0.7));
  urls.push(entry('/local/', undefined, 0.5));
  urls.push(entry('/services/', undefined, 0.6));
  urls.push(entry('/experts/', undefined, 0.6));
  urls.push(entry('/service-immobilier/agence-immobiliere-pujol/', undefined, 0.6));
  urls.push(entry('/service-immobilier/gestion-locative/', undefined, 0.6));
  urls.push(entry('/service-immobilier/mettre-en-location/', undefined, 0.6));
  urls.push(entry('/service-immobilier/syndic-de-copropriete-a-marseille/', undefined, 0.6));

  // ── Active annonces (dynamic — fetched from R2 at request time) ──
  try {
    const resp = await fetch(R2_ACTIVE);
    if (resp.ok) {
      const annonces = await resp.json() as Array<{ slug: string }>;
      for (const a of annonces) {
        urls.push(entry(`/annonces/${a.slug}/`, today, 0.8, 'daily'));
      }
    }
  } catch { /* skip */ }

  // ── Articles ──
  for (const slug of articleSlugs) {
    urls.push(entry(`/${slug}/`, undefined, 0.6, 'monthly'));
  }

  // ── Pages ──
  for (const slug of pageSlugs) {
    urls.push(entry(`/${slug}/`, undefined, 0.5));
  }

  // ── Services ──
  for (const slug of serviceSlugs) {
    urls.push(entry(`/services/${slug}/`, undefined, 0.5, 'monthly'));
  }

  // ── Service Immobilier (dynamic collection entries) ──
  for (const slug of serviceImmoSlugs) {
    urls.push(entry(`/service-immobilier/${slug}/`, undefined, 0.5, 'monthly'));
  }

  // ── Arrondissements ──
  for (const slug of arrondSlugs) {
    urls.push(entry(`/arrondissement/${slug}/`, undefined, 0.5, 'monthly'));
  }

  // ── Experts ──
  for (const slug of expertSlugs) {
    urls.push(entry(`/experts/${slug}/`, undefined, 0.4));
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
