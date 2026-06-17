#!/usr/bin/env node
// Collapse duplicate-reference rows in D1 to ONE row per (source, reference).
// A reference must never exist twice: the source of truth is LBI / Ubiflow, and
// an update must mutate the single existing row, not insert a new one. Duplicates
// arose from slug drift (a "-france" live-parity slug created a second row under
// ON CONFLICT(slug)). See scripts/dedupe-annonce-refs investigation.
//
// Keep-rule per group: the canonical row = the one sitting at the live/indexed
// slug (a value in live-slug-map), then active over closed, then newest id.
// SAFETY: never auto-deletes a row whose slug IS a live/indexed URL — if two
// rows in a group both hold live slugs, the group is flagged for manual review
// instead, so no indexed URL is ever dropped.
//
// Dry-run by default. Pass --apply to write. --db=<name> to target a database.

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const DB = (process.argv.find((a) => a.startsWith('--db=')) || '--db=pujol-annonces').slice(5);
const MAP = JSON.parse(readFileSync('public/_data/live-slug-map.json', 'utf8'));
const LIVE_SLUGS = new Set(Object.values(MAP));

function d1(sql) {
  const cmd = `npx wrangler d1 execute ${DB} --remote --json --command="${sql.replace(/"/g, '\\"')}"`;
  return JSON.parse(execSync(cmd, { encoding: 'utf8', timeout: 180000, maxBuffer: 128 * 1024 * 1024, env: { ...process.env } }))[0]?.results || [];
}

// Must match resolveSlug() in workers/cron-sync/index.ts
function resolveSlug(slug, cp, map) {
  const tok = (slug || '').split('-')[0];
  if (!tok) return slug;
  const live = map[tok];
  if (!live) return slug;
  cp = (cp || '').toString().trim();
  if (cp && !live.includes(cp)) return slug;
  return live;
}

console.log(`DB: ${DB}  Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);

const rows = d1(`SELECT id, slug, status, source, reference_agence, ubiflow_reference, code_postal FROM annonces`);
console.log(`total rows: ${rows.length}`);

// Group by source + reference (reference_agence for lbi/wordpress, ubiflow_reference for ubiflow).
const groups = new Map();
for (const r of rows) {
  const ref = (r.reference_agence || r.ubiflow_reference || '').trim().toLowerCase();
  if (!ref) continue;
  const key = `${r.source}|${ref}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}

const toDelete = [];
const review = [];
let dupGroups = 0;

for (const [key, grp] of groups) {
  if (grp.length < 2) continue;
  dupGroups++;

  const scored = grp.map((r) => {
    const atLiveSlug = LIVE_SLUGS.has(r.slug);
    const score = (atLiveSlug ? 2 : 0) + (r.status === 'active' ? 1 : 0);
    return { r, atLiveSlug, score };
  });
  scored.sort((a, b) => b.score - a.score || b.r.id - a.r.id);

  const keep = scored[0];
  const del = scored.slice(1);

  // SAFETY: if any row we'd delete holds a live/indexed slug, do not auto-delete
  // this group — flag it for manual review so no indexed URL is lost.
  const dangerous = del.filter((d) => d.atLiveSlug);
  if (dangerous.length) {
    review.push({ key, rows: scored.map((s) => `#${s.r.id} ${s.r.status} ${s.atLiveSlug ? '[LIVE] ' : ''}${s.r.slug}`) });
    continue;
  }

  for (const d of del) toDelete.push({ ...d.r, _keep: keep.r.id });
}

console.log(`duplicate groups: ${dupGroups}`);
console.log(`rows to delete: ${toDelete.length}`);
console.log(`groups needing MANUAL review (multiple live slugs): ${review.length}`);

// Show the known live cases + a sample.
const show = toDelete.filter((d) => /mbvap160009848|1009neot/i.test(d.slug));
if (show.length) {
  console.log('\nknown live-conflict deletions:');
  for (const d of show) console.log(`  DELETE #${d.id} [${d.source}] ${d.status} ${d.slug}  (keep #${d._keep})`);
}
console.log('\nsample deletions:');
for (const d of toDelete.slice(0, 10)) console.log(`  DELETE #${d.id} [${d.source}] ${d.status} ${d.slug}  (keep #${d._keep})`);
if (review.length) {
  console.log('\nMANUAL REVIEW groups:');
  for (const g of review.slice(0, 10)) console.log(`  ${g.key}\n     ${g.rows.join('\n     ')}`);
}

// Assert we never drop the last active of a group while keeping only closed.
for (const d of toDelete) {
  if (d.status === 'active') {
    const keptRow = rows.find((r) => r.id === d._keep);
    if (keptRow && keptRow.status !== 'active') {
      console.error(`✘ ABORT: would delete active #${d.id} while keeping closed #${d._keep}`);
      process.exit(1);
    }
  }
}

if (!APPLY) {
  console.log('\nDRY-RUN only. Re-run with --apply to execute.');
  process.exit(0);
}

console.log('\nAPPLYING...');
let done = 0;
for (let i = 0; i < toDelete.length; i += 25) {
  const chunk = toDelete.slice(i, i + 25);
  const stmts = [];
  for (const d of chunk) {
    stmts.push(`DELETE FROM annonces_photos WHERE annonce_id=${d.id};`);
    stmts.push(`DELETE FROM annonces_seo_links WHERE annonce_id=${d.id};`);
    stmts.push(`DELETE FROM annonces WHERE id=${d.id};`);
  }
  d1(stmts.join(' '));
  done += chunk.length;
  console.log(`  deleted ${done}/${toDelete.length}`);
}
console.log(`Done: deleted ${done} duplicate rows across ${dupGroups - review.length} groups.`);
if (review.length) console.log(`⚠ ${review.length} groups left for manual review.`);
