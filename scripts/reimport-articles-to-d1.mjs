#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Clean re-import of blog articles: committed src/content/articles/*.md → D1
// `blog_articles`, preserving EXACT slugs (incl. "local/…" paths, "m²", "__…",
// full length), all fields (author/expertCta/date), and untrimmed bodies.
//
// Fixes the original staging import, which ran slugs through slugify() and
// mangled 619 of them (see the parity dry-run). Writes directly to D1 via
// `wrangler d1 execute --file` (no deploy needed).
//
// ⚠️ MUTATES D1: wipes `blog_articles` then re-inserts. Re-runnable (idempotent).
//
// Usage:
//   CLOUDFLARE_ACCOUNT_ID=68abcbaf4817943a805737802e15679a \
//     node scripts/reimport-articles-to-d1.mjs --remote            # staging
//   node scripts/reimport-articles-to-d1.mjs --remote --dry-run    # write SQL only
// ─────────────────────────────────────────────────────────────────────────────

import { execSync } from 'child_process';
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const MODE = process.argv.includes('--local') ? '--local' : '--remote';
const DRY = process.argv.includes('--dry-run');
const ARTICLES_DIR = path.resolve('src/content/articles');
const DB_NAME = 'pujol-annonces';
const TMP = path.resolve('.reimport-sql');
const BATCH_BYTES = 90 * 1024;  // ~90KB SQL per wrangler --file call
const BATCH_MAX = 50;           // …and at most this many statements per file

// SAME frontmatter/body split the parity harness uses, so bodies round-trip exactly.
function readArticles() {
  const walk = (d) => readdirSync(d).flatMap((n) => {
    const p = path.join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  const rows = [];
  for (const f of walk(ARTICLES_DIR).filter((f) => f.endsWith('.md'))) {
    const raw = readFileSync(f, 'utf-8');
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!m) { console.warn('  ⚠ skipped (no frontmatter):', path.relative(ARTICLES_DIR, f)); continue; }
    const fm = yaml.load(m[1]) || {};
    if (!fm.slug) { console.warn('  ⚠ skipped (no slug):', f); continue; }
    rows.push({ fm, body: m[2] });
  }
  return rows;
}

const q = (v) => "'" + String(v ?? '').replace(/'/g, "''") + "'";
const COLS = '(slug, title, excerpt, body_html, featured_image, categories, tags, author, article_date, seo_title, seo_description, expert_cta, expert_cta_title, status, created_by, published_at)';

function valuesFor({ fm, body }) {
  const date = fm.date || '';
  const publishedAt = date ? `${date}T00:00:00.000Z` : '';
  return '(' + [
    q(fm.slug), q(fm.title || 'Sans titre'), q(fm.excerpt || ''), q(body), q(fm.featuredImage || ''),
    q(JSON.stringify(fm.categories || [])), q(JSON.stringify(fm.tags || [])),
    q(fm.author || ''), q(date), q(fm.seoTitle || ''), q(fm.seoDescription || ''),
    q(fm.expertCta || ''), q(fm.expertCtaTitle || ''), q('published'), q('reimport@local'), q(publishedAt),
  ].join(',') + ')';
}

function runSql(sql, label) {
  mkdirSync(TMP, { recursive: true });
  const file = path.join(TMP, `${label}.sql`);
  writeFileSync(file, sql);
  if (DRY) { console.log(`   [dry-run] wrote ${label}.sql (${(sql.length / 1024).toFixed(0)}KB)`); return; }
  execSync(`npx wrangler d1 execute ${DB_NAME} ${MODE} --yes --file="${file}"`, {
    stdio: ['ignore', 'ignore', 'inherit'], timeout: 120000, env: { ...process.env },
  });
}

// ── main ─────────────────────────────────────────────────────────────────────

console.log(`Clean re-import  •  D1 mode: ${MODE}${DRY ? '  (DRY-RUN)' : ''}`);
if (MODE === '--remote' && !process.env.CLOUDFLARE_ACCOUNT_ID) {
  console.error('❌ CLOUDFLARE_ACCOUNT_ID not set. Staging: export CLOUDFLARE_ACCOUNT_ID=68abcbaf4817943a805737802e15679a');
  process.exit(2);
}

const rows = readArticles();
const slugs = new Set(rows.map((r) => r.fm.slug));
console.log(`\n📄 ${rows.length} committed articles (${slugs.size} unique slugs).`);
if (slugs.size !== rows.length) { console.error('❌ Duplicate slugs among committed files — aborting.'); process.exit(1); }

console.log('\n🧹 Wiping blog_articles…');
runSql('DELETE FROM blog_articles;', '00-delete');

console.log('📥 Inserting (size-batched)…');
let batch = [], bytes = 0, n = 0, inserted = 0;
const flush = () => {
  if (!batch.length) return;
  // One INSERT statement per row (keeps each statement well under SQLite's
  // per-statement length limit), many statements per --file execution.
  const sql = batch.map((v) => `INSERT INTO blog_articles ${COLS} VALUES ${v};`).join('\n') + '\n';
  runSql(sql, `${String(++n).padStart(3, '0')}-insert`);
  inserted += batch.length;
  process.stdout.write(`\r   inserted ${inserted}/${rows.length}`);
  batch = []; bytes = 0;
};
for (const r of rows) {
  const v = valuesFor(r);
  if ((bytes + v.length > BATCH_BYTES || batch.length >= BATCH_MAX) && batch.length) flush();
  batch.push(v); bytes += v.length + 2;
}
flush();
process.stdout.write('\n');

if (!DRY) rmSync(TMP, { recursive: true, force: true });
console.log(`\n✅ Done — ${inserted} articles re-imported. Run the parity harness to verify:`);
console.log('   node scripts/parity-check-d1-content.mjs --remote');
