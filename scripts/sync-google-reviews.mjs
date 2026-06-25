#!/usr/bin/env node
/**
 * Build-time: scrape Google rating + count from WP site,
 * then pull 50 most recent OpinionSystem reviews (mixed across all experts)
 * for the homepage carousel. Writes public/_data/google-reviews.json.
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REVIEWS_DIR = join(__dirname, '..', 'public', '_data', 'reviews');
const DEST = join(__dirname, '..', 'public', '_data', 'google-reviews.json');
const WP_URL = 'https://www.immobiliere-pujol.fr/';
const CAROUSEL_SIZE = 50;

// ── 1. Scrape Google rating + count from WordPress widget ──

async function scrapeGoogleStats() {
  const PLACE_ID = process.env.GOOGLE_PLACE_ID || 'ChIJZ1YLArLAyRIR3TVujRYJK7Y';
  const KEY = process.env.GOOGLE_PLACES_KEY || '';
  if (KEY) {
    try {
      const res = await fetch(`https://places.googleapis.com/v1/places/${PLACE_ID}`, {
        // The API key is HTTP-referrer-restricted to www.immobiliere-pujol.fr,
        // so the server-side build presents that referer (WP_URL).
        headers: {
          'X-Goog-Api-Key': KEY,
          'X-Goog-FieldMask': 'rating,userRatingCount',
          'Referer': WP_URL,
        },
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();
      if (res.ok && typeof data.rating === 'number') {
        console.log(`Google stats (Places API): ${data.rating}/5, ${data.userRatingCount} reviews`);
        return { rating: data.rating, reviewCount: data.userRatingCount ?? 0 };
      }
      console.warn(`⚠ Places API: ${data?.error?.message || ('HTTP ' + res.status)}`);
    } catch (e) {
      console.warn(`⚠ Places API fetch failed: ${e.message}`);
    }
  } else {
    console.warn('⚠ GOOGLE_PLACES_KEY not set — keeping last known Google stats');
  }
  // Fallback: reuse the last good value so a transient failure never resets the count.
  try {
    const prev = JSON.parse(await readFile(join(__dirname, '..', 'src', 'data', 'google-stats.json'), 'utf-8'));
    if (prev && prev.rating) {
      console.log(`Using last known Google stats: ${prev.rating}/5, ${prev.reviewCount}`);
      return { rating: prev.rating, reviewCount: prev.reviewCount };
    }
  } catch {}
  return { rating: 4.7, reviewCount: 2114 };
}

// ── 2. Load OpinionSystem reviews from all experts ──

async function loadOpinionSystemReviews() {
  if (!existsSync(REVIEWS_DIR)) {
    console.warn('⚠ No reviews directory found — skipping OpinionSystem reviews');
    return [];
  }

  const files = await readdir(REVIEWS_DIR);
  const allReviews = [];

  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const data = JSON.parse(await readFile(join(REVIEWS_DIR, f), 'utf-8'));
      const expertName = f.replace('.json', '').split('-').map(
        w => w.charAt(0).toUpperCase() + w.slice(1)
      ).join(' ');

      for (const s of (data.surveys || [])) {
        if (!s.comment) continue;
        allReviews.push({
          author: s.clientName || 'Client',
          rating: 5, // OpinionSystem uses /10, we display as 5-star
          date: s.date || '',
          text: s.comment,
          property: s.property || '',
          expert: expertName,
        });
      }
    } catch {}
  }

  // Sort by date (newest first)
  allReviews.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return allReviews;
}

// ── Main ──

async function main() {
  console.log('Syncing Google reviews data...');

  const [stats, reviews] = await Promise.all([
    scrapeGoogleStats(),
    loadOpinionSystemReviews(),
  ]);

  const carousel = reviews.slice(0, CAROUSEL_SIZE);

  const payload = {
    rating: stats.rating,
    reviewCount: stats.reviewCount,
    reviews: carousel,
    fetchedAt: new Date().toISOString(),
  };

  const dir = dirname(DEST);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await writeFile(DEST, JSON.stringify(payload, null, 2));

  // Also write the stats to src/data/ so Header.astro can import it statically
  const STATS_DEST = join(__dirname, '..', 'src', 'data', 'google-stats.json');
  await writeFile(STATS_DEST, JSON.stringify({ rating: stats.rating, reviewCount: stats.reviewCount }));

  console.log(`✓ Rating: ${stats.rating}/5, Google count: ${stats.reviewCount}`);
  console.log(`✓ Carousel: ${carousel.length} OpinionSystem reviews (from ${reviews.length} total)`);
  console.log(`  Written to ${DEST}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
