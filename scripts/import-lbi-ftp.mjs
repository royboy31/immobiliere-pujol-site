#!/usr/bin/env node
// Import La Boîte Immo (LBI) sale listings from FTP zip into D1 + R2
// Usage: node scripts/import-lbi-ftp.mjs

import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { createRequire } from 'module';
import path from 'path';

// ── Extract CSV from zip ──
import { createReadStream } from 'fs';
import { Buffer } from 'buffer';

// Use Node's built-in zlib isn't enough for zip, use child process
const ZIP_PATH = path.resolve('1_immopujol.zip');

function extractFromZip(filename) {
  // Use python since unzip not available
  const cmd = `python3 -c "import zipfile,sys; z=zipfile.ZipFile('${ZIP_PATH}'); sys.stdout.buffer.write(z.read('${filename}'))"`;
  return execSync(cmd, { maxBuffer: 50 * 1024 * 1024 });
}

// ── Negotiator name → expert email mapping ──
const NEGOTIATOR_MAP = {
  'benoit marin-vicente': 'benoitmarinvicente@immobiliere-pujol.fr',
  'julia lauron': 'julia@immobiliere-pujol.fr',
  'thibault arnoux': 'thibault@immobiliere-pujol.fr',
  'candice loth': 'candice@immobiliere-pujol.fr',
  'caroline pujol': 'carolinepujol@immobiliere-pujol.fr',
  'klaudia duda': 'klaudia@immobiliere-pujol.fr',
};

// Reference prefix → email fallback (used when descriptif has no negotiator signature)
const REF_PREFIX_MAP = {
  'LJ': 'julia@immobiliere-pujol.fr',
  'LC': 'candice@immobiliere-pujol.fr',
  'AT': 'thibault@immobiliere-pujol.fr',
  'SP': 'benoitmarinvicente@immobiliere-pujol.fr',
  'IV': 'thibault@immobiliere-pujol.fr',
};

function parseNegotiator(descriptif) {
  // Strip <br> tags to normalise line breaks in patterns
  const clean = descriptif.replace(/<br\s*\/?>/gi, ' ');
  // Pattern 1: "IMMOBILIERE PUJOL / Name Phone"
  const match = clean.match(/IMMOBILIERE PUJOL\s*\/\s*([^\d]+?)\s+((?:\d{2}\s*){5})/);
  if (match) {
    return { name: match[1].trim(), phone: match[2].replace(/\s/g, '') };
  }
  // Pattern 2: "Name IMMOBILIERE PUJOL Phone"
  const reversed = clean.match(/([A-ZÀ-Ú][a-zà-ú]+[\s\-]+[A-ZÀ-Ú][A-Za-zà-ú\-]+)\s+IMMOBILIERE PUJOL\s+((?:\d{2}\s*){5})/);
  if (reversed) {
    return { name: reversed[1].trim(), phone: reversed[2].replace(/\s/g, '') };
  }
  // Pattern 3: fallback — "Name Phone" near end (with or without spaces in phone)
  const tail = clean.slice(-300);
  const fallback = tail.match(/([A-ZÀ-Ú][a-zà-ú]+[\s\-]+[A-ZÀ-Ú][A-Za-zà-ú\-]+)\s+((?:\d{2}\s*){5})/);
  if (fallback) {
    return { name: fallback[1].trim(), phone: fallback[2].replace(/\s/g, '') };
  }
  return null;
}

function negotiatorToEmail(name) {
  const key = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const [pattern, email] of Object.entries(NEGOTIATOR_MAP)) {
    if (key.includes(pattern) || pattern.includes(key)) return email;
  }
  console.warn(`  ⚠ Unknown negotiator: "${name}" — falling back to agency email`);
  return null;
}

const STREET_TYPES = '(?:rue|boulevard|bd|avenue|av\\.?|place|impasse|chemin|allée|allee|cours|passage|traverse|square|grand[e]?\\s+rue)';

