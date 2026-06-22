#!/usr/bin/env node
// Periodic cleanup of "dropped" annonces (LBI mandat-clos or long-unpublished).
//
// A listing becomes status='dropped' when it leaves the LBI feed while active OR
// is flagged "mandat clos" (workers/cron-sync/index.ts). Dropped listings are
// already hidden (detail page 301s to /annonces/, excluded from grids/sitemap),
// but the row + its R2 photos stay in place. This script physically removes the
// ones that have been dropped long enough, to keep D1 + R2 lean.
//
// SAFE TO PURGE: photos are content-addressed and the cron rebuilds a listing
// fully from the feed if it ever returns (same slug, fresh photos). So deleting a
// dropped listing has no permanent downside — at worst a returning bien is
// re-imported. The grace period (default 30 days, via date_fermeture) protects
// the normal unpublish/re-list tactic from churn.
//
// USAGE
//   node scripts/cleanup-dropped-annonces.mjs                 # DRY-RUN (default)
//   node scripts/cleanup-dropped-annonces.mjs --confirm       # actually delete
//   node scripts/cleanup-dropped-annonces.mjs --days=60       # change grace period
//   node scripts/cleanup-dropped-annonces.mjs --db=pujol-annonces --bucket=pujol-photos
//
// TARGET ACCOUNT
//   Default = whatever account wrangler resolves (Roy / staging). To run against
//   PRODUCTION (Pujol account), use the established one-off process: set
//   CLOUDFLARE_ACCOUNT_ID=75ed262d0cb67f3a54ee1cc2d7ffd157 and temporarily point
//   wrangler.jsonc database_id to the prod D1 (3951e7ba-...), run, then revert.
//   Always run a DRY-RUN first and confirm the counts match prod (not staging).

import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';

const args = process.argv.slice(2);
const CONFIRM = args.includes('--confirm');
const DAYS = parseInt((args.find((a) => a.startsWith('--days=')) || '--days=30').slice(7), 10);
const DB = (args.find((a) => a.startsWith('--db=')) || '--db=pujol-annonces').slice(5);
const BUCKET = (args.find((a) => a.startsWith('--bucket=')) || '--bucket=pujol-photos').slice(9);

if (!Number.isInteger(DAYS) || DAYS < 0) {
  console.error(`Invalid --days value. Must be a non-negative integer.`);
  process.exit(1);
}

function d1(sql) {
  const cmd = `npx wrangler d1 execute ${DB} --remote --json --command="${sql.replace(/"/g, '\\"')}"`;
  const out = execSync(cmd, { encoding: 'utf8', timeout: 180000, maxBuffer: 128 * 1024 * 1024, env: { ...process.env } });
  return JSON.parse(out)[0]?.results || [];
}

