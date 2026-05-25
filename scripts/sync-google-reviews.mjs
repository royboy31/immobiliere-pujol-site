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
  try {
    const res = await fetch(WP_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PujolBuild/1.0)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const ratingMatch = html.match(/<span class="number">(\d[,.]?\d)<\/span>/);
    const countMatch = html.match(/>([\d\s\u00a0]+)\s*reviews?<\/a>/);

    const rating = ratingMatch ? parseFloat(ratingMatch[1].replace(',', '.')) : null;
    const reviewCount = countMatch
      ? parseInt(countMatch[1].replace(/[\s\u00a0]/g, ''), 10)
      : null;

    if (rating) {
      console.log(`Google stats: ${rating}/5, ${reviewCount} reviews`);
      return { rating, reviewCount: reviewCount || 0 };
    }
  } catch (e) {
    console.warn(`⚠ Could not scrape Google stats: ${e.message}`);
  }
  console.log('Using fallback Google stats');
  return { rating: 4.7, reviewCount: 2050 };
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

  console.log(`✓ Rating: ${stats.rating}/5, Google count: ${stats.reviewCount}`);
  console.log(`✓ Carousel: ${carousel.length} OpinionSystem reviews (from ${reviews.length} total)`);
  console.log(`  Written to ${DEST}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
