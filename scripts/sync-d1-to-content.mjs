#!/usr/bin/env node
// Pre-build: fetch active annonces from D1 and write them as JSON
// into src/content/annonces/ so the homepage renders live data.
// Runs as part of `npm run build` before `astro build`.

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import path from 'path';

const ANNONCES_DIR = path.resolve('src/content/annonces');
const R2_PUBLIC = 'https://pub-a37eed540afe4dc9b4479da74ba265e1.r2.dev';

// ── Query D1 ──

function queryD1(sql) {
  const cmd = `npx wrangler d1 execute pujol-annonces --remote --json --command="${sql.replace(/"/g, '\\"')}"`;
  const result = execSync(cmd, {
    encoding: 'utf-8',
    timeout: 60000,
    maxBuffer: 50 * 1024 * 1024,
    env: { ...process.env },
  });
  const parsed = JSON.parse(result);
  return parsed[0]?.results || [];
}

// ── Fetch only the fields we need (avoid giant descriptif blowing up the buffer) ──

console.log('📡 Fetching active annonces from D1...');
const annonces = queryD1(`
  SELECT id, slug, type_annonce, type_bien, titre, descriptif,
    reference_agence, ubiflow_reference,
    adresse, code_postal, ville, quartier,
    prix, loyer_cc, charges, honoraires,
    surface, surface_terrain,
    nb_pieces, nb_chambres, nb_salles_bain, nb_wc,
    etage, nb_etages, ascenseur, cave, terrasse,
    parking, garage, interphone,
    dpe_note, dpe_valeur, ges_note, ges_valeur, type_chauffage,
    contact_a_afficher, telephone_a_afficher, email_a_afficher,
    date_creation
  FROM annonces WHERE status = 'active' ORDER BY date_creation DESC
`);
console.log(`  Found ${annonces.length} active annonces`);

if (annonces.length === 0) {
  console.log('⚠️  No active annonces in D1, skipping content sync');
  process.exit(0);
}

// Fetch all photos for active annonces
const ids = annonces.map(a => a.id).join(',');
const photos = queryD1(
  `SELECT annonce_id, url, position FROM annonces_photos WHERE annonce_id IN (${ids}) ORDER BY position ASC`
);
console.log(`  Found ${photos.length} photos`);

// Group photos by annonce_id
const photoMap = new Map();
for (const p of photos) {
  const list = photoMap.get(p.annonce_id) || [];
  const url = p.url.startsWith('http') ? p.url : `${R2_PUBLIC}/${p.url}`;
  list.push(url);
  photoMap.set(p.annonce_id, list);
}

// ── Remove old D1-synced files (keep WordPress-era ones) ──

const existing = readdirSync(ANNONCES_DIR);
let removed = 0;
for (const f of existing) {
  if (f.endsWith('_d1sync.json')) {
    unlinkSync(path.join(ANNONCES_DIR, f));
    removed++;
  }
}
if (removed > 0) console.log(`  Cleaned ${removed} old D1-synced files`);

// ── Write fresh JSON files ──

mkdirSync(ANNONCES_DIR, { recursive: true });
let written = 0;

for (const a of annonces) {
  const photoUrls = photoMap.get(a.id) || [];
  if (photoUrls.length === 0) continue; // homepage requires photos

  // Build JSON object — omit null values (zod schema uses .optional(), rejects null)
  const json = {
    id: a.id,
    title: a.titre || '',
    slug: a.slug,
    status: 'publish',
    date: a.date_creation || new Date().toISOString(),
    typeAnnonce: a.type_annonce || '',
    typeBien: a.type_bien || '',
    photos: photoUrls,
  };
  // Optional string fields
  const strFields = {
    referenceAgence: a.reference_agence || a.ubiflow_reference,
    adresse: a.adresse, codePostal: a.code_postal, ville: a.ville,
    quartier: a.quartier, honoraires: a.honoraires,
    etage: a.etage, nbEtages: a.nb_etages,
    parking: a.parking, garage: a.garage,
    dpeNote: a.dpe_note, dpeValeur: a.dpe_valeur,
    gesNote: a.ges_note, gesValeur: a.ges_valeur,
    typeChauffage: a.type_chauffage,
    libelle: a.titre, descriptif: a.descriptif,
    contactAAfficher: a.contact_a_afficher,
    telephoneAAfficher: a.telephone_a_afficher,
    emailAAfficher: a.email_a_afficher,
  };
  for (const [k, v] of Object.entries(strFields)) {
    if (v != null && v !== '') json[k] = String(v);
  }
  // Optional number fields
  const numFields = {
    prix: a.prix, loyerCC: a.loyer_cc, charges: a.charges,
    surface: a.surface, surfaceTerrain: a.surface_terrain,
    nbPieces: a.nb_pieces, nbChambres: a.nb_chambres,
    nbSallesBain: a.nb_salles_bain, nbWC: a.nb_wc,
  };
  for (const [k, v] of Object.entries(numFields)) {
    if (v != null) json[k] = v;
  }
  // Optional boolean fields
  if (a.ascenseur === 1) json.ascenseur = true;
  if (a.cave === 1) json.cave = true;
  if (a.terrasse === 1) json.terrasse = true;
  if (a.interphone === 1) json.interphone = true;

  const filename = `${a.slug}_d1sync.json`;
  writeFileSync(path.join(ANNONCES_DIR, filename), JSON.stringify(json, null, 2));
  written++;
}

console.log(`✅ Wrote ${written} annonce JSON files from D1`);

// ── Mark overlapping WordPress files as closed (don't delete) ──
// D1 slugs use shorter format (e.g. "226neot-63-bd-saint-jean-13010-marseille-10")
// WP files use longer format (e.g. "226neot-63-boulevard-saint-jean-13010-marseille-10eme-arrondissement-france")
// Match by reference prefix (everything before the first dash-digit sequence)

const d1Refs = new Set();
for (const a of annonces) {
  // Extract the reference part (e.g. "226neot", "mbvap160009787")
  const ref = a.slug.split('-')[0];
  if (ref) d1Refs.add(ref);
}

const wpFiles = readdirSync(ANNONCES_DIR).filter(f => !f.endsWith('_d1sync.json') && f.endsWith('.json'));
let patched = 0;

for (const f of wpFiles) {
  const ref = f.split('-')[0];
  if (!d1Refs.has(ref)) continue;

  const filePath = path.join(ANNONCES_DIR, f);
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    if (data.status === 'publish') {
      data.status = 'closed';
      writeFileSync(filePath, JSON.stringify(data, null, 2));
      patched++;
    }
  } catch { /* skip unreadable files */ }
}

if (patched > 0) console.log(`🔒 Marked ${patched} overlapping WordPress files as closed`);
