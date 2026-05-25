#!/usr/bin/env node
// Scrape Google Business Reviews from the WordPress site at build time.
// Writes public/_data/google-reviews.json for the Astro site to read.

import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEST = join(__dirname, '..', 'public', '_data', 'google-reviews.json');
const SOURCE_URL = 'https://www.immobiliere-pujol.fr/';

function decode(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, '\u2019')
    .replace(/&lsquo;/g, '\u2018')
    .replace(/&hellip;/g, '\u2026')
    .replace(/&nbsp;/g, ' ');
}

function strip(s) {
  return decode(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

async function main() {
  console.log('Fetching Google reviews from WordPress site...');

  let html;
  try {
    const res = await fetch(SOURCE_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PujolBuild/1.0)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (e) {
    console.warn(`⚠ Could not fetch ${SOURCE_URL}: ${e.message}`);
    console.log('Skipping Google reviews sync (will use fallback).');
    return;
  }

  // Parse aggregate stats
  const ratingMatch = html.match(/<span class="number">(\d[,.]?\d)<\/span>/);
  const countMatch = html.match(/>([\d\s\u00a0]+)\s*reviews?<\/a>/);
  const rating = ratingMatch ? parseFloat(ratingMatch[1].replace(',', '.')) : null;
  const reviewCount = countMatch
    ? parseInt(countMatch[1].replace(/[\s\u00a0]/g, ''), 10)
    : null;

  if (!rating) {
    console.warn('⚠ Could not parse rating from page — skipping.');
    return;
  }

  // Parse individual reviews
  const block = html.match(/<ul class="listing">([\s\S]*?)<\/ul>/);
  const reviews = [];
  if (block) {
    const items = [...block[1].matchAll(/<li class="rating-(\d+)"[^>]*>([\s\S]*?)<\/li>/g)];
    for (const [, ratingStr, body] of items) {
      const author = strip(body.match(/<span class="author-name">([\s\S]*?)<\/span>/)?.[1] || '');
      if (!author) continue;
      const date = strip(body.match(/<span class="date">([\s\S]*?)<\/span>/)?.[1] || '');
      const snippet = strip(body.match(/<span class="review-snippet">([\s\S]*?)<\/span>/)?.[1] || '');
      const more = strip(body.match(/<span class="review-full-text">([\s\S]*?)<\/span>/)?.[1] || '');
      const text = (snippet + (more ? ' ' + more : '')).trim();
      const profileUrl = body.match(/href="(https:\/\/www\.google\.com\/maps\/contrib\/[^"]+)"/)?.[1];
      reviews.push({
        author,
        rating: Number(ratingStr) || 5,
        date,
        text,
        profileUrl: profileUrl || null,
      });
    }
  }

  const payload = {
    rating,
    reviewCount: reviewCount || 0,
    reviews,
    fetchedAt: new Date().toISOString(),
  };

  const dir = dirname(DEST);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await writeFile(DEST, JSON.stringify(payload, null, 2));

  console.log(`✓ Rating: ${rating}/5, Reviews: ${reviewCount}, Scraped: ${reviews.length} reviews`);
  console.log(`  Written to ${DEST}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
