#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Build-time sync: D1 experts (PUBLISHED snapshot) → src/content/experts/*.json
//
// Reads published_json ONLY. Mirrors sync-d1-articles-to-content.mjs. Runs in the
// `npm run build` chain BEFORE `astro build`. D1 is authoritative for experts:
// rewrites src/content/experts and removes any .json not backed by a published
// row. BUILD ARTIFACTS — never commit (restore with
// `git checkout HEAD -- src/content/experts`).
//
// Empty fields are OMITTED (matches the hand-authored JSON, and avoids the zod
// `agenda: .url()` schema rejecting an empty string). Snake_case → camelCase.
//
// ABORTS the build (exit 1) on any D1 error or a 0-row result.
// ─────────────────────────────────────────────────────────────────────────────

import { execSync } from 'child_process';
import { writeFileSync, readdirSync, rmSync, mkdirSync } from 'fs';
import path from 'path';

const MODE = process.argv.includes('--local') ? '--local' : '--remote';
const DIR = path.resolve('src/content/experts');
const DB = 'pujol-annonces';

function queryD1(sql) {
  const out = execSync(`npx wrangler d1 execute ${DB} ${MODE} --json --command="${sql.replace(/"/g, '\\"')}"`,
    { encoding: 'utf-8', timeout: 120000, maxBuffer: 128 * 1024 * 1024, env: { ...process.env } });
  const s = out.search(/[[{]/);
  return JSON.parse(s >= 0 ? out.slice(s) : out)[0].results || [];
}

const safeArr = (v) => { if (Array.isArray(v)) return v; if (!v) return []; try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } };

console.log(`📡 Syncing experts (published_json, ${MODE}) → content…`);
let rows;
try { rows = queryD1('SELECT published_json FROM experts WHERE published_json IS NOT NULL ORDER BY id'); }
catch (e) { console.error('❌ D1 read failed — aborting build:', e.message); process.exit(1); }
if (!rows.length) { console.error('❌ 0 published experts from D1 — aborting build.'); process.exit(1); }

const written = new Set();
mkdirSync(DIR, { recursive: true });
let count = 0;
for (const r of rows) {
  let e; try { e = JSON.parse(r.published_json); } catch { continue; }
  if (!e || !e.slug) continue;
  const j = { title: e.title || '', slug: e.slug };
  const put = (k, v) => { if (v !== null && v !== undefined && v !== '') j[k] = v; };
  put('fonction', e.fonction);
  put('description', e.description);
  put('photo', e.photo);
  put('phone', e.phone);
  put('email', e.email);
  const aliases = safeArr(e.email_aliases); if (aliases.length) j.emailAliases = aliases;
  put('linkedin', e.linkedin); put('facebook', e.facebook); put('instagram', e.instagram);
  put('seoTitle', e.seo_title); put('seoDescription', e.seo_description);
  put('department', e.department);
  if (e.sort_order !== null && e.sort_order !== undefined) j.order = Number(e.sort_order);
  put('agenda', e.agenda);       // omit when empty → zod .url() would reject ''
  put('secteur', e.secteur);
  if (e.hidden) j.hidden = true;
  if (e.listing_only) j.listingOnly = true;

  const file = path.join(DIR, `${e.slug.replace(/\//g, '__')}.json`);
  writeFileSync(file, JSON.stringify(j, null, 2) + '\n');
  written.add(path.resolve(file));
  count++;
}

let removed = 0;
for (const f of readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
  if (!written.has(path.resolve(path.join(DIR, f)))) { rmSync(path.join(DIR, f)); removed++; }
}

console.log(`✅ Wrote ${count} experts from D1, removed ${removed} stale.`);
