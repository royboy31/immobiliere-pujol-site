#!/usr/bin/env node
// Build a `token -> original live-URL slug` map so the importer can reuse the
// original WordPress URL for active listings (URL parity instead of 301-drift).
//
// Source of truth: a snapshot of the live sitemap committed at
// migration/live-annonce-slugs.txt (the authoritative current live URLs — the
// live WordPress site is decommissioned end of June, so this snapshot is
// permanent). Supplemented by the scraped content slugs.
//
// Key = the leading slug token (the listing reference, e.g. "mbvap160009848" or
// "370neot"); value = the original live slug to reuse. Verified: 100/102 active
// listings resolve to exactly one live URL via this key, 0 ambiguous.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SNAPSHOT = join(ROOT, 'migration/live-annonce-slugs.txt');
const CONTENT = join(ROOT, 'src/content/annonces');
const OUT_DIR = join(ROOT, 'public/_data');
const OUT = join(OUT_DIR, 'live-slug-map.json');

const byTok = new Map(); // token -> Set<live slug>
function add(slug) {
  slug = (slug || '').trim();
  if (!slug) return;
  const tok = slug.split('-')[0];
  if (!tok) return;
  if (!byTok.has(tok)) byTok.set(tok, new Set());
  byTok.get(tok).add(slug);
}

// 1. Live sitemap snapshot (authoritative current live URLs)
if (existsSync(SNAPSHOT)) {
  for (const s of readFileSync(SNAPSHOT, 'utf8').trim().split('\n')) add(s);
} else {
  console.warn('⚠ no live-annonce-slugs.txt snapshot — map will be content-only');
}
// 2. Scraped content (supplement — covers anything not in the snapshot)
for (const f of readdirSync(CONTENT)) {
  if (!f.endsWith('.json') || f.includes('_d1sync')) continue;
  add(f.replace(/\.json$/, ''));
}

const map = {};
let multi = 0;
for (const [tok, set] of byTok) {
  const slugs = [...set];
  if (slugs.length > 1) multi++;
  // Canonical = longest (most complete address), ties -> lexicographic. Active
  // listings are all single-candidate, so this only affects rare re-listings.
  slugs.sort((a, b) => b.length - a.length || a.localeCompare(b));
  map[tok] = slugs[0];
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify(map));
console.log(`live-slug-map: ${Object.keys(map).length} tokens (${multi} multi-candidate) -> public/_data/live-slug-map.json`);
