#!/usr/bin/env node
// Build-time: group every annonce by its displayed negotiator email and write
// one JSON index per expert to public/_data/expert-listings/{slug}.json. Read by
// the expert page at SSR time to show "Biens en vente / Biens vendus".
//
// Source of truth is D1 (not the static WordPress content snapshot): D1 carries
// the live status ('active'/'closed', incl. LBI field-136 Vendu→closed) and the
// current negotiator, and we dedup the slug-drift duplicates (same reference,
// different slug across sources) keeping the best source. This is why a freshly
// sold LBI bien lands in the right expert's "vendus" with the right status.

import { execSync } from 'node:child_process';
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPerdu } from './perdu-set.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const EXPERTS_DIR = join(ROOT, 'src/content/experts');
const DEST = join(ROOT, 'public/_data/expert-listings');

// Same source priority as sync-d1-to-content: a property present in several
// sources under drifted slugs is kept once, by the most authoritative source.
const SOURCE_PRIORITY = { ubiflow: 0, lbi: 1, wordpress: 2 };

// annonces_photos.url stores a relative R2 key (e.g. "annonces/slug/0.jpg").
// The card <img> needs an absolute URL, so prefix the R2 public base (full URLs
// pass through unchanged).
const R2_PUBLIC = 'https://pub-a37eed540afe4dc9b4479da74ba265e1.r2.dev';
function toPhotoUrl(u) {
  if (!u) return null;
  return /^https?:\/\//.test(u) ? u : `${R2_PUBLIC}/${String(u).replace(/^\/+/, '')}`;
}

function normEmail(raw) {
  if (!raw) return '';
  return raw.split('|')[0].trim().replace(/!+$/, '').toLowerCase();
}

// Display order for an expert's biens: most recent first, but push standalone
// garages/box/parking and low-value biens (< 100k €) to the end — they look bad
// leading the "Vendus" list. A title STARTING with the type word is a standalone
// garage; "T5 ... avec garage" (a real apartment) does not match, so it stays up.
const STANDALONE_GARAGE = /^(garages?|box|parkings?|stationnements?|emplacements?|caves?|place\s+de\s+parking)\b/i;
// 0 = normal (top), 1 = low-value < 100k, 2 = standalone garage (very bottom).
// Garages rank below low-value so they also sink on rental experts, where every
// bien is < 100k (monthly rent) and the price tier alone wouldn't separate them.
function demoteRank(x) {
  if (STANDALONE_GARAGE.test((x.title || '').trim())) return 2;
  const p = typeof x.prix === 'number' ? x.prix : null;
  return (p !== null && p > 0 && p < 100000) ? 1 : 0;
}
function compareListings(a, b) {
  const da = demoteRank(a), db = demoteRank(b);
  if (da !== db) return da - db;                       // demoted group last
  return (b.date || '').localeCompare(a.date || '');   // within group: recent first
}

function queryD1(sql) {
  const cmd = `npx wrangler d1 execute pujol-annonces --remote --json --command="${sql.replace(/"/g, '\\"')}"`;
  const out = execSync(cmd, { encoding: 'utf-8', timeout: 180000, maxBuffer: 128 * 1024 * 1024, env: { ...process.env } });
  return JSON.parse(out)[0]?.results || [];
}

async function loadExperts() {
  const files = await readdir(EXPERTS_DIR);
  const experts = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const d = JSON.parse(await readFile(join(EXPERTS_DIR, f), 'utf-8'));
      const email = normEmail(d.email);
      const aliases = (d.emailAliases || []).map(normEmail).filter(Boolean);
      if (email && d.slug) experts.push({ slug: d.slug, email, aliases, title: d.title });
    } catch {}
  }
  return experts;
}

