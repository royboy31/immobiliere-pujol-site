#!/usr/bin/env node
// Build-time: copy closed annonce JSON files from the content collection
// to public/_data/annonces/ so they can be fetched at SSR time via the
// Cloudflare ASSETS binding. Keeps the Worker bundle small (the data
// lives in the static asset layer, not in the JS bundle).

import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src/content/annonces');
const DEST = join(ROOT, 'public/_data/annonces');

async function main() {
  if (existsSync(DEST)) await rm(DEST, { recursive: true, force: true });
  await mkdir(DEST, { recursive: true });

  const files = await readdir(SRC);
  let copied = 0;
  let skipped = 0;
  let related = {}; // arrondissement code -> [slug, ...]

  // Slug pattern: {ref}-{street}-{cp}-{ville}-france (mostly). Parse cp/ville from it
  // because the source JSON often doesn't have codePostal/ville populated.
  const SLUG_LOC_RE = /-(\d{5})-([a-z0-9-]+)-france$/;
  function parseSlugLoc(slug) {
    const m = slug.match(SLUG_LOC_RE);
    if (!m) return { cp: '', ville: '' };
    return {
      cp: m[1],
      ville: m[2].replace(/-/g, ' ').replace(/(^|\s)\S/g, s => s.toUpperCase()),
    };
  }

  // Pass 1: read everything, collect slugs per arrondissement for SEO link block
  const closedEntries = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const raw = await readFile(join(SRC, f), 'utf-8');
    let data;
    try { data = JSON.parse(raw); } catch { skipped++; continue; }
    if (data.status !== 'closed') { skipped++; continue; }
    const slug = data.slug || f.replace(/\.json$/, '');
    const parsed = parseSlugLoc(slug);
    const cp = (data.codePostal || parsed.cp || '').toString();
    const ville = data.ville || parsed.ville || '';
    data.codePostal = cp;
    data.ville = ville;
    const arr = cp.startsWith('130') ? cp : (cp || 'other');
    related[arr] ??= [];
    related[arr].push({
      slug,
      title: data.descriptif ? (data.descriptif.slice(0, 60).trim() + '…') : slug,
      prix: data.prix,
      type: data.typeAnnonce,
      cp,
    });
    closedEntries.push({ slug, data, arr });
  }

  // Pass 2: write per-annonce JSON with pre-computed related links
  for (const { slug, data, arr } of closedEntries) {
    // Pick up to 24 related slugs in same arrondissement (excluding self)
    const pool = (related[arr] || []).filter(r => r.slug !== slug);
    // simple deterministic shuffle by slug hash
    const hash = [...slug].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0);
    const start = Math.abs(hash) % Math.max(1, pool.length);
    const picked = [];
    for (let i = 0; i < 24 && i < pool.length; i++) {
      picked.push(pool[(start + i) % pool.length]);
    }
    const out = { ...data, related: picked };
    await writeFile(join(DEST, slug + '.json'), JSON.stringify(out));
    copied++;
  }

  console.log(`copy-closed-annonces: copied ${copied}, skipped ${skipped}`);
}

main().catch(e => { console.error(e); process.exit(1); });
