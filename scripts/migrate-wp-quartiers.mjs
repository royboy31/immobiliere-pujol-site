#!/usr/bin/env node
/**
 * migrate-wp-quartiers.mjs
 *
 * Fetches quartier slugs from the WP sitemap, then builds a JSON data file
 * mapping each slug to a display name (derived from the slug).
 * The quartier pages on WP are thin taxonomy archives — we recreate them
 * as neighborhood landing pages showing matching annonces.
 */

import { writeFileSync, readFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const SITEMAP_URL = 'https://www.immobiliere-pujol.fr/district_name-sitemap1.xml';
const OUTPUT_DIR = join(process.cwd(), 'src/content/quartiers');
const ANNONCES_DIR = join(process.cwd(), 'src/content/annonces');

// Prettify a slug into a display name
function slugToName(slug) {
  return slug
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bSt\b/g, 'Saint')
    .replace(/\bSte\b/g, 'Sainte')
    .replace(/\bAv\b/g, 'Avenue')
    .replace(/\bPt\b/g, 'Pont')
    .replace(/\bProx\b/g, 'Proximité');
}

// Normalize a string for matching (lowercase, no accents, no special chars)
function normalize(s) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function main() {
  // Step 1: Fetch sitemap
  console.log('1. Fetching quartier sitemap...');
  const resp = await fetch(SITEMAP_URL);
  const xml = await resp.text();

  // Extract slugs from <loc> tags
  const slugs = [];
  const locRegex = /<loc>https?:\/\/[^/]+\/quartiers\/([^<]+)\/<\/loc>/g;
  let match;
  while ((match = locRegex.exec(xml)) !== null) {
    slugs.push(match[1]);
  }
  console.log(`   Found ${slugs.length} quartier slugs`);

  // Step 2: Load annonces to build quartier-to-arrondissement mapping
  console.log('2. Analyzing annonces for quartier data...');
  const files = readdirSync(ANNONCES_DIR).filter(f => f.endsWith('.json'));

  // Build quartier name → { count, postalCodes } from annonces
  const quartierStats = new Map();
  for (const f of files) {
    try {
      const data = JSON.parse(readFileSync(join(ANNONCES_DIR, f), 'utf-8'));
      const q = data.quartier || data.taxonomyQuartier;
      const cp = data.codePostal || data.zipcode || '';
      if (q) {
        const normQ = normalize(q);
        if (!quartierStats.has(normQ)) {
          quartierStats.set(normQ, { name: q, count: 0, postalCodes: new Map() });
        }
        const stat = quartierStats.get(normQ);
        stat.count++;
        if (cp) stat.postalCodes.set(cp, (stat.postalCodes.get(cp) || 0) + 1);
      }
    } catch {}
  }

  // Step 3: Create quartier JSON files
  console.log('3. Creating quartier content files...');
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

  let created = 0;
  for (const slug of slugs) {
    const name = slugToName(slug);
    const normSlug = normalize(slug);

    // Try to find matching annonce quartier data
    let matchedStat = quartierStats.get(normSlug);
    if (!matchedStat) {
      // Try partial matching
      for (const [key, stat] of quartierStats) {
        if (key.includes(normSlug) || normSlug.includes(key)) {
          matchedStat = stat;
          break;
        }
      }
    }

    // Determine most common postal code for this quartier
    let postalCode = '';
    if (matchedStat && matchedStat.postalCodes.size > 0) {
      postalCode = [...matchedStat.postalCodes.entries()]
        .sort((a, b) => b[1] - a[1])[0][0];
    }

    const quartierData = {
      slug,
      name: matchedStat ? matchedStat.name : name,
      displayName: name,
      postalCode,
      annonceCount: matchedStat ? matchedStat.count : 0,
      seoTitle: `${name} – Annonces immobilières à Marseille`,
      seoDescription: `Découvrez les biens immobiliers disponibles dans le quartier ${name} à Marseille. Location et vente d'appartements et maisons.`,
    };

    writeFileSync(
      join(OUTPUT_DIR, `${slug}.json`),
      JSON.stringify(quartierData, null, 2) + '\n',
      'utf-8'
    );
    created++;
  }

  console.log(`\n=== RESULTS ===`);
  console.log(`  Sitemap slugs:    ${slugs.length}`);
  console.log(`  Files created:    ${created}`);
  console.log(`  Output dir:       ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