function parseAddress(descriptif, codePostal, ville) {
  const clean = descriptif.replace(/<br\s*\/?>/gi, ' ').trim();
  // Try first block, then full text if not found
  const blocks = [clean.split(/\s{2,}/)[0], clean];
  for (const text of blocks) {
    // Pattern 1: "Number [bis/ter] street-type street-name"
    const numFirst = text.match(
      new RegExp(`(\\d+[,]?\\s*(?:bis|ter)?\\s*${STREET_TYPES}\\s+[A-ZÀ-Úa-zà-ú'\\- ]{2,40}?)(?:\\s+\\d{5}|\\s+Marseille|[,.]|\\s+dans|$)`, 'i')
    );
    if (numFirst) {
      let addr = numFirst[1].trim().replace(/\s+/g, ' ');
      if (!addr.includes(codePostal)) addr += `, ${codePostal} ${ville}`;
      return addr;
    }
    // Pattern 2: "Street-type Name CP Ville"
    const streetFirst = text.match(
      new RegExp(`(${STREET_TYPES}\\s+[A-ZÀ-Úa-zà-ú'\\- ]{2,40})\\s+(\\d{5})\\s+(\\w+)`, 'i')
    );
    if (streetFirst) {
      return `${streetFirst[1].trim()}, ${streetFirst[2]} ${streetFirst[3]}`;
    }
    // Pattern 3: "place/square Name"
    const placeMatch = text.match(
      /((?:place|square)\s+[A-ZÀ-Úa-zà-ú'\\-]{2,25})/i
    );
    if (placeMatch) {
      return `${placeMatch[1].trim()}, ${codePostal} ${ville}`;
    }
  }

  console.warn(`  ⚠ Could not parse address from descriptif`);
  return null;
}

// ── Parse LBI CSV ──
const DELIMITER = '!#';

function parseLbiCsv(buffer) {
  const content = buffer.toString('latin1');
  const lines = content.trim().split('\n');
  const annonces = [];

  for (const line of lines) {
    const f = line.split(DELIMITER).map(v => v.replace(/^"|"$/g, ''));

    // Collect photo URLs by pattern across the whole row. The feed's photo
    // fields are not contiguous (84-92, 163-173, 263 as of 2026-09) and the
    // range also contains non-photo URLs (field 103 = YouTube visite
    // virtuelle), so a positional range both drops photos and ingests videos.
    const photos = [];
    for (const v of f) {
      if (v && v.startsWith('http') && v.includes('staticlbi.com') && v.includes('/photo_')) photos.push(v);
    }

    const annonce = {
      reference: f[1],
      typeAnnonce: f[2] === 'Vente' ? 'V' : 'L',
      typeBien: f[3],
      codePostal: f[4],
      ville: f[5],
      prix: parseFloat(f[10]) || null,
      surface: parseFloat(f[15]) || null,
      surfaceTerrain: parseFloat(f[16]) || null,
      nbPieces: parseInt(f[17]) || null,
      nbChambres: parseInt(f[18]) || null,
      titre: f[19],
      descriptif: f[20],
      etage: f[23] || null,
      nbEtages: f[24] || null,
      anneeConstruction: f[26] || null,
      nbSallesBain: parseInt(f[28]) || null,
      nbSallesEau: parseInt(f[29]) || null,
      nbWC: parseInt(f[30]) || null,
      cave: f[35] === 'OUI',
      terrasse: f[36] === 'OUI',
      parking: f[38] && f[38] !== '0',
      balcon: f[40] === 'OUI',
      ascenseur: f[41] === 'OUI',
      interphone: f[82] === 'OUI',
      telephone: f[104] || null,
      contactNom: f[105]?.trim() || null,
      emailAgence: f[106] || null,
      mandatNumero: f[111] || null,
      mandatDate: f[112] || null,
      dpeValeur: f[175] || null,
      dpeNote: f[176] || null,
      gesValeur: f[177] || null,
      gesNote: f[178] || null,
      photos,
    };

    // Extract negotiator from descriptif
    const nego = parseNegotiator(annonce.descriptif || '');
    if (nego) {
      annonce.email = negotiatorToEmail(nego.name) || annonce.emailAgence;
      annonce.contactNom = nego.name;
      annonce.telephone = nego.phone;
    } else {
      // Fallback: use reference prefix to determine agent
      const prefix = (annonce.reference || '').slice(0, 2).toUpperCase();
      const prefixEmail = REF_PREFIX_MAP[prefix] || null;
      if (prefixEmail) {
        annonce.email = prefixEmail;
        console.log(`  ℹ ${annonce.reference}: no negotiator in descriptif, using ref prefix ${prefix} → ${prefixEmail}`);
      } else {
        annonce.email = null;
        console.warn(`  ⚠ No negotiator found in descriptif for ${annonce.reference}`);
      }
    }

    // Extract address from descriptif
    annonce.adresse = parseAddress(annonce.descriptif || '', annonce.codePostal, annonce.ville);

    // Generate slug (same logic as cron-sync), then re-point onto the original
    // live-URL slug so every writer (cron-sync, this importer, migrate-live-slugs)
    // converges on ONE canonical slug per reference. Without this the importer
    // emitted a slug without the live "-france" suffix, which under
    // ON CONFLICT(slug) inserted a DUPLICATE row instead of updating the live
    // row. See scripts/dedupe-annonce-refs.mjs.
    annonce.slug = resolveSlug(generateSlug(annonce), annonce.codePostal, LIVE_SLUG_MAP);
    annonces.push(annonce);
  }

  return annonces;
}

// Live-URL slug map (token → live slug), shared with cron-sync/migrate. Loaded
// once; empty fallback keeps the generated slug if the map is unavailable.
const LIVE_SLUG_MAP = (() => {
  try {
    return JSON.parse(readFileSync(path.resolve('public/_data/live-slug-map.json'), 'utf8'));
  } catch {
    return {};
  }
})();

// Must match resolveSlug() in workers/cron-sync/index.ts.
function resolveSlug(slug, cp, map) {
  const tok = (slug || '').split('-')[0];
  if (!tok) return slug;
  const live = map[tok];
  if (!live) return slug;
  cp = (cp || '').toString().trim();
  if (cp && !live.includes(cp)) return slug;
  return live;
}

function generateSlug(a) {
  const parts = [];
  if (a.reference) parts.push(a.reference.toLowerCase());
  if (a.codePostal) parts.push(a.codePostal);
  if (a.ville) parts.push(a.ville);
  return parts
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 120);
}

// ── Upload photos to R2 ──
async function uploadPhotosToR2(annonce) {
  const uploaded = [];
  for (let i = 0; i < annonce.photos.length; i++) {
    const key = `annonces/${annonce.slug}/${i}.jpg`;
    const photoUrl = annonce.photos[i];

    try {
      // Check if already exists
      try {
        execSync(`wrangler r2 object get pujol-photos/${key} --pipe > /dev/null 2>&1`, { stdio: 'pipe' });
        console.log(`  ✓ ${key} (exists)`);
        uploaded.push(key);
        continue;
      } catch { /* doesn't exist, upload */ }

      // Download and upload
      console.log(`  ↓ downloading photo ${i}...`);
      const tmpFile = `/tmp/lbi_photo_${i}.jpg`;
      execSync(`curl -sL "${photoUrl}" -o "${tmpFile}"`, { timeout: 30000 });
      execSync(`wrangler r2 object put pujol-photos/${key} --file="${tmpFile}" --content-type="image/jpeg"`, { timeout: 30000 });
      console.log(`  ✓ ${key} (uploaded)`);
      uploaded.push(key);
    } catch (e) {
      console.error(`  ✗ photo ${i} failed: ${e.message}`);
      uploaded.push(photoUrl); // fallback to external URL
    }
  }
  return uploaded;
}

// ── Build D1 SQL ──
function esc(val) {
  if (val === null || val === undefined || val === '') return 'NULL';
  const s = String(val).replace(/'/g, "''");
  return `'${s}'`;
}

function buildUpsertSql(a, photoKeys, now) {
  return `INSERT INTO annonces (
    slug, status, reference_agence,
    type_annonce, type_bien,
    adresse, code_postal, ville,
    prix,
    surface, surface_terrain,
    nb_pieces, nb_chambres, nb_salles_bain, nb_wc,
    etage, nb_etages, ascenseur, cave, terrasse,
    parking, interphone, balcon,
    dpe_note, dpe_valeur, ges_note,
    titre, descriptif,
    contact_a_afficher, telephone_a_afficher, email_a_afficher,
    mandat_numero,
    date_creation, date_modification, source, created_at, updated_at
  ) VALUES (
    ${esc(a.slug)}, 'active', ${esc(a.reference)},
    ${esc(a.typeAnnonce)}, ${esc(a.typeBien)},
    ${esc(a.adresse)}, ${esc(a.codePostal)}, ${esc(a.ville)},
    ${a.prix || 'NULL'},
    ${a.surface || 'NULL'}, ${a.surfaceTerrain || 'NULL'},
    ${a.nbPieces || 'NULL'}, ${a.nbChambres || 'NULL'}, ${a.nbSallesBain || 'NULL'}, ${a.nbWC || 'NULL'},
    ${esc(a.etage)}, ${esc(a.nbEtages)}, ${a.ascenseur ? 1 : 0}, ${a.cave ? 1 : 0}, ${a.terrasse ? 1 : 0},
    ${a.parking ? "'1'" : 'NULL'}, ${a.interphone ? 1 : 0}, ${a.balcon ? 1 : 0},
    ${esc(a.dpeNote)}, ${esc(a.dpeValeur)}, ${esc(a.gesNote)},
    ${esc(a.titre)}, ${esc(a.descriptif)},
    ${esc(a.contactNom)}, ${esc(a.telephone)}, ${esc(a.email)},
    ${esc(a.mandatNumero)},
    ${esc(now)}, ${esc(now)}, 'lbi', ${esc(now)}, ${esc(now)}
  )
  ON CONFLICT(slug) DO UPDATE SET
    status='active', reference_agence=excluded.reference_agence,
    type_annonce=excluded.type_annonce, type_bien=excluded.type_bien,
    adresse=excluded.adresse,
    code_postal=excluded.code_postal, ville=excluded.ville,
    prix=excluded.prix,
    surface=excluded.surface, surface_terrain=excluded.surface_terrain,
    nb_pieces=excluded.nb_pieces, nb_chambres=excluded.nb_chambres,
    nb_salles_bain=excluded.nb_salles_bain, nb_wc=excluded.nb_wc,
    etage=excluded.etage, nb_etages=excluded.nb_etages,
    ascenseur=excluded.ascenseur, cave=excluded.cave, terrasse=excluded.terrasse,
    parking=excluded.parking, interphone=excluded.interphone, balcon=excluded.balcon,
    dpe_note=excluded.dpe_note, dpe_valeur=excluded.dpe_valeur, ges_note=excluded.ges_note,
    titre=excluded.titre, descriptif=excluded.descriptif,
    contact_a_afficher=excluded.contact_a_afficher,
    telephone_a_afficher=excluded.telephone_a_afficher,
    email_a_afficher=excluded.email_a_afficher,
    mandat_numero=excluded.mandat_numero,
    date_modification=excluded.date_modification, source='lbi',
    date_fermeture=NULL, updated_at=excluded.updated_at;`;
}

function buildPhotoSql(slug, photoKeys) {
  const lines = [];
  // Delete existing photos for this annonce first
  lines.push(`DELETE FROM annonces_photos WHERE annonce_id = (SELECT id FROM annonces WHERE slug = ${esc(slug)});`);
  for (let i = 0; i < photoKeys.length; i++) {
    lines.push(`INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES ((SELECT id FROM annonces WHERE slug = ${esc(slug)}), ${esc(photoKeys[i])}, ${i}, 'r2');`);
  }
  return lines.join('\n');
}

// ── Main ──
async function main() {
  console.log('📦 Extracting Annonces.csv from zip...');
  const csvBuffer = extractFromZip('Annonces.csv');
  const annonces = parseLbiCsv(csvBuffer);
  console.log(`Found ${annonces.length} annonces\n`);

  const now = new Date().toISOString();
  const allSql = [];

  for (const a of annonces) {
    console.log(`── ${a.reference}: ${a.titre.substring(0, 50)}`);
    console.log(`   Slug: ${a.slug}`);
    console.log(`   ${a.typeBien} ${a.surface}m² - ${a.prix}€ - ${a.photos.length} photos`);

    // Upload photos to R2
    console.log('   Uploading photos to R2...');
    const photoKeys = await uploadPhotosToR2(a);

    // Build SQL
    allSql.push(buildUpsertSql(a, photoKeys, now));
    allSql.push(buildPhotoSql(a.slug, photoKeys));
    console.log('');
  }

  // Write SQL and execute against D1
  const sqlFile = path.resolve('scripts/import-lbi.sql');
  const { writeFileSync } = await import('fs');
  writeFileSync(sqlFile, allSql.join('\n\n'));
  console.log(`\n📝 SQL written to ${sqlFile}`);

  console.log('\n🗄️  Executing against D1 (pujol-annonces)...');
  try {
    const result = execSync(`wrangler d1 execute pujol-annonces --remote --file=scripts/import-lbi.sql`, {
      cwd: path.resolve('.'),
      encoding: 'utf-8',
      timeout: 60000,
    });
    console.log(result);
    console.log('✅ Import complete!');
  } catch (e) {
    console.error('D1 execution failed:', e.message);
    console.log('SQL file saved at scripts/import-lbi.sql — you can run manually with:');
    console.log('  wrangler d1 execute pujol-annonces --remote --file=scripts/import-lbi.sql');
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