async function main() {
  if (existsSync(DEST)) await rm(DEST, { recursive: true, force: true });
  await mkdir(DEST, { recursive: true });

  const experts = await loadExperts();
  const byEmail = new Map();
  for (const e of experts) {
    byEmail.set(e.email, e);
    for (const a of e.aliases || []) if (!byEmail.has(a)) byEmail.set(a, e);
  }
  console.log(`experts with email: ${experts.length}`);

  const perdu = await loadPerdu();
  let perduSkipped = 0;

  // Closed-history negotiator reassignment (Caroline's sheet). Maps a listing
  // reference_agence → corrected expert email. LBI is the source of truth for
  // ACTIVE biens, so the override only applies to non-active rows.
  const reassign = JSON.parse(
    await readFile(join(ROOT, 'src/data/expert-reassignments.json'), 'utf-8')
  );
  let reassigned = 0;

  // 1. Every annonce from D1 (active + closed). No descriptif (huge) — use titre.
  console.log('📡 Fetching annonces from D1...');
  const rows = queryD1(`
    SELECT id, slug, status, source, reference_agence, ubiflow_reference,
      type_annonce, titre, prix, surface, nb_pieces, code_postal, ville,
      email_a_afficher, contact_a_afficher, date_creation, termine
    FROM annonces WHERE status != 'dropped'
  `);
  console.log(`  ${rows.length} annonces`);

  // 2. Dedup slug-drift: one row per reference.
  //    LBI is the live management feed and the source of truth for STATUS: a
  //    sold bien is LBI field-136 Vendu→closed, and a bien back on the market is
  //    LBI active. So when a reference has an LBI row, it wins — otherwise a
  //    stale ubiflow "closed" record would keep a re-listed (LBI active) property
  //    in an expert's "Vendus". Without an LBI row, fall back to source priority
  //    for historical biens (only ever in ubiflow/wordpress).
  const refMap = new Map();
  for (const a of rows) {
    const ref = (a.reference_agence || a.ubiflow_reference || '').toLowerCase();
    const key = ref || `slug:${a.slug}`;
    const ex = refMap.get(key);
    if (!ex) {
      refMap.set(key, a);
    } else if (a.source === 'lbi' && ex.source !== 'lbi') {
      refMap.set(key, a); // LBI always wins — live status truth
    } else if (ex.source !== 'lbi' && (SOURCE_PRIORITY[a.source] ?? 9) < (SOURCE_PRIORITY[ex.source] ?? 9)) {
      refMap.set(key, a);
    }
  }
  const deduped = [...refMap.values()];
  console.log(`  ${deduped.length} after reference dedup`);

  // 3. First photo per annonce (lowest position).
  const photoMap = new Map();
  try {
    const photos = queryD1(`SELECT annonce_id, url, MIN(position) AS p FROM annonces_photos GROUP BY annonce_id`);
    for (const p of photos) photoMap.set(p.annonce_id, p.url);
  } catch (e) {
    console.warn(`  ⚠ photos query failed: ${e.message}`);
  }

  // 4. Bucket by expert SLUG (not email): an expert can be reached via primary
  //    email AND aliases (e.g. benoit@ vs benoitmarinvicente@) AND the override,
  //    so keying by email would split one expert across buckets and the per-slug
  //    write below would clobber all but the last.
  const buckets = new Map();
  for (const a of deduped) {
    const ref = (a.reference_agence || a.ubiflow_reference || '').toUpperCase();
    const override = (a.status !== 'active' && ref && reassign[ref]) ? reassign[ref] : null;
    const email = normEmail(override || a.email_a_afficher || a.contact_a_afficher);
    const expert = email ? byEmail.get(email) : null;
    if (!expert) continue;
    if (override) reassigned++;
    // Skip garages / parking / box (Caroline): LBI/Hektor slug prefix lj[vl]ga.
    if (/^lj[vl]ga/i.test(a.slug || '')) continue;
    // Hide "perdu" listings from expert pages (Caroline) — the URL still resolves.
    if (perdu.isPerdu(a.slug)) { perduSkipped++; continue; }

    const b = buckets.get(expert.slug) ?? { expert, arr: [] };
    b.arr.push({
      slug: a.slug,
      title: a.titre || a.slug,
      type: a.type_annonce ?? '',          // V or L
      status: a.status ?? '',              // 'active' or 'closed' (live, from D1)
      saleStatus: a.termine ?? null,       // LBI field-136: sous-offre / sous-compromis / vendu
      prix: a.prix ?? null,
      surface: a.surface ?? null,
      nbPieces: a.nb_pieces ?? null,
      codePostal: a.code_postal ?? '',
      ville: a.ville ?? '',
      photo: toPhotoUrl(photoMap.get(a.id)),
      date: a.date_creation ?? '',
    });
    buckets.set(expert.slug, b);
  }

  // 5. Write per-expert files (same shape the expert page already consumes).
  let written = 0;
  let totalListings = 0;
  for (const [slug, { expert, arr }] of buckets) {
    arr.sort(compareListings);
    const payload = {
      expert: { slug: expert.slug, email: expert.email, title: expert.title },
      totalCount: arr.length,
      listings: arr.slice(0, 400),
    };
    await writeFile(join(DEST, slug + '.json'), JSON.stringify(payload));
    written++;
    totalListings += arr.length;
  }

  console.log(`wrote: ${written} expert files, ${totalListings} total listings (${perduSkipped} "perdu" hidden, ${reassigned} reassigned)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
