#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Parity dry-run — blog articles + experts: committed files  vs  D1 rows.
//
// READ-ONLY. Writes no files, runs no build, triggers no deploy. It only SELECTs
// from D1 (exactly as scripts/sync-d1-to-content.mjs already does on every build)
// and reads the committed content files, then reports any content that would be
// LOST or CHANGED if the site started building from D1.
//
// This is step 1 of D1-REBUILD-PLAN.md §9 — it must be clean before we wire any
// D1→file sync into `npm run build`.
//
// Usage (staging D1 = Roy account):
//   CLOUDFLARE_ACCOUNT_ID=68abcbaf4817943a805737802e15679a \
//     node scripts/parity-check-d1-content.mjs            # --remote (default)
//   node scripts/parity-check-d1-content.mjs --local      # local Miniflare D1
//
// Exit code: 0 if no data-loss (no committed slug missing from D1); 1 otherwise.
// ─────────────────────────────────────────────────────────────────────────────

import { execSync } from 'child_process';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const MODE = process.argv.includes('--local') ? '--local' : '--remote';
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i > -1 ? Number(process.argv[i + 1]) : 12; })();
const ARTICLES_DIR = path.resolve('src/content/articles');
const EXPERTS_DIR = path.resolve('src/content/experts');
const DB_NAME = 'pujol-annonces';

// ── D1 access ────────────────────────────────────────────────────────────────

function queryD1(sql) {
  const cmd = `npx wrangler d1 execute ${DB_NAME} ${MODE} --json --command="${sql.replace(/"/g, '\\"')}"`;
  const out = execSync(cmd, { encoding: 'utf-8', timeout: 120000, maxBuffer: 256 * 1024 * 1024, env: { ...process.env } });
  // wrangler may print a banner before the JSON payload — parse from the first bracket.
  const start = out.search(/[[{]/);
  const parsed = JSON.parse(start >= 0 ? out.slice(start) : out);
  return (Array.isArray(parsed) ? parsed[0]?.results : parsed?.results) || [];
}

// Batched read — a single SELECT * over 1000+ big body_html rows overruns the
// buffer / returns partial data (known import-time gotcha). Page by id.
function queryAll(table, columns, pageSize = 150) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const batch = queryD1(`SELECT ${columns} FROM ${table} ORDER BY id LIMIT ${pageSize} OFFSET ${offset}`);
    rows.push(...batch);
    process.stdout.write(`\r    …fetched ${rows.length} from ${table}`);
    if (batch.length < pageSize) break;
  }
  process.stdout.write('\n');
  return rows;
}

// ── committed-file readers ───────────────────────────────────────────────────

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function readCommittedArticles() {
  const map = new Map();
  for (const f of walk(ARTICLES_DIR).filter((f) => f.endsWith('.md'))) {
    const raw = readFileSync(f, 'utf-8');
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!m) { console.warn('  ⚠ no frontmatter:', path.relative(ARTICLES_DIR, f)); continue; }
    let fm;
    try { fm = yaml.load(m[1]) || {}; } catch (e) { console.warn('  ⚠ bad YAML:', f, e.message); continue; }
    map.set(fm.slug, { file: f, fm, body: m[2] });
  }
  return map;
}

function readCommittedExperts() {
  const map = new Map();
  for (const f of walk(EXPERTS_DIR).filter((f) => f.endsWith('.json'))) {
    const j = JSON.parse(readFileSync(f, 'utf-8'));
    map.set(j.slug, { file: f, data: j });
  }
  return map;
}

// ── D1 row → the fields a committed file carries (the future sync mapping) ─────

function safeArr(v) { if (!v) return []; try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }

function articleFromRow(r) {
  return {
    title: r.title, slug: r.slug, date: r.article_date, excerpt: r.excerpt,
    categories: safeArr(r.categories), tags: safeArr(r.tags),
    featuredImage: r.featured_image, seoTitle: r.seo_title, seoDescription: r.seo_description,
    author: r.author, expertCta: r.expert_cta, body: r.body_html, status: r.status,
  };
}
function articleFromFile({ fm, body }) {
  return {
    title: fm.title, slug: fm.slug, date: fm.date, excerpt: fm.excerpt,
    categories: fm.categories || [], tags: fm.tags || [],
    featuredImage: fm.featuredImage, seoTitle: fm.seoTitle, seoDescription: fm.seoDescription,
    author: fm.author, expertCta: fm.expertCta, body,
  };
}
const ARTICLE_FIELDS = ['title', 'date', 'excerpt', 'categories', 'tags', 'featuredImage', 'seoTitle', 'seoDescription', 'author', 'expertCta'];

