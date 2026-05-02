#!/usr/bin/env node
// Seed D1 with existing annonces from src/content/annonces/*.json
// Usage: node scripts/seed-d1-annonces.mjs
// Generates SQL file, then executes it against D1 via wrangler

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ANNONCES_DIR = path.join(process.cwd(), 'src/content/annonces');
const SQL_OUTPUT = path.join(process.cwd(), 'scripts/seed-annonces.sql');
const BATCH_SIZE = 50; // D1 has a 100-statement batch limit

function escapeSQL(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return isNaN(val) ? 'NULL' : String(val);
  if (typeof val === 'boolean') return val ? '1' : '0';
  return "'" + String(val).replace(/'/g, "''") + "'";
}

function parseAnnonce(json, filename) {
  const slug = filename.replace('.json', '');
  return {
    slug,
    permalink: json.permalink || null,
    status: json.status === 'publish' ? 'active' : (json.status || 'closed'),
    wp_id: json.id || null,
    reference_agence: json.referenceAgence || null,
    type_annonce: json.typeAnnonce || null,
    type_bien: null,
    termine: json.termine || null,
    adresse: json.adresse || null,
    code_postal: extractCodePostal(json.adresse),
    ville: extractVille(json.adresse),
    quartier: json.quartier || null,
    arrondissement: json.arrondissement || null,
    latitude: json.coordinates?.lat || null,
    longitude: json.coordinates?.lng || null,
    prix: json.prix || null,
    loyer_cc: json.loyerCC || null,
    loyer_ht: json.loyerHT || null,
    charges: json.charges || null,
    honoraires: json.honoraires || null,
    garantie: json.garantie || null,
    depot_garantie: json.depotGarantie || null,
    surface: json.surface || null,
    surface_terrain: json.surfaceTerrain || null,
    nb_pieces: json.nbPieces || null,
    nb_chambres: json.nbChambres || null,
    nb_salles_bain: json.nbSallesBain || null,
    nb_salles_eau: json.nbSallesEau || null,
    nb_wc: json.nbWC || null,
    etage: json.etage || null,
    nb_etages: json.nbEtages || null,
    meuble: json.meuble ? 1 : 0,
    ascenseur: json.ascenseur ? 1 : 0,
    cave: json.cave ? 1 : 0,
    parking: json.parking || null,
    garage: json.garage || null,
    terrasse: json.terrasse ? 1 : 0,
    balcon: json.balcon || null,
    piscine: json.piscine ? 1 : 0,
    digicode: json.digicode ? 1 : 0,
    interphone: json.interphone ? 1 : 0,
    gardien: json.gardien ? 1 : 0,
    coup_de_coeur: json.coupDeCoeur ? 1 : 0,
    dpe_note: json.dpeNote || null,
    dpe_valeur: json.dpeValeur || null,
    ges_note: json.gesNote || null,
    ges_valeur: json.gesValeur || null,
    type_chauffage: json.typeChauffage || null,
    titre: json.title || null,
    libelle: json.libelle || null,
    descriptif: json.descriptif || null,
    contact_a_afficher: json.contactAAfficher || null,
    telephone_a_afficher: json.telephoneAAfficher || null,
    email_a_afficher: json.emailAAfficher || null,
    mandat_numero: json.mandatNumero || null,
    mandat_type: json.mandatType || null,
    url_visite_virtuelle: json.urlVisiteVirtuelle || null,
    seo_title: json.seoTitle || null,
    seo_description: json.seoDescription || null,
    date_creation: json.date || null,
    date_modification: json.date || null,
    source: 'wordpress',
    photos: json.photos || [],
  };
}

function extractCodePostal(adresse) {
  if (!adresse) return null;
  const match = adresse.match(/\b(13\d{3})\b/);
  return match ? match[1] : null;
}

function extractVille(adresse) {
  if (!adresse) return null;
  // Try to extract city from "..., 13XXX, City ..." pattern
  const match = adresse.match(/13\d{3},?\s*(.+?)(?:,\s*France)?$/i);
  if (match) return match[1].trim();
  return null;
}

function generateInsertSQL(annonce) {
  const columns = [
    'slug', 'permalink', 'status', 'wp_id', 'reference_agence',
    'type_annonce', 'type_bien', 'termine',
    'adresse', 'code_postal', 'ville', 'quartier', 'arrondissement',
    'latitude', 'longitude',
    'prix', 'loyer_cc', 'loyer_ht', 'charges', 'honoraires', 'garantie', 'depot_garantie',
    'surface', 'surface_terrain',
    'nb_pieces', 'nb_chambres', 'nb_salles_bain', 'nb_salles_eau', 'nb_wc',
    'etage', 'nb_etages',
    'meuble', 'ascenseur', 'cave', 'parking', 'garage',
    'terrasse', 'balcon', 'piscine', 'digicode', 'interphone', 'gardien', 'coup_de_coeur',
    'dpe_note', 'dpe_valeur', 'ges_note', 'ges_valeur', 'type_chauffage',
    'titre', 'libelle', 'descriptif',
    'contact_a_afficher', 'telephone_a_afficher', 'email_a_afficher',
    'mandat_numero', 'mandat_type', 'url_visite_virtuelle',
    'seo_title', 'seo_description',
    'date_creation', 'date_modification', 'source',
  ];

  const values = columns.map(col => escapeSQL(annonce[col]));

  return `INSERT OR IGNORE INTO annonces (${columns.join(', ')}) VALUES (${values.join(', ')});`;
}

function generatePhotoSQL(annonceSlug, photos) {
  return photos.map((url, i) =>
    `INSERT INTO annonces_photos (annonce_id, url, position, source) SELECT id, ${escapeSQL(url)}, ${i}, 'wordpress' FROM annonces WHERE slug = ${escapeSQL(annonceSlug)};`
  ).join('\n');
}

// Main
console.log('Reading annonces from', ANNONCES_DIR);
const files = fs.readdirSync(ANNONCES_DIR).filter(f => f.endsWith('.json'));
console.log(`Found ${files.length} annonce files`);

// Generate SQL in batches
let totalSQL = '';
let count = 0;
let photoCount = 0;

// First: all annonce inserts
for (const file of files) {
  try {
    const json = JSON.parse(fs.readFileSync(path.join(ANNONCES_DIR, file), 'utf-8'));
    const annonce = parseAnnonce(json, file);
    totalSQL += generateInsertSQL(annonce) + '\n';
    count++;
  } catch (e) {
    console.error(`Error parsing ${file}:`, e.message);
  }
}

// Then: all photo inserts
for (const file of files) {
  try {
    const json = JSON.parse(fs.readFileSync(path.join(ANNONCES_DIR, file), 'utf-8'));
    const slug = file.replace('.json', '');
    const photos = json.photos || [];
    if (photos.length > 0) {
      totalSQL += generatePhotoSQL(slug, photos) + '\n';
      photoCount += photos.length;
    }
  } catch (e) {
    // Already logged above
  }
}

console.log(`Generated SQL for ${count} annonces and ${photoCount} photos`);

// Write SQL file
fs.writeFileSync(SQL_OUTPUT, totalSQL);
console.log(`SQL written to ${SQL_OUTPUT}`);
console.log(`\nFile size: ${(fs.statSync(SQL_OUTPUT).size / 1024 / 1024).toFixed(1)} MB`);

console.log('\nTo execute against D1:');
console.log('  CLOUDFLARE_ACCOUNT_ID=68abcbaf4817943a805737802e15679a npx wrangler@latest d1 execute pujol-annonces --remote --file=scripts/seed-annonces.sql');
