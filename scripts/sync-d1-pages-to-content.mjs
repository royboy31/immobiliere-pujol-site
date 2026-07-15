#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Build-time sync: D1 site_pages (PUBLISHED snapshot) → src/content/pages/*.md
//
// Reads published_json ONLY (never the live working row), so a rebuild — incl.
// the hourly annonces rebuild — can never publish an in-progress edit. Runs in
// the `npm run build` chain BEFORE `astro build`.
//
// ⚠️ UNLIKE the articles/experts syncs, this script NEVER REMOVES A FILE.
// src/content/pages holds 29 files — home.md, experts.md, the vente/syndic/
// gestion landing pages, the thank-you pages — and only 2 of them are legal
// pages backed by D1. The "remove any .md not backed by a row" rule those other
// syncs use would delete the other 27 and take most of the site down with them.
// This script overwrites the legal slugs and nothing else, and the LEGAL_SLUGS
// allowlist below is checked again here rather than trusted from the query.
//
// The files it writes ARE build artifacts — never commit them
// (`git checkout HEAD -- src/content/pages`).
//
// ABORTS the build (exit 1) on any D1 error, so a broken read can't silently
// ship stale legal text. A 0-row result is NOT fatal here: it just means the
// editor has not been used yet, and the committed files are already correct.
// ─────────────────────────────────────────────────────────────────────────────

import { execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const MODE = process.argv.includes('--local') ? '--local' : '--remote';
const DIR = path.resolve('src/content/pages');
const DB = 'pujol-annonces';

// Must match LEGAL_SLUGS in src/lib/pages-db.ts.
const LEGAL_SLUGS = new Set([
  'politique-de-confidentialite',
  'agence-immobiliere-marseille-gestion-locative-et-syndic/mentions-legales-immobiliere-pujol',
]);

function queryD1(sql) {
  const out = execSync(`npx wrangler d1 execute ${DB} ${MODE} --json --command="${sql.replace(/"/g, '\\"')}"`,
    { encoding: 'utf-8', timeout: 120000, maxBuffer: 256 * 1024 * 1024, env: { ...process.env } });
  const parsed = JSON.parse(out.slice(out.indexOf('[')));
  return parsed?.[0]?.results ?? [];
}

console.log('📡 Fetching published legal pages from D1...');
let rows;
try {
  rows = queryD1('SELECT published_json FROM site_pages WHERE published_json IS NOT NULL');
} catch (e) {
  console.error('❌ D1 read failed — aborting build (won’t ship stale legal pages):', e.message);
  process.exit(1);
}

if (!rows.length) {
  console.log('ℹ️  No published legal pages in D1 — leaving src/content/pages untouched.');
  process.exit(0);
}

mkdirSync(DIR, { recursive: true });

let count = 0, skipped = 0;
for (const row of rows) {
  let p;
  try {
    p = JSON.parse(row.published_json);
  } catch {
    console.error('❌ Unparseable published_json — aborting build.');
    process.exit(1);
  }

  if (!LEGAL_SLUGS.has(p.slug)) {
    // Should be impossible (the admin can't create rows), but a stray row must
    // never be able to overwrite home.md or a landing page.
    console.warn(`⚠️  Skipping non-legal slug from D1: ${p.slug}`);
    skipped++;
    continue;
  }

  const fm = { title: p.title, slug: p.slug };
  if (p.seo_title) fm.seoTitle = p.seo_title;
  if (p.seo_description) fm.seoDescription = p.seo_description;

  // Slug path separator → filename convention used across the collection.
  const file = path.join(DIR, `${p.slug.replace(/\//g, '__')}.md`);
  writeFileSync(file, `---\n${yaml.dump(fm, { lineWidth: -1 })}---\n${p.body_html || ''}\n`);
  count++;
}

console.log(`✅ Wrote ${count} legal page(s) from D1${skipped ? `, skipped ${skipped} non-legal` : ''}. No files removed (by design).`);