function expertFromRow(r) {
  return {
    title: r.title, slug: r.slug, fonction: r.fonction, description: r.description, photo: r.photo,
    phone: r.phone, email: r.email, emailAliases: safeArr(r.email_aliases),
    linkedin: r.linkedin, facebook: r.facebook, instagram: r.instagram,
    seoTitle: r.seo_title, seoDescription: r.seo_description, department: r.department,
    order: r.sort_order, agenda: r.agenda, secteur: r.secteur,
    hidden: !!r.hidden, listingOnly: !!r.listing_only,
  };
}
function expertFromFile({ data: d }) {
  return {
    title: d.title, slug: d.slug, fonction: d.fonction, description: d.description, photo: d.photo,
    phone: d.phone, email: d.email, emailAliases: d.emailAliases || [],
    linkedin: d.linkedin, facebook: d.facebook, instagram: d.instagram,
    seoTitle: d.seoTitle, seoDescription: d.seoDescription, department: d.department,
    order: typeof d.order === 'number' ? d.order : null, agenda: d.agenda, secteur: d.secteur,
    hidden: !!d.hidden, listingOnly: !!d.listingOnly,
  };
}
const EXPERT_FIELDS = ['title', 'fonction', 'description', 'photo', 'phone', 'email', 'emailAliases', 'linkedin', 'facebook', 'instagram', 'seoTitle', 'seoDescription', 'department', 'order', 'agenda', 'secteur', 'hidden', 'listingOnly'];

// ── comparison ───────────────────────────────────────────────────────────────

function norm(v) {
  if (Array.isArray(v)) return JSON.stringify(v);
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? '1' : '0';
  return String(v);
}
const eq = (a, b) => norm(a) === norm(b);
const rtrim = (s) => String(s ?? '').replace(/\s+$/g, '');

function compare(label, committed, d1, fields, fromFile, fromRow, opts = {}) {
  const missing = [];   // committed slug absent in D1 → DATA LOSS
  const extra = [];     // D1 slug not committed → new content (informational)
  const drift = [];     // field-level differences on matched slugs
  const bodyDrift = []; // body/description text differs

  for (const [slug, f] of committed) {
    if (!d1.has(slug)) { missing.push({ slug, file: path.relative(process.cwd(), f.file) }); continue; }
    const a = fromFile(f);
    const b = fromRow(d1.get(slug));
    const diffs = fields.filter((k) => !eq(a[k], b[k]));
    if (diffs.length) drift.push({ slug, diffs: diffs.map((k) => ({ k, file: a[k], d1: b[k] })) });
    if (opts.bodyKey) {
      const fb = rtrim(a[opts.bodyKey]), db = rtrim(b[opts.bodyKey]);
      if (fb !== db) bodyDrift.push({ slug, fileLen: fb.length, d1Len: db.length });
    }
  }
  for (const slug of d1.keys()) if (!committed.has(slug)) extra.push(slug);

  // report
  console.log(`\n══════════ ${label} ══════════`);
  console.log(`  committed files : ${committed.size}`);
  console.log(`  D1 rows         : ${d1.size}`);
  console.log(`  ${missing.length ? '❌' : '✅'} missing in D1 (data loss): ${missing.length}`);
  console.log(`  ${drift.length ? '⚠️ ' : '✅'} field drift            : ${drift.length}`);
  if (opts.bodyKey) console.log(`  ${bodyDrift.length ? '⚠️ ' : '✅'} ${opts.bodyKey} drift${' '.repeat(Math.max(0, 16 - opts.bodyKey.length))}: ${bodyDrift.length}`);
  console.log(`  ℹ️  extra in D1 (new)     : ${extra.length}`);

  if (missing.length) {
    console.log(`\n  ❌ MISSING IN D1 (first ${LIMIT}) — these committed pages would DISAPPEAR:`);
    for (const m of missing.slice(0, LIMIT)) console.log(`     • ${m.slug}   (${m.file})`);
  }
  if (drift.length) {
    console.log(`\n  ⚠️  FIELD DRIFT (first ${LIMIT}):`);
    for (const d of drift.slice(0, LIMIT)) {
      console.log(`     • ${d.slug}`);
      for (const df of d.diffs) console.log(`         ${df.k}:  file=${JSON.stringify(clip(df.file))}  d1=${JSON.stringify(clip(df.d1))}`);
    }
  }
  if (opts.bodyKey && bodyDrift.length) {
    console.log(`\n  ⚠️  ${opts.bodyKey.toUpperCase()} DRIFT (first ${LIMIT}) — lengths differ:`);
    for (const d of bodyDrift.slice(0, LIMIT)) console.log(`     • ${d.slug}   file=${d.fileLen} chars, d1=${d.d1Len} chars (Δ${d.d1Len - d.fileLen})`);
  }
  if (extra.length) {
    console.log(`\n  ℹ️  EXTRA IN D1 (first ${LIMIT}) — present in D1, no committed file (fine unless unexpected):`);
    for (const s of extra.slice(0, LIMIT)) console.log(`     • ${s}`);
  }
  return { missing, drift, bodyDrift, extra };
}
function clip(v) { const s = Array.isArray(v) ? JSON.stringify(v) : String(v ?? ''); return s.length > 80 ? s.slice(0, 77) + '…' : s; }

