#!/usr/bin/env node
// Build-time: pool of CLOSED annonces (url + short title) for the rotated
// "Annonces clôturées" link block on closed-listing pages.
// Output: public/_data/closed-annonces-pool.json

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIR = join(ROOT, 'src/content/annonces');
const DEST_DIR = join(ROOT, 'public/_data');
const DEST = join(DEST_DIR, 'closed-annonces-pool.json');

const clean = (s) => (s || '').replace(/\s*,\s*France\s*$/i, '').replace(/\s+/g, ' ').trim();

function title(d) {
  if (d.seoTitle && d.seoTitle.trim()) return d.seoTitle.trim().slice(0, 70);
  const adr = clean(d.adresse);
  if (adr) return adr.slice(0, 70);
  return d.referenceAgence || d.slug;
}

async function main() {
  const files = await readdir(DIR);
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    let d;
    try { d = JSON.parse(await readFile(join(DIR, f), 'utf-8')); } catch { continue; }
    if (d.status !== 'closed' || !d.slug) continue;
    if (/^lj[vl]ga/i.test(d.slug)) continue; // skip garages (Caroline)
    const image = Array.isArray(d.photos) && d.photos[0] ? d.photos[0] : '';
    out.push({ url: `/annonces/${d.slug}/`, title: title(d), type: 'closed', date: (d.date || '').slice(0, 10), image });
  }
  // Stable order (rotation relies on it); newest first so the recent-weighted
  // "Autres annonces" slice can read from the head.
  out.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.url.localeCompare(b.url));

  // Cap to the 2000 most recent closed listings — keeps the asset light and
  // concentrates link equity on the SEO-relevant recent stock.
  const capped = out.slice(0, 2000);

  if (!existsSync(DEST_DIR)) await mkdir(DEST_DIR, { recursive: true });
  await writeFile(DEST, JSON.stringify({ count: capped.length, links: capped }));
  console.log(`closed-annonces-pool: ${capped.length} of ${out.length} closed annonces (capped)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
