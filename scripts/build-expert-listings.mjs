#!/usr/bin/env node
// Build-time: group every annonce in src/content/annonces/ by the expert email
// on contactAAfficher, and write one JSON index per expert to
// public/_data/expert-listings/{slug}.json. Read by the expert page at SSR
// time to show "Biens gérés — historique".

import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ANNONCES_DIR = join(ROOT, 'src/content/annonces');
const EXPERTS_DIR = join(ROOT, 'src/content/experts');
const DEST = join(ROOT, 'public/_data/expert-listings');

function normEmail(raw) {
  if (!raw) return '';
  return raw.split('|')[0].trim().replace(/!+$/, '').toLowerCase();
}

async function loadExperts() {
  const files = await readdir(EXPERTS_DIR);
  const experts = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const d = JSON.parse(await readFile(join(EXPERTS_DIR, f), 'utf-8'));
      const email = normEmail(d.email);
      if (email && d.slug) experts.push({ slug: d.slug, email, title: d.title });
    } catch {}
  }
  return experts;
}

async function main() {
  if (existsSync(DEST)) await rm(DEST, { recursive: true, force: true });
  await mkdir(DEST, { recursive: true });

  const experts = await loadExperts();
  const byEmail = new Map();
  for (const e of experts) byEmail.set(e.email, e);
  console.log(`experts with email: ${experts.length}`);

  // Bucket: expert email -> array of listing summaries
  const buckets = new Map();
  const files = await readdir(ANNONCES_DIR);
  let scanned = 0;
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    scanned++;
    let d;
    try { d = JSON.parse(await readFile(join(ANNONCES_DIR, f), 'utf-8')); } catch { continue; }
    const email = normEmail(d.contactAAfficher);
    if (!email || !byEmail.has(email)) continue;

    const arr = buckets.get(email) ?? [];
    arr.push({
      slug: d.slug,
      title: d.descriptif ? d.descriptif.slice(0, 80).trim() + '…' : d.slug,
      type: d.typeAnnonce ?? '',           // V or L
      status: d.status ?? '',              // closed or publish
      prix: d.prix ?? null,
      surface: d.surface ?? null,
      nbPieces: d.nbPieces ?? null,
      codePostal: d.codePostal ?? '',
      ville: d.ville ?? '',
      photo: (d.photos && d.photos[0]) ?? null,
      date: d.date ?? '',
    });
    buckets.set(email, arr);
  }

  // Write per-expert files
  let written = 0;
  let totalListings = 0;
  for (const [email, arr] of buckets) {
    arr.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const expert = byEmail.get(email);
    const payload = {
      expert: { slug: expert.slug, email, title: expert.title },
      totalCount: arr.length,
      // Cap payload at 200 most-recent; page can paginate client-side if needed
      listings: arr.slice(0, 200),
    };
    await writeFile(
      join(DEST, expert.slug + '.json'),
      JSON.stringify(payload),
    );
    written++;
    totalListings += arr.length;
  }

  console.log(`scanned: ${scanned} annonces`);
  console.log(`wrote: ${written} expert files, ${totalListings} total listings`);
}

main().catch((e) => { console.error(e); process.exit(1); });
