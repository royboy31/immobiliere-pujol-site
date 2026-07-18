#!/usr/bin/env node
// Remove hand-branded first photos (baked-in "Vendu"/"Sous promesse" macaron + salesperson
// portrait, made in Canva) from closed sold listings.
//
// Matches the EXACT branded image from the human-verified CSV (never blind position 0, because
// the branded composite is sometimes the 2nd photo). For each listing it removes the matched
// annonces_photos row + renumbers, and drops the same entry from the JSON archive (durability
// against a D1 reseed + the ClosedLinkBlock thumbnails).
//
//   node scripts/clean-branded-covers.mjs            # DRY RUN (default): reports, no writes
//   node scripts/clean-branded-covers.mjs --apply    # writes: D1 delete/renumber + JSON edit
//
// D1 target follows the ambient wrangler config/creds:
//   - local (repo wrangler.jsonc)  -> STAGING (Roy account)
//   - GitHub Actions w/ Pujol creds -> PROD   (Pujol account)   [option c]
//
// Env: CSV_PATH, D1_NAME (default pujol-annonces), OUT_DIR, CONTENT_DIR.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const SKIP_D1 = process.argv.includes('--skip-d1');     // with --apply: edit JSON archive only
const SKIP_JSON = process.argv.includes('--skip-json'); // with --apply: write prod D1 only (CI/option-c)
const CSV_PATH = process.env.CSV_PATH || 'scripts/data/branded-first-images.csv';
const D1_NAME = process.env.D1_NAME || 'pujol-annonces';
const CONTENT_DIR = process.env.CONTENT_DIR || 'src/content/annonces';
const OUT_DIR = process.env.OUT_DIR || '/Volumes/Projects/Puyol Immo/plans/sold-first-image-cleanup';

