#!/usr/bin/env node
// Build-time: collect every internal page that is a good SEO link target
// (services, service-immobilier landing pages, editorial articles,
// arrondissement pages) into public/_data/link-pool.json.
//
// Read at SSR time by the closed-annonce template (via the ASSETS binding) to
// render a ROTATED internal-link block. Rotation is seeded by the listing slug
// so each closed page links to a different, evenly-distributed slice of the
// pool — this spreads internal link equity across the whole site instead of
// always pushing the same pages (matches the live site's behaviour, but
// deterministic and build-stable so crawlers see a consistent graph).

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DEST_DIR = join(ROOT, 'public/_data');
const DEST = join(DEST_DIR, 'link-pool.json');

// collection dir -> { type label, url(slug) }
const SOURCES = [
  // services route strips a leading "services/" from the slug, so the canonical
  // URL is /services/{slug-without-prefix}/ (avoids /services/services/... 404s).
  { dir: 'services', type: 'service', url: (s) => `/services/${s.replace(/^services\//, '')}/`, skip: (s) => s === 'services' },
  { dir: 'serviceImmobilier', type: 'service', url: (s) => `/service-immobilier/${s}/` },
  { dir: 'articles', type: 'article', url: (s) => `/${s}/` },
];

// Pull `title:` and `slug:` out of a markdown frontmatter block.
function frontmatter(raw) {
  const m = raw.match(/^---\s*([\s\S]*?)\s*---/);
  if (!m) return {};
  const block = m[1];
  const get = (key) => {
    const r = block.match(new RegExp(`^${key}\\s*:\\s*(.*)$`, 'm'));
    if (!r) return '';
    return r[1].trim().replace(/^["']/, '').replace(/["']$/, '').trim();
  };
  return { title: get('title'), slug: get('slug'), featuredImage: get('featuredImage') };
}

async function fromMarkdown(src) {
  const base = join(ROOT, 'src/content', src.dir);
  if (!existsSync(base)) return [];
  const files = await readdir(base);
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.md') && !f.endsWith('.mdx')) continue;
    const fm = frontmatter(await readFile(join(base, f), 'utf-8'));
    if (!fm.title || !fm.slug) continue;
    // Skip WordPress junk: trashed/auto-draft slugs, numeric-only, leading "__".
    if (/trashed|auto-draft/i.test(fm.slug) || fm.slug.startsWith('__') || /^\d+$/.test(fm.slug)) continue;
    if (src.skip && src.skip(fm.slug)) continue;
    // Articles carry a thumbnail (featured image) for the visual link cards.
    const image = src.type === 'article' && fm.featuredImage ? fm.featuredImage : undefined;
    out.push({ url: src.url(fm.slug), title: fm.title, type: src.type, ...(image ? { image } : {}) });
  }
  return out;
}

async function fromArrondissements() {
  const base = join(ROOT, 'src/content/arrondissements');
  if (!existsSync(base)) return [];
  const files = await readdir(base);
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    let d;
    try { d = JSON.parse(await readFile(join(base, f), 'utf-8')); } catch { continue; }
    if (!d.slug || !d.count) continue; // skip empty arrondissements
    out.push({ url: `/arrondissement/${d.slug}/`, title: `Annonces dans le ${d.name}`, type: 'arrondissement' });
  }
  return out;
}

async function main() {
  let pool = [];
  for (const s of SOURCES) pool.push(...await fromMarkdown(s));
  pool.push(...await fromArrondissements());

  // Dedup by URL, drop obviously non-public slugs, sort for a stable order
  // (rotation relies on a deterministic ordering).
  const seen = new Set();
  pool = pool
    .filter((p) => p.url && p.title && !seen.has(p.url) && seen.add(p.url))
    .sort((a, b) => a.url.localeCompare(b.url));

  if (!existsSync(DEST_DIR)) await mkdir(DEST_DIR, { recursive: true });
  await writeFile(DEST, JSON.stringify({ count: pool.length, links: pool }));
  const byType = pool.reduce((m, p) => ((m[p.type] = (m[p.type] || 0) + 1), m), {});
  console.log(`link-pool: ${pool.length} links →`, byType);
}

main().catch((e) => { console.error(e); process.exit(1); });
