#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Build-time sync: D1 blog_articles (PUBLISHED snapshot) → src/content/articles/*.md
//
// Reads published_json ONLY (never the live working row), so a rebuild — incl. the
// hourly annonces rebuild — can never publish an in-progress edit. Mirrors
// scripts/sync-d1-to-content.mjs (annonces). Runs in the `npm run build` chain
// BEFORE `astro build`.
//
// D1 is authoritative for blog content: this REWRITES src/content/articles from D1
// and removes any .md not backed by a published row (handles unpublish/delete).
// These files are BUILD ARTIFACTS — never commit them (restore with
// `git checkout HEAD -- src/content/articles`).
//
// ABORTS the build (exit 1) on any D1 error or a 0-row result — never ships stale
// or empty content silently.
// ─────────────────────────────────────────────────────────────────────────────

import { execSync } from 'child_process';
import { writeFileSync, readdirSync, statSync, mkdirSync, rmSync } from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const MODE = process.argv.includes('--local') ? '--local' : '--remote';
const DIR = path.resolve('src/content/articles');
const DB = 'pujol-annonces';

function queryD1(sql) {
  const out = execSync(`npx wrangler d1 execute ${DB} ${MODE} --json --command="${sql.replace(/"/g, '\\"')}"`,
    { encoding: 'utf-8', timeout: 120000, maxBuffer: 256 * 1024 * 1024, env: { ...process.env } });
  const s = out.search(/[[{]/);
  return JSON.parse(s >= 0 ? out.slice(s) : out)[0].results || [];
}
function queryAll(pageSize = 150) {   // batched — body_html would overrun the buffer in one shot
  const rows = [];
  for (let off = 0; ; off += pageSize) {
    const b = queryD1(`SELECT published_json FROM blog_articles WHERE published_json IS NOT NULL ORDER BY id LIMIT ${pageSize} OFFSET ${off}`);
    rows.push(...b);
    if (b.length < pageSize) break;
  }
  return rows;
}

const safeArr = (v) => { if (Array.isArray(v)) return v; if (!v) return []; try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } };
// Slugs can be paths ("local/foo"); committed files flatten "/" to "__".
const fileFor = (slug) => path.join(DIR, slug.replace(/\//g, '__') + '.md');

console.log(`📡 Syncing blog_articles (published_json, ${MODE}) → content…`);
let rows;
try { rows = queryAll(); }
catch (e) { console.error('❌ D1 read failed — aborting build (won’t ship stale content):', e.message); process.exit(1); }
if (!rows.length) { console.error('❌ 0 published articles from D1 — aborting build (refusing to empty the blog).'); process.exit(1); }

const written = new Set();
mkdirSync(DIR, { recursive: true });
let count = 0;
for (const r of rows) {
  let a; try { a = JSON.parse(r.published_json); } catch { continue; }
  if (!a || !a.slug) continue;
  const fm = {
    title: a.title || '',
    slug: a.slug,
    date: a.article_date || '',
    excerpt: a.excerpt || '',
    categories: safeArr(a.categories),
    tags: safeArr(a.tags),
    featuredImage: a.featured_image || '',
    seoTitle: a.seo_title || '',
    seoDescription: a.seo_description || '',
  };
  if (a.author) fm.author = a.author;
  if (a.expert_cta) fm.expertCta = a.expert_cta;
  if (a.expert_cta_title) fm.expertCtaTitle = a.expert_cta_title;
  const relatedArticles = safeArr(a.related_slugs);
  if (relatedArticles.length) fm.relatedArticles = relatedArticles;
  // Extended SEO / Open Graph (emitted by [...slug].astro <head>). Written only
  // when meaningful, to keep frontmatter clean. focusKeyword is editor-only.
  if (a.canonical_url) fm.canonicalUrl = a.canonical_url;
  if (a.focus_keyword) fm.focusKeyword = a.focus_keyword;
  if (a.noindex) fm.noindex = true;
  if (a.nofollow) fm.nofollow = true;
  if (a.og_title) fm.ogTitle = a.og_title;
  if (a.og_description) fm.ogDescription = a.og_description;
  if (a.og_image) fm.ogImage = a.og_image;
  if (a.twitter_card) fm.twitterCard = a.twitter_card;
  const file = fileFor(a.slug);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `---\n${yaml.dump(fm, { lineWidth: -1 })}---\n${a.body_html || ''}\n`);
  written.add(path.resolve(file));
  count++;
}

// Remove stale .md (unpublished / deleted) — D1 is authoritative for blog content.
const walk = (d) => readdirSync(d).flatMap((n) => { const p = path.join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
let removed = 0;
for (const f of walk(DIR).filter((f) => f.endsWith('.md'))) {
  if (!written.has(path.resolve(f))) { rmSync(f); removed++; }
}

console.log(`✅ Wrote ${count} articles from D1, removed ${removed} stale.`);
