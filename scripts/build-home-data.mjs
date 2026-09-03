#!/usr/bin/env node
// Build-time: emit src/data/home.json (annonces cards + latest articles) so the
// home page imports static JSON instead of calling getCollection() from
// astro:content. That import was pulling the ENTIRE content data layer (~24 MB:
// 5,000+ annonces + 1,000+ article bodies) into the SSR worker bundle and blew
// the Cloudflare Worker size limit. Reading prebuilt JSON keeps astro:content
// out of the worker graph entirely.
//
// Runs after sync-d1-to-content.mjs (which writes public/_data/cards.json).

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CARDS = join(ROOT, 'public/_data/cards.json');
const ARTICLES_DIR = join(ROOT, 'src/content/articles');
const DEST = join(ROOT, 'src/data/home.json');

// ── 1. Annonces (active cards) — exclude garages/parkings/terrains ──
let annonces = [];
try {
  const cards = JSON.parse(await readFile(CARDS, 'utf-8'));
  // A STANDALONE garage/parking/lot — NOT an apartment that merely HAS a garage
  // (c.garage/c.parking are amenity flags, so we must not use them here).
  const isGarageOrLot = (c) => {
    const lt = (c.libelleType || '').toLowerCase();
    const slug = (c.slug || '').toLowerCase();
    const t = (c.titre || '').toLowerCase();
    if (/parking|\bbox\b|garage|terrain|stationnement|emplacement|cave/.test(lt)) return true;
    if (/^[a-z]{2}[vl](ga|te)\d/.test(slug)) return true; // LBI code: ga=garage, te=terrain
    if (/^(garages?|box|parkings?|stationnements?|terrains?|emplacements?|caves?)\b/.test(t)) return true;
    return false;
  };
  annonces = cards
    .filter((c) => Array.isArray(c.photos) && c.photos.length > 0 && !isGarageOrLot(c))
    // Shape mirrors the fields index.astro's buildCard() reads (data.*).
    .map((c) => ({
      typeAnnonce: c.type,
      slug: c.slug,
      photos: c.photos,
      title: c.titre,
      prix: c.prix,
      loyerCC: c.loyerCC,
      surface: c.surface,
      nbPieces: c.nbPieces,
      quartier: c.quartier,
      codePostal: c.codePostal,
      ville: c.ville,
    }));
} catch (e) {
  console.warn(`⚠ home-data: cards.json unavailable (${e.message}) — annonces empty`);
}

// ── 2. Latest 12 articles (with a featured image) from frontmatter ──
// Real YAML parse — sync-d1-articles-to-content.mjs emits yaml.dump output
// (single-quoted titles, block-scalar excerpts) that a line regex misreads.
const arts = [];
for (const f of (await readdir(ARTICLES_DIR)).filter((f) => f.endsWith('.md'))) {
  const txt = await readFile(join(ARTICLES_DIR, f), 'utf-8');
  let head;
  try {
    head = yaml.load(txt.split('---')[1] || '') || {};
  } catch (e) {
    console.warn(`⚠ home-data: bad frontmatter in ${f} (${e.message}) — skipped`);
    continue;
  }
  const str = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').trim());
  const featuredImage = str(head.featuredImage);
  const date = str(head.date);
  if (!featuredImage || !date) continue;
  arts.push({
    slug: str(head.slug) || f.replace(/\.md$/, ''),
    title: str(head.title),
    date,
    excerpt: str(head.excerpt),
    featuredImage,
  });
}
arts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
const articles = arts.slice(0, 12);

if (!existsSync(dirname(DEST))) await mkdir(dirname(DEST), { recursive: true });
await writeFile(DEST, JSON.stringify({ annonces, articles }));
console.log(`home.json: ${annonces.length} annonces, ${articles.length} articles`);