// ── slug-length sanity (slugify caps at 96 → long committed slugs truncate) ────

function reportLongSlugs(committed, label) {
  const long = [...committed.keys()].filter((s) => (s || '').length > 96);
  if (long.length) {
    console.log(`\n  ⚠️  ${label}: ${long.length} committed slug(s) exceed 96 chars — slugify() would truncate these, changing the URL. Verify D1 kept the full slug:`);
    for (const s of long.slice(0, LIMIT)) console.log(`     • (${s.length}) ${s}`);
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

console.log(`Parity dry-run (READ-ONLY)  •  D1 mode: ${MODE}  •  db: ${DB_NAME}`);
if (MODE === '--remote' && !process.env.CLOUDFLARE_ACCOUNT_ID) {
  console.error('\n❌ CLOUDFLARE_ACCOUNT_ID is not set. For staging: export CLOUDFLARE_ACCOUNT_ID=68abcbaf4817943a805737802e15679a');
  process.exit(2);
}

console.log('\n📄 Reading committed files…');
const cArticles = readCommittedArticles();
const cExperts = readCommittedExperts();
console.log(`   articles: ${cArticles.size}   experts: ${cExperts.size}`);

console.log('\n📡 Reading D1…');
const dArticles = new Map(queryAll('blog_articles', 'id, slug, title, excerpt, body_html, featured_image, categories, tags, author, article_date, seo_title, seo_description, expert_cta, status').map((r) => [r.slug, r]));
const dExperts = new Map(queryAll('experts', 'id, slug, title, fonction, description, photo, phone, email, email_aliases, linkedin, facebook, instagram, seo_title, seo_description, department, sort_order, agenda, secteur, hidden, listing_only').map((r) => [r.slug, r]));

const ra = compare('BLOG ARTICLES', cArticles, dArticles, ARTICLE_FIELDS, articleFromFile, articleFromRow, { bodyKey: 'body' });
reportLongSlugs(cArticles, 'articles');
const re = compare('EXPERTS', cExperts, dExperts, EXPERT_FIELDS, expertFromFile, expertFromRow, { bodyKey: 'description' });
reportLongSlugs(cExperts, 'experts');

const lost = ra.missing.length + re.missing.length;
console.log(`\n────────────────────────────────────────`);
console.log(lost === 0
  ? '✅ PARITY OK — every committed page exists in D1. No data loss. (Review any field/body drift above.)'
  : `❌ PARITY FAIL — ${lost} committed page(s) missing from D1. Do NOT switch the build to D1 until resolved.`);
console.log('────────────────────────────────────────');
process.exit(lost === 0 ? 0 : 1);