// --- tiny helpers ---------------------------------------------------------
const q = (s) => String(s).replace(/'/g, "''");
// Normalize a photo URL to its R2 key (bucket-agnostic): everything after ".r2.dev/",
// query stripped. Falls back to the pathname for non-r2 urls.
function normKey(u) {
  if (!u) return '';
  let s = String(u).split('?')[0].split('#')[0];
  if (s.includes('.r2.dev/')) s = s.split('.r2.dev/').pop();
  else if (s.startsWith('http')) { try { s = new URL(s).pathname; } catch {} }
  return s.replace(/^\/+/, '');
}
const base = (u) => normKey(u).split('/').pop().toLowerCase();
// Content id of a listing photo: the `photo_<hash>` token, ignoring any `-NN` size suffix / host.
// The branded composite is stored as several byte-identical copies sharing this hash (r2 `-NN`
// copy + LBI base copy, sometimes more), so we match/remove ALL of them, not just one URL.
const photoHash = (u) => { const m = base(u).match(/photo_([a-f0-9]{16,})/); return m ? m[1] : ''; };
const slugFromUrl = (u) => (String(u).match(/\/annonces\/([^/?#]+)/) || [])[1] || '';

function parseCsvLine(line) {
  const out = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function d1(query) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', D1_NAME, '--remote', '--json', '--command', query],
    { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  // wrangler --json prints leading log lines before the JSON array; grab from first '['
  const jsonStart = out.indexOf('[');
  const parsed = JSON.parse(out.slice(jsonStart));
  return parsed[0]?.results ?? parsed.results ?? [];
}

// --- load CSV -------------------------------------------------------------
const lines = readFileSync(CSV_PATH, 'utf8').split(/\r?\n/).filter((l) => l.trim());
const header = parseCsvLine(lines[0]);
const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
const rows = lines.slice(1).map((l) => {
  const f = parseCsvLine(l);
  const property_url = f[col.property_url];
  return {
    index: f[col.index],
    expert: f[col.expert],
    ref: (f[col.ref] || '').trim(),
    slug: slugFromUrl(property_url),
    image_url: (f[col.image_url] || '').trim(),
    brandedKey: normKey(f[col.image_url]),
    brandedBase: base(f[col.image_url]),
    brandedHash: photoHash(f[col.image_url]),
  };
});
console.log(`Loaded ${rows.length} listings from CSV.`);

// --- batch-resolve annonces + photos from D1 ------------------------------
const slugs = [...new Set(rows.map((r) => r.slug).filter(Boolean))];
const refs = [...new Set(rows.map((r) => r.ref).filter(Boolean))];
const annonces = d1(
  `SELECT id, slug, reference_agence, status FROM annonces ` +
  `WHERE slug IN (${slugs.map((s) => `'${q(s)}'`).join(',')}) ` +
  `OR reference_agence IN (${refs.map((s) => `'${q(s)}'`).join(',')})`
);
const bySlug = new Map(), byRef = new Map();
for (const a of annonces) { if (a.slug) bySlug.set(a.slug, a); if (a.reference_agence) byRef.set(a.reference_agence, a); }

const ids = [...new Set(annonces.map((a) => a.id))];
const photos = ids.length ? d1(
  `SELECT id, annonce_id, url, position, source FROM annonces_photos ` +
  `WHERE annonce_id IN (${ids.join(',')}) ORDER BY annonce_id, position`
) : [];
const photosByAnnonce = new Map();
for (const p of photos) {
  if (!photosByAnnonce.has(p.annonce_id)) photosByAnnonce.set(p.annonce_id, []);
  photosByAnnonce.get(p.annonce_id).push(p);
}

// --- evaluate each listing ------------------------------------------------
const report = [], manifest = [], counts = {};
const bump = (k) => (counts[k] = (counts[k] || 0) + 1);

for (const r of rows) {
  const a = bySlug.get(r.slug) || byRef.get(r.ref) || null;
  const rec = { ...r, annonce_id: a?.id ?? '', status: a?.status ?? '', flag: '', d1_pos: '', d1_source: '', total: '',
    new_cover: '', cover_changes: '', json_idx: '', notes: '' };

  if (!a) { rec.flag = 'NOT_IN_D1'; bump(rec.flag); report.push(rec); continue; }
  if (a.status !== 'closed') rec.notes += `status=${a.status};`;

  const ph = (photosByAnnonce.get(a.id) || []).slice().sort((x, y) => x.position - y.position);
  rec.total = ph.length;
  // Match ALL copies of the branded image: by content hash (catches the r2 `-NN` copy AND the
  // byte-identical LBI base copy), with exact-url as a fallback for non-`photo_<hash>` names.
  const isBranded = (u) => (r.brandedHash && photoHash(u) === r.brandedHash) || normKey(u) === r.brandedKey || base(u) === r.brandedBase;
  const matches = ph.filter((p) => isBranded(p.url));
  const remaining = ph.filter((p) => !isBranded(p.url)).sort((x, y) => x.position - y.position);

  // JSON archive: how many branded copies are in photos[]
  const jsonFile = path.join(CONTENT_DIR, `${r.slug}.json`);
  let jsonPhotos = null, jsonHits = [];
  if (existsSync(jsonFile)) {
    try {
      jsonPhotos = JSON.parse(readFileSync(jsonFile, 'utf8')).photos || [];
      jsonHits = jsonPhotos.map((u, i) => (isBranded(u) ? i : -1)).filter((i) => i >= 0);
    } catch { rec.notes += 'json_parse_error;'; }
  } else rec.notes += 'json_missing;';
  rec.json_idx = jsonPhotos ? (jsonHits.join('|') || 'none') : '';
  // JSON-archive edit is file-driven & independent of D1 state (D1 may already be clean in this env / on re-run)
  if (APPLY && !SKIP_JSON && jsonPhotos && jsonHits.length && jsonPhotos.length - jsonHits.length > 0) {
    const obj = JSON.parse(readFileSync(jsonFile, 'utf8'));
    obj.photos = obj.photos.filter((u) => !isBranded(u));
    writeFileSync(jsonFile, JSON.stringify(obj, null, 2) + '\n');
    rec.notes += `json_removed_${jsonHits.length};`;
  }

  if (matches.length === 0) {
    rec.flag = ph.length ? 'ALREADY_REMOVED_D1' : 'NO_PHOTOS';
    bump(rec.flag); report.push(rec); continue;
  }

  rec.copies = matches.length;
  rec.d1_pos = matches.map((m) => m.position).join('|');
  rec.d1_source = [...new Set(matches.map((m) => m.source))].join('|');
  const coverChanges = Math.min(...matches.map((m) => m.position)) === 0;
  rec.cover_changes = coverChanges ? 'yes' : 'no(cover already clean)';
  rec.new_cover = base(remaining[0]?.url || '');
  if (!remaining.length) rec.flag = 'ALL_BRANDED_NO_CLEAN';       // every photo is the branded shot -> needs Caroline
  else rec.flag = coverChanges ? 'OK_COVER' : 'OK_NONCOVER';
  bump(rec.flag);

  for (const m of matches) manifest.push({ slug: r.slug, ref: r.ref, annonce_id: a.id,
    photo_row_id: m.id, removed_url: m.url, removed_position: m.position, source: m.source });
  report.push(rec);

  // --- apply D1 (JSON handled above; skip if it would leave the listing with zero photos) ---
  if (APPLY && !SKIP_D1 && remaining.length > 0) {
    d1(`DELETE FROM annonces_photos WHERE id IN (${matches.map((m) => m.id).join(',')});`);
    // re-sequence the kept photos to contiguous 0-based order (kept is already position-sorted)
    const cases = remaining.map((p, i) => `WHEN ${p.id} THEN ${i}`).join(' ');
    d1(`UPDATE annonces_photos SET position = CASE id ${cases} END WHERE id IN (${remaining.map((p) => p.id).join(',')});`);
  }
}

// --- write outputs --------------------------------------------------------
mkdirSync(OUT_DIR, { recursive: true });
const cols = ['index', 'expert', 'ref', 'slug', 'annonce_id', 'status', 'flag', 'copies', 'd1_pos', 'd1_source', 'total',
  'cover_changes', 'new_cover', 'json_idx', 'brandedBase', 'notes'];
const csv = [cols.join(','), ...report.map((r) => cols.map((c) => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
const suffix = APPLY ? 'apply' : 'dry-run';
writeFileSync(path.join(OUT_DIR, `report-${suffix}.csv`), csv + '\n');
writeFileSync(path.join(OUT_DIR, `manifest-${suffix}.json`), JSON.stringify(manifest, null, 2));

// --- summary --------------------------------------------------------------
const targets = APPLY ? `APPLY -> ${[!SKIP_D1 && 'D1', !SKIP_JSON && 'JSON'].filter(Boolean).join('+')}` : 'DRY RUN (no writes)';
console.log(`\nMode: ${targets}  |  D1: ${D1_NAME}`);
console.log('Result by flag:');
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(20)} ${v}`);
const actionable = (counts.OK_COVER || 0) + (counts.OK_NONCOVER || 0);
console.log(`\nActionable listings: ${actionable} (${counts.OK_COVER || 0} change the cover, ${counts.OK_NONCOVER || 0} non-cover).`);
console.log(`Branded photo copies removed across all listings: ${manifest.length} (avg ${actionable ? (manifest.length / actionable).toFixed(1) : 0} per listing).`);
console.log(`Report:   ${path.join(OUT_DIR, `report-${suffix}.csv`)}`);
console.log(`Manifest: ${path.join(OUT_DIR, `manifest-${suffix}.json`)}`);
const warn = (counts.NOT_IN_D1 || 0) + (counts.ALL_BRANDED_NO_CLEAN || 0) + (counts.NO_PHOTOS || 0);
if (warn) console.log(`\n⚠  ${warn} row(s) need review: NOT_IN_D1=${counts.NOT_IN_D1 || 0}, ALL_BRANDED_NO_CLEAN=${counts.ALL_BRANDED_NO_CLEAN || 0} (no clean photo -> Caroline), NO_PHOTOS=${counts.NO_PHOTOS || 0}.`);
