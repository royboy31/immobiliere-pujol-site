#!/usr/bin/env node
// ONE-TIME migration: re-point existing drifted ACTIVE annonce rows in D1 onto
// their original live-URL slug (URL parity). Idempotent. Dry-run by default;
// pass --apply to write. Requires CLOUDFLARE_ACCOUNT_ID + wrangler auth.
//
// For each active (lbi/ubiflow) row whose slug differs from its resolved live
// slug L: delete any other row already at slug L (the WordPress closed-scrape
// duplicate) + its photos, then rename the active row to L. The active row keeps
// its data; the next worker sync re-keys its R2 photos under L.

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const MAP = JSON.parse(readFileSync('public/_data/live-slug-map.json', 'utf8'));

function d1(sql) {
  const cmd = `npx wrangler d1 execute pujol-annonces --remote --json --command="${sql.replace(/"/g, '\\"')}"`;
  return JSON.parse(execSync(cmd, { encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env } }))[0]?.results || [];
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

console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
const active = d1(`SELECT id, slug, code_postal, source FROM annonces WHERE status='active' AND source IN ('lbi','ubiflow')`);
console.log(`active lbi/ubiflow rows: ${active.length}`);

const plan = [];
for (const a of active) {
  const L = resolveSlug(a.slug, a.code_postal, MAP);
  if (L && L !== a.slug) plan.push({ id: a.id, old: a.slug, L });
}
console.log(`rows to re-point: ${plan.length}`);

// Find rows already sitting at the target slugs (the duplicates to remove)
const targets = [...new Set(plan.map(p => p.L))];
const existing = targets.length
  ? d1(`SELECT id, slug, source, status FROM annonces WHERE slug IN (${targets.map(s => `'${s}'`).join(',')})`)
  : [];
const bySlug = new Map(existing.map(r => [r.slug, r]));

let withDupe = 0;
for (const p of plan) {
  const dupe = bySlug.get(p.L);
  if (dupe && dupe.id !== p.id) { p.dupeId = dupe.id; p.dupeSource = dupe.source; withDupe++; }
}
console.log(`of which collide with an existing row at the live slug (will delete that duplicate): ${withDupe}`);
console.log('\nsample plan:');
plan.slice(0, 6).forEach(p => console.log(`  #${p.id} ${p.old}\n     -> ${p.L}${p.dupeId ? `  (delete dupe #${p.dupeId} [${p.dupeSource}])` : ''}`));

if (!APPLY) {
  console.log('\nDRY-RUN only. Re-run with --apply to execute.');
  process.exit(0);
}

console.log('\nAPPLYING...');
let done = 0;
for (const p of plan) {
  const stmts = [];
  if (p.dupeId) {
    stmts.push(`DELETE FROM annonces_photos WHERE annonce_id=${p.dupeId};`);
    stmts.push(`DELETE FROM annonces WHERE id=${p.dupeId};`);
  }
  stmts.push(`UPDATE annonces SET slug='${p.L}', updated_at='${new Date().toISOString()}' WHERE id=${p.id};`);
  d1(stmts.join(' '));
  done++;
  if (done % 20 === 0) console.log(`  ${done}/${plan.length}`);
}
console.log(`Done: re-pointed ${done} rows.`);
