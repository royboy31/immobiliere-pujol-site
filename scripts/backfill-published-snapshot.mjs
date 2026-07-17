#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Step 2 backfill — add published_json/published_at columns and freeze the
// CURRENT content as the published baseline, so the build-time sync (step 3) has
// a snapshot to read and switching the site to build-from-D1 shows today's live
// content (not an empty site).
//
// The json_object() snapshot expressions MUST match src/lib/blog-db.ts
// (ARTICLE_SNAPSHOT_JSON) and src/lib/experts-db.ts (EXPERT_SNAPSHOT_JSON).
//
// ⚠️ MUTATES D1 (additive ALTER + UPDATE). Idempotent / re-runnable.
//
// Usage:
//   CLOUDFLARE_ACCOUNT_ID=68abcbaf4817943a805737802e15679a \
//     node scripts/backfill-published-snapshot.mjs --remote
// ─────────────────────────────────────────────────────────────────────────────

import { execSync } from 'child_process';

const MODE = process.argv.includes('--local') ? '--local' : '--remote';
const DB = 'pujol-annonces';

const ARTICLE_SNAPSHOT = `json_object(
  'slug', slug, 'title', title, 'excerpt', excerpt, 'body_html', body_html,
  'featured_image', featured_image, 'categories', categories, 'tags', tags,
  'author', author, 'article_date', article_date, 'seo_title', seo_title,
  'seo_description', seo_description, 'canonical_url', canonical_url,
  'focus_keyword', focus_keyword, 'noindex', noindex, 'nofollow', nofollow,
  'og_title', og_title, 'og_description', og_description, 'og_image', og_image,
  'twitter_card', twitter_card, 'expert_cta', expert_cta,
  'expert_cta_title', expert_cta_title)`;

const EXPERT_SNAPSHOT = `json_object(
  'slug', slug, 'title', title, 'fonction', fonction, 'description', description,
  'photo', photo, 'phone', phone, 'email', email, 'email_aliases', email_aliases,
  'linkedin', linkedin, 'facebook', facebook, 'instagram', instagram,
  'seo_title', seo_title, 'seo_description', seo_description, 'department', department,
  'sort_order', sort_order, 'agenda', agenda, 'secteur', secteur,
  'hidden', hidden, 'listing_only', listing_only)`;

function exec(sql, { ignoreDup = false } = {}) {
  try {
    const out = execSync(
      `npx wrangler d1 execute ${DB} ${MODE} --yes --json --command="${sql.replace(/\s+/g, ' ').replace(/"/g, '\\"')}"`,
      { encoding: 'utf-8', timeout: 120000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env } },
    );
    const s = out.search(/[[{]/);
    return s >= 0 ? JSON.parse(out.slice(s)) : null;
  } catch (e) {
    const msg = (e.stderr || e.stdout || e.message || '').toString();
    if (ignoreDup && /duplicate column name/i.test(msg)) { console.log('   (column already exists — skipped)'); return null; }
    throw e;
  }
}

if (MODE === '--remote' && !process.env.CLOUDFLARE_ACCOUNT_ID) {
  console.error('❌ CLOUDFLARE_ACCOUNT_ID not set. Staging: export CLOUDFLARE_ACCOUNT_ID=68abcbaf4817943a805737802e15679a');
  process.exit(2);
}

console.log(`Backfill published snapshot  •  D1 mode: ${MODE}`);

console.log('\n① Adding columns (additive, idempotent)…');
exec('ALTER TABLE blog_articles ADD COLUMN published_json TEXT', { ignoreDup: true });
exec('ALTER TABLE experts ADD COLUMN published_at TEXT', { ignoreDup: true });
exec('ALTER TABLE experts ADD COLUMN published_json TEXT', { ignoreDup: true });

console.log('② Freezing current content as the published baseline…');
exec(`UPDATE blog_articles SET published_json = ${ARTICLE_SNAPSHOT}, published_at = datetime('now') WHERE status = 'published'`);
exec(`UPDATE blog_articles SET published_json = NULL WHERE status = 'draft'`);
exec(`UPDATE experts SET published_json = ${EXPERT_SNAPSHOT}, published_at = datetime('now')`);

console.log('③ Verifying…');
const a = exec(`SELECT
    (SELECT COUNT(*) FROM blog_articles) AS total,
    (SELECT COUNT(*) FROM blog_articles WHERE status='published') AS published,
    (SELECT COUNT(*) FROM blog_articles WHERE published_json IS NOT NULL) AS with_snapshot,
    (SELECT COUNT(*) FROM blog_articles WHERE status='published' AND (published_json IS NULL OR datetime(updated_at) > datetime(published_at))) AS pending`)[0].results[0];
const e = exec(`SELECT
    (SELECT COUNT(*) FROM experts) AS total,
    (SELECT COUNT(*) FROM experts WHERE published_json IS NOT NULL) AS with_snapshot,
    (SELECT COUNT(*) FROM experts WHERE published_json IS NULL OR datetime(updated_at) > datetime(published_at)) AS pending`)[0].results[0];

console.log(`\n   blog_articles : ${a.total} total, ${a.published} published, ${a.with_snapshot} with snapshot, ${a.pending} pending`);
console.log(`   experts       : ${e.total} total, ${e.with_snapshot} with snapshot, ${e.pending} pending`);
console.log(`\n${a.pending === 0 && e.pending === 0 ? '✅' : '⚠️'} Backfill done. published_json now reflects the live baseline.`);