function d1File(sql) {
  const tmp = `scripts/.cleanup-dropped.tmp.sql`;
  writeFileSync(tmp, sql);
  try {
    execSync(`npx wrangler d1 execute ${DB} --remote --file=${tmp}`, {
      encoding: 'utf8', timeout: 180000, maxBuffer: 128 * 1024 * 1024, env: { ...process.env },
    });
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
}

function r2Delete(key) {
  execSync(`npx wrangler r2 object delete "${BUCKET}/${key}" --remote`, {
    encoding: 'utf8', timeout: 60000, env: { ...process.env },
  });
}

// Normalise a stored photo value to an R2 key, or null if it's an external URL
// (failed-upload fallback) that does not live in our bucket.
function toR2Key(url) {
  if (!url) return null;
  const i = url.indexOf('annonces/');
  if (i === -1) return null;          // external URL with no annonces/ path → skip
  if (url.startsWith('http') && i === url.indexOf('http')) {
    // full URL like https://pub-xxx.r2.dev/annonces/slug/hash.jpg → take key part
    return url.slice(i);
  }
  return url.startsWith('annonces/') ? url : url.slice(i);
}

console.log(`DB: ${DB}   Bucket: ${BUCKET}   Grace: ${DAYS} days   Mode: ${CONFIRM ? 'CONFIRM (will delete)' : 'DRY-RUN'}`);
if (process.env.CLOUDFLARE_ACCOUNT_ID) console.log(`Account: ${process.env.CLOUDFLARE_ACCOUNT_ID}`);
console.log('');

// ── 1. Inventory of dropped rows ──
const dropped = d1(
  `SELECT id, slug, reference_agence, ubiflow_reference, source, date_fermeture FROM annonces WHERE status = 'dropped'`
);
const eligible = d1(
  `SELECT id, slug, reference_agence, ubiflow_reference, date_fermeture FROM annonces
   WHERE status = 'dropped' AND date_fermeture IS NOT NULL
   AND julianday(date_fermeture) <= julianday('now', '-${DAYS} days')
   ORDER BY date_fermeture ASC`
);
const nullDate = dropped.filter((r) => !r.date_fermeture);

console.log(`Dropped total: ${dropped.length}`);
console.log(`  eligible (>${DAYS}d): ${eligible.length}`);
console.log(`  within grace (kept): ${dropped.length - eligible.length - nullDate.length}`);
console.log(`  no date_fermeture (kept, can't age): ${nullDate.length}`);
console.log('');

if (eligible.length === 0) {
  console.log('Nothing to purge.');
  process.exit(0);
}

// ── 2. Photos for eligible rows ──
const ids = eligible.map((r) => r.id);
const photoRows = [];
for (let i = 0; i < ids.length; i += 200) {
  const chunk = ids.slice(i, i + 200).join(',');
  photoRows.push(...d1(`SELECT annonce_id, url FROM annonces_photos WHERE annonce_id IN (${chunk})`));
}
const keysByAnnonce = new Map();
for (const p of photoRows) {
  const key = toR2Key(p.url);
  if (!key) continue;
  if (!keysByAnnonce.has(p.annonce_id)) keysByAnnonce.set(p.annonce_id, []);
  keysByAnnonce.get(p.annonce_id).push(key);
}
const totalR2 = [...keysByAnnonce.values()].reduce((n, a) => n + a.length, 0);

// ── 3. Report ──
console.log('Listings to purge:');
for (const r of eligible) {
  const ref = r.reference_agence || r.ubiflow_reference || '(no ref)';
  const n = (keysByAnnonce.get(r.id) || []).length;
  console.log(`  ${ref.padEnd(16)} ${String(r.date_fermeture).slice(0, 10)}  ${n} photo(s)  ${r.slug}`);
}
console.log('');
console.log(`Would delete: ${eligible.length} D1 rows (+ their photos/seo_links) and ${totalR2} R2 objects.`);

if (!CONFIRM) {
  console.log('\nDRY-RUN — nothing deleted. Re-run with --confirm to apply.');
  process.exit(0);
}

// ── 4. Delete R2 objects ──
console.log('\nDeleting R2 objects...');
let r2ok = 0, r2fail = 0;
for (const [, keys] of keysByAnnonce) {
  for (const key of keys) {
    try { r2Delete(key); r2ok++; }
    catch (e) { r2fail++; console.error(`  ✗ R2 ${key}: ${e.message.split('\n')[0]}`); }
  }
}
console.log(`  R2 deleted: ${r2ok}  failed: ${r2fail}`);

// ── 5. Delete D1 rows (children first, then parent) ──
console.log('Deleting D1 rows...');
const idList = ids.join(',');
d1File(
  `DELETE FROM annonces_photos WHERE annonce_id IN (${idList});\n` +
  `DELETE FROM annonces_seo_links WHERE annonce_id IN (${idList});\n` +
  `DELETE FROM annonces WHERE id IN (${idList});`
);
console.log(`  D1 rows deleted: ${eligible.length} annonces (+ children)`);
console.log('\n✅ Cleanup complete.');
