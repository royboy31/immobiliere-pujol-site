// Cron worker — runs hourly, syncs Ubiflow feed → D1 + R2
// Deployed as a separate worker alongside the main Astro site

import { XMLParser } from 'fast-xml-parser';
import { unzipSync, strFromU8 } from 'fflate';

const UBIFLOW_URL =
  'https://sw.ubiflow.net/diffusion-annonces.php?MDP_PARTENAIRE=55a6fc447c0ac5c3840087406768fbc760671110&DIFFUSEUR=IMMOBILIERE_PUJOL&ANNONCEUR=ag132582';

interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  GITHUB_TOKEN: string;
  GITHUB_REPO: string; // "owner/repo"
}

// ── XML parsing (inlined from src/lib/ubiflow.ts to keep this worker self-contained) ──

function str(val: unknown): string {
  if (val === undefined || val === null) return '';
  return String(val).trim();
}
function num(val: unknown): number | null {
  if (val === undefined || val === null) return null;
  const n = parseFloat(String(val));
  return isNaN(n) ? null : n;
}
function bool(val: unknown): boolean {
  if (val === undefined || val === null) return false;
  const s = String(val).toLowerCase();
  return s === 'true' || s === '1' || s === 'oui';
}

interface ParsedAnnonce {
  id: string;
  reference: string;
  titre: string;
  description: string;
  contactAAfficher: string;
  emailAAfficher: string;
  telephoneAAfficher: string;
  type: 'V' | 'L';
  prix: number | null;
  loyerCC: number | null;
  charges: number | null;
  depotGarantie: number | null;
  honorairesChargeAcquereur: boolean;
  fraisAgence: number | null;
  libelleType: string;
  codePostal: string;
  adresse: string;
  ville: string;
  quartier: string;
  latitude: number | null;
  longitude: number | null;
  surface: number | null;
  surfaceTerrain: number | null;
  nbPieces: number | null;
  nbChambres: number | null;
  nbSallesDeBain: number | null;
  nbWC: number | null;
  etage: string;
  nbEtages: string;
  typeChauffage: string;
  ascenseur: boolean;
  terrasse: boolean;
  cave: boolean;
  parking: boolean;
  garage: boolean;
  interphone: boolean;
  dpeEtiquetteConso: string;
  dpeValeurConso: string;
  dpeEtiquetteGes: string;
  dpeValeurGes: string;
  mandatNumero: string;
  mandatType: string;
  photos: string[];
  slug: string;
}

function generateSlug(a: Partial<ParsedAnnonce>): string {
  const parts: string[] = [];
  if (a.reference) parts.push(a.reference.toLowerCase());
  if (a.adresse) parts.push(a.adresse);
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

function parseAnnonce(raw: any): ParsedAnnonce {
  const bien = raw.bien || {};
  const prestation = raw.prestation || {};
  const diagnostics = bien.diagnostiques || raw.diagnostiques || raw.diagnostics || {};
  const photosRaw = raw.photos?.photo;
  let photos: string[] = [];
  if (Array.isArray(photosRaw)) photos = photosRaw.map((p: any) => str(p)).filter(Boolean);
  else if (photosRaw) photos = [str(photosRaw)].filter(Boolean);

  const type = (str(prestation.type) || 'L') as 'V' | 'L';
  const a: ParsedAnnonce = {
    id: str(raw['@_id']),
    reference: str(raw.reference),
    titre: str(raw.titre),
    description: str(raw.texte),
    contactAAfficher: str(raw.contact_a_afficher),
    emailAAfficher: str(raw.email_a_afficher),
    telephoneAAfficher: str(raw.telephone_a_afficher),
    type,
    prix: num(prestation.prix),
    loyerCC: num(prestation.loyer_mensuel_cc) ?? num(prestation.loyer_cc),
    charges: num(prestation.charges),
    depotGarantie: num(prestation.depot_garantie),
    honorairesChargeAcquereur: bool(prestation.honoraires_charge_acquereur),
    fraisAgence: num(prestation.frais_agence),
    libelleType: str(bien.libelle_type),
    codePostal: str(bien.code_postal),
    adresse: str(bien.adresse),
    ville: str(bien.ville),
    quartier: str(bien.quartier),
    latitude: num(bien.latitude),
    longitude: num(bien.longitude),
    surface: num(bien.surface),
    surfaceTerrain: num(bien.surface_terrain),
    nbPieces: num(bien.nb_pieces),
    nbChambres: num(bien.nb_chambres),
    nbSallesDeBain: num(bien.nb_salles_de_bain),
    nbWC: num(bien.nb_wc),
    etage: str(bien.etage),
    nbEtages: str(bien.nb_etages),
    typeChauffage: str(bien.type_chauffage),
    ascenseur: bool(bien.ascenseur),
    terrasse: bool(bien.terrasse),
    cave: bool(bien.cave),
    parking: bool(bien.parking) || bool(bien.places_parking),
    garage: bool(bien.garage),
    interphone: bool(bien.interphone),
    dpeEtiquetteConso: str(diagnostics.dpe_etiquette_conso),
    dpeValeurConso: str(diagnostics.dpe_valeur_conso),
    dpeEtiquetteGes: str(diagnostics.dpe_etiquette_ges),
    dpeValeurGes: str(diagnostics.dpe_valeur_ges),
    mandatNumero: str(prestation.mandat_numero),
    mandatType: str(prestation.mandat_type),
    photos,
    slug: '',
  };
  a.slug = generateSlug(a);
  return a;
}

async function fetchFeed(): Promise<ParsedAnnonce[]> {
  const resp = await fetch(UBIFLOW_URL);
  if (!resp.ok) throw new Error(`Ubiflow fetch failed: ${resp.status}`);
  const xml = await resp.text();
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const doc = parser.parse(xml);
  const rawList = doc?.client?.annonce;
  if (!rawList) return [];
  const list = Array.isArray(rawList) ? rawList : [rawList];
  return list.map(parseAnnonce);
}

// ── Trigger site redeploy via GitHub Actions workflow_dispatch ──

async function triggerRedeploy(env: Env): Promise<boolean> {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    console.log('[cron-sync] No GITHUB_TOKEN/GITHUB_REPO — skipping redeploy trigger');
    return false;
  }
  try {
    const resp = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/deploy.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'pujol-cron-sync',
        },
        body: JSON.stringify({ ref: 'main' }),
      }
    );
    if (resp.ok || resp.status === 204) {
      console.log('[cron-sync] Redeploy triggered successfully');
      return true;
    }
    console.error(`[cron-sync] Redeploy trigger failed: ${resp.status} ${await resp.text()}`);
    return false;
  } catch (e: any) {
    console.error(`[cron-sync] Redeploy trigger error: ${e.message}`);
    return false;
  }
}

// ── Sync logic (batched to stay within Worker subrequest limits) ──

async function uploadPhotos(
  bucket: R2Bucket,
  a: ParsedAnnonce,
  stats: { photosUploaded: number }
): Promise<string[]> {
  const r2Urls: string[] = [];
  for (let i = 0; i < a.photos.length; i++) {
    const key = `annonces/${a.slug}/${i}.jpg`;
    try {
      const head = await bucket.head(key);
      if (head) { r2Urls.push(key); continue; }
      const resp = await fetch(a.photos[i]);
      if (!resp.ok) { r2Urls.push(a.photos[i]); continue; }
      const blob = await resp.arrayBuffer();
      await bucket.put(key, blob, {
        httpMetadata: { contentType: resp.headers.get('content-type') || 'image/jpeg' },
      });
      r2Urls.push(key);
      stats.photosUploaded++;
    } catch {
      r2Urls.push(a.photos[i]);
    }
  }
  return r2Urls;
}

function buildUpsertStmt(db: D1Database, a: ParsedAnnonce, now: string): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO annonces (
      slug, status, ubiflow_annonce_id, ubiflow_reference,
      type_annonce, type_bien,
      adresse, code_postal, ville, quartier, latitude, longitude,
      prix, loyer_cc, charges, depot_garantie, honoraires,
      surface, surface_terrain,
      nb_pieces, nb_chambres, nb_salles_bain, nb_wc,
      etage, nb_etages, ascenseur, cave, terrasse,
      parking, garage, interphone,
      dpe_note, dpe_valeur, ges_note, ges_valeur, type_chauffage,
      titre, descriptif,
      contact_a_afficher, telephone_a_afficher, email_a_afficher,
      mandat_numero, mandat_type,
      date_creation, date_modification, source, created_at, updated_at
    ) VALUES (
      ?,'active',?,?, ?,?, ?,?,?,?,?,?, ?,?,?,?,?, ?,?, ?,?,?,?, ?,?,?,?,?, ?,?,?, ?,?,?,?,?, ?,?, ?,?,?, ?,?, ?,?,'ubiflow',?,?
    )
    ON CONFLICT(slug) DO UPDATE SET
      status='active', ubiflow_annonce_id=excluded.ubiflow_annonce_id,
      ubiflow_reference=excluded.ubiflow_reference,
      type_annonce=excluded.type_annonce, type_bien=excluded.type_bien,
      adresse=excluded.adresse, code_postal=excluded.code_postal,
      ville=excluded.ville, quartier=excluded.quartier,
      latitude=excluded.latitude, longitude=excluded.longitude,
      prix=excluded.prix, loyer_cc=excluded.loyer_cc,
      charges=excluded.charges, depot_garantie=excluded.depot_garantie,
      honoraires=excluded.honoraires,
      surface=excluded.surface, surface_terrain=excluded.surface_terrain,
      nb_pieces=excluded.nb_pieces, nb_chambres=excluded.nb_chambres,
      nb_salles_bain=excluded.nb_salles_bain, nb_wc=excluded.nb_wc,
      etage=excluded.etage, nb_etages=excluded.nb_etages,
      ascenseur=excluded.ascenseur, cave=excluded.cave, terrasse=excluded.terrasse,
      parking=excluded.parking, garage=excluded.garage, interphone=excluded.interphone,
      dpe_note=excluded.dpe_note, dpe_valeur=excluded.dpe_valeur,
      ges_note=excluded.ges_note, ges_valeur=excluded.ges_valeur, type_chauffage=excluded.type_chauffage,
      titre=excluded.titre, descriptif=excluded.descriptif,
      contact_a_afficher=excluded.contact_a_afficher,
      telephone_a_afficher=excluded.telephone_a_afficher,
      email_a_afficher=excluded.email_a_afficher,
      mandat_numero=excluded.mandat_numero, mandat_type=excluded.mandat_type,
      date_modification=excluded.date_modification, source='ubiflow',
      date_fermeture=NULL, updated_at=excluded.updated_at`
  ).bind(
    a.slug, a.id, a.reference, a.type, a.libelleType,
    a.adresse, a.codePostal, a.ville, a.quartier, a.latitude, a.longitude,
    a.prix, a.loyerCC, a.charges, a.depotGarantie,
    a.fraisAgence != null ? String(a.fraisAgence) : null,
    a.surface, a.surfaceTerrain,
    a.nbPieces, a.nbChambres, a.nbSallesDeBain, a.nbWC,
    a.etage || null, a.nbEtages || null,
    a.ascenseur ? 1 : 0, a.cave ? 1 : 0, a.terrasse ? 1 : 0,
    a.parking ? '1' : null, a.garage ? '1' : null, a.interphone ? 1 : 0,
    a.dpeEtiquetteConso || null, a.dpeValeurConso || null, a.dpeEtiquetteGes || null, a.dpeValeurGes || null,
    a.typeChauffage || null,
    a.titre, a.description,
    a.contactAAfficher, a.telephoneAAfficher, a.emailAAfficher,
    a.mandatNumero || null, a.mandatType || null,
    now, now, now, now
  );
}

async function runSync(env: Env) {
  const stats = { annoncesInFeed: 0, inserted: 0, updated: 0, closed: 0, photosUploaded: 0, errors: 0, errorDetails: [] as string[] };

  try {
    // 1. Fetch feed
    const annonces = await fetchFeed();
    stats.annoncesInFeed = annonces.length;

    // 2. Upload photos to R2 (these are R2 subrequests, separate from D1 limit)
    const photoMap = new Map<string, string[]>();
    for (const a of annonces) {
      try {
        const urls = await uploadPhotos(env.PHOTOS, a, stats);
        photoMap.set(a.slug, urls);
      } catch (e: any) {
        stats.errors++;
        stats.errorDetails.push(`${a.slug} photos: ${e.message}`);
        photoMap.set(a.slug, a.photos); // fallback to original URLs
      }
    }

    // 3. Batch upsert all annonces (single D1 batch call)
    const now = new Date().toISOString();
    const upsertStmts = annonces.map(a => buildUpsertStmt(env.DB, a, now));

    // D1 batch limit is 500 statements, split if needed
    for (let i = 0; i < upsertStmts.length; i += 100) {
      const batch = upsertStmts.slice(i, i + 100);
      const results = await env.DB.batch(batch);
      for (const r of results) {
        if (r.meta.changes > 0) {
          // changes=1 for both insert and update via ON CONFLICT
          stats.updated++;
        }
      }
    }

    // 4. Get all annonce IDs by slug for photo linking (single batch)
    const feedSlugs = annonces.map(a => a.slug);
    const slugLookups = feedSlugs.map(slug =>
      env.DB.prepare('SELECT id, slug FROM annonces WHERE slug = ?').bind(slug)
    );
    const slugResults = await env.DB.batch(slugLookups);
    const slugToId = new Map<string, number>();
    for (const r of slugResults) {
      const row = (r.results as any[])[0];
      if (row) slugToId.set(row.slug, row.id);
    }

    // 5. Batch delete old photos + insert new ones
    const deleteStmts: D1PreparedStatement[] = [];
    const insertStmts: D1PreparedStatement[] = [];

    for (const a of annonces) {
      const annonceId = slugToId.get(a.slug);
      if (!annonceId) continue;
      const urls = photoMap.get(a.slug) || [];

      deleteStmts.push(
        env.DB.prepare('DELETE FROM annonces_photos WHERE annonce_id = ?').bind(annonceId)
      );
      for (let i = 0; i < urls.length; i++) {
        insertStmts.push(
          env.DB.prepare('INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES (?,?,?,?)')
            .bind(annonceId, urls[i], i, 'r2')
        );
      }
    }

    // Execute photo operations in batches of 100
    const allPhotoStmts = [...deleteStmts, ...insertStmts];
    for (let i = 0; i < allPhotoStmts.length; i += 100) {
      await env.DB.batch(allPhotoStmts.slice(i, i + 100));
    }

    // 6. Close annonces no longer in feed (ubiflow-sourced only)
    const feedSlugSet = new Set(feedSlugs);
    const active = await env.DB
      .prepare("SELECT id, slug FROM annonces WHERE status = 'active' AND source = 'ubiflow'")
      .all<{ id: number; slug: string }>();

    const closeStmts: D1PreparedStatement[] = [];
    for (const row of active.results) {
      if (!feedSlugSet.has(row.slug)) {
        closeStmts.push(
          env.DB.prepare("UPDATE annonces SET status='closed', date_fermeture=?, updated_at=? WHERE id=?")
            .bind(now, now, row.id)
        );
        stats.closed++;
      }
    }
    if (closeStmts.length > 0) {
      for (let i = 0; i < closeStmts.length; i += 100) {
        await env.DB.batch(closeStmts.slice(i, i + 100));
      }
    }

    // 7. Log success
    await env.DB.prepare(
      'INSERT INTO sync_log (annonces_in_feed, inserted, updated, closed, errors, error_details) VALUES (?,?,?,?,?,?)'
    ).bind(stats.annoncesInFeed, stats.inserted, stats.updated, stats.closed, stats.errors,
      stats.errorDetails.length ? JSON.stringify(stats.errorDetails) : null
    ).run();

    console.log('[cron-sync] Done:', JSON.stringify(stats));
  } catch (e: any) {
    try {
      await env.DB.prepare(
        'INSERT INTO sync_log (annonces_in_feed, inserted, updated, closed, errors, error_details) VALUES (0,0,0,0,1,?)'
      ).bind(JSON.stringify([`FATAL: ${e.message}`])).run();
    } catch { /* ignore logging failure */ }
    console.error('[cron-sync] Fatal:', e);
    stats.errors++;
    stats.errorDetails.push(`FATAL: ${e.message}`);
  }

  return stats;
}

// ── LBI zip import (La Boîte Immo) ──
// Reads zip from R2 (lbi/import.zip), extracts Annonces.csv, parses, imports to D1 + R2

const LBI_DELIMITER = '!#';

interface LbiAnnonce {
  reference: string;
  typeAnnonce: 'V' | 'L';
  typeBien: string;
  codePostal: string;
  ville: string;
  prix: number | null;
  surface: number | null;
  surfaceTerrain: number | null;
  nbPieces: number | null;
  nbChambres: number | null;
  nbSallesBain: number | null;
  nbWC: number | null;
  titre: string;
  descriptif: string;
  etage: string | null;
  nbEtages: string | null;
  ascenseur: boolean;
  cave: boolean;
  terrasse: boolean;
  parking: boolean;
  balcon: boolean;
  interphone: boolean;
  contactNom: string | null;
  telephone: string | null;
  email: string | null;
  mandatNumero: string | null;
  dpeValeur: string | null;
  dpeNote: string | null;
  gesValeur: string | null;
  gesNote: string | null;
  photos: string[];
  slug: string;
}

function parseLbiCsv(raw: string): LbiAnnonce[] {
  const lines = raw.trim().split('\n');
  const annonces: LbiAnnonce[] = [];

  for (const line of lines) {
    const f = line.split(LBI_DELIMITER).map(v => v.replace(/^"|"$/g, ''));

    // Collect photo URLs from fields 84-170
    const photos: string[] = [];
    for (let i = 84; i <= 170 && i < f.length; i++) {
      if (f[i] && f[i].startsWith('http')) photos.push(f[i]);
    }

    const a: LbiAnnonce = {
      reference: f[1] || '',
      typeAnnonce: f[2].toLowerCase() === 'vente' ? 'V' : 'L',
      typeBien: f[3] || '',
      codePostal: f[4] || '',
      ville: f[5] || '',
      prix: parseFloat(f[10]) || null,
      surface: parseFloat(f[15]) || null,
      surfaceTerrain: parseFloat(f[16]) || null,
      nbPieces: parseInt(f[17]) || null,
      nbChambres: parseInt(f[18]) || null,
      titre: f[19] || '',
      descriptif: f[20] || '',
      etage: f[23] || null,
      nbEtages: f[24] || null,
      nbSallesBain: parseInt(f[28]) || null,
      nbWC: parseInt(f[30]) || null,
      cave: f[35] === 'OUI',
      terrasse: f[36] === 'OUI',
      parking: !!(f[38] && f[38] !== '0'),
      balcon: f[40] === 'OUI',
      ascenseur: f[41] === 'OUI',
      interphone: f[82] === 'OUI',
      telephone: f[104]?.trim() || null,
      contactNom: f[105]?.trim() || null,
      email: f[106]?.trim() || null,
      mandatNumero: f[111]?.trim() || null,
      dpeValeur: f[175]?.trim() || null,
      dpeNote: f[176]?.trim() || null,
      gesValeur: f[177]?.trim() || null,
      gesNote: f[178]?.trim() || null,
      photos,
      slug: '',
    };

    // Generate slug (same pattern as ubiflow)
    const parts: string[] = [];
    if (a.reference) parts.push(a.reference.toLowerCase());
    if (a.codePostal) parts.push(a.codePostal);
    if (a.ville) parts.push(a.ville);
    a.slug = parts
      .join(' ')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 120);

    annonces.push(a);
  }

  return annonces;
}

async function uploadLbiPhotos(
  bucket: R2Bucket,
  a: LbiAnnonce,
  stats: { photosUploaded: number; photosSkipped: number }
): Promise<string[]> {
  const r2Keys: string[] = [];
  for (let i = 0; i < a.photos.length; i++) {
    const key = `annonces/${a.slug}/${i}.jpg`;
    try {
      const head = await bucket.head(key);
      if (head) {
        r2Keys.push(key);
        stats.photosSkipped++;
        continue;
      }
      const resp = await fetch(a.photos[i]);
      if (!resp.ok) { r2Keys.push(a.photos[i]); continue; }
      const blob = await resp.arrayBuffer();
      await bucket.put(key, blob, {
        httpMetadata: { contentType: resp.headers.get('content-type') || 'image/jpeg' },
      });
      r2Keys.push(key);
      stats.photosUploaded++;
    } catch {
      r2Keys.push(a.photos[i]); // fallback to external URL
    }
  }
  return r2Keys;
}

function buildLbiUpsertStmt(db: D1Database, a: LbiAnnonce, now: string): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO annonces (
      slug, status, reference_agence,
      type_annonce, type_bien,
      code_postal, ville,
      prix,
      surface, surface_terrain,
      nb_pieces, nb_chambres, nb_salles_bain, nb_wc,
      etage, nb_etages, ascenseur, cave, terrasse,
      parking, interphone, balcon,
      dpe_note, dpe_valeur, ges_note, ges_valeur,
      titre, descriptif,
      contact_a_afficher, telephone_a_afficher, email_a_afficher,
      mandat_numero,
      date_creation, date_modification, source, created_at, updated_at
    ) VALUES (
      ?,'active',?, ?,?, ?,?, ?, ?,?, ?,?,?,?, ?,?,?,?,?, ?,?,?, ?,?,?,?, ?,?, ?,?,?, ?, ?,?,'lbi',?,?
    )
    ON CONFLICT(slug) DO UPDATE SET
      status='active', reference_agence=excluded.reference_agence,
      type_annonce=excluded.type_annonce, type_bien=excluded.type_bien,
      code_postal=excluded.code_postal, ville=excluded.ville,
      prix=excluded.prix,
      surface=excluded.surface, surface_terrain=excluded.surface_terrain,
      nb_pieces=excluded.nb_pieces, nb_chambres=excluded.nb_chambres,
      nb_salles_bain=excluded.nb_salles_bain, nb_wc=excluded.nb_wc,
      etage=excluded.etage, nb_etages=excluded.nb_etages,
      ascenseur=excluded.ascenseur, cave=excluded.cave, terrasse=excluded.terrasse,
      parking=excluded.parking, interphone=excluded.interphone, balcon=excluded.balcon,
      dpe_note=excluded.dpe_note, dpe_valeur=excluded.dpe_valeur,
      ges_note=excluded.ges_note, ges_valeur=excluded.ges_valeur,
      titre=excluded.titre, descriptif=excluded.descriptif,
      contact_a_afficher=excluded.contact_a_afficher,
      telephone_a_afficher=excluded.telephone_a_afficher,
      email_a_afficher=excluded.email_a_afficher,
      mandat_numero=excluded.mandat_numero,
      date_modification=excluded.date_modification, source='lbi',
      date_fermeture=NULL, updated_at=excluded.updated_at`
  ).bind(
    a.slug, a.reference, a.typeAnnonce, a.typeBien,
    a.codePostal, a.ville,
    a.prix,
    a.surface, a.surfaceTerrain,
    a.nbPieces, a.nbChambres, a.nbSallesBain, a.nbWC,
    a.etage, a.nbEtages,
    a.ascenseur ? 1 : 0, a.cave ? 1 : 0, a.terrasse ? 1 : 0,
    a.parking ? '1' : null, a.interphone ? 1 : 0, a.balcon ? 1 : 0,
    a.dpeNote, a.dpeValeur, a.gesNote, a.gesValeur,
    a.titre, a.descriptif,
    a.contactNom, a.telephone, a.email,
    a.mandatNumero,
    now, now, now, now
  );
}

async function runLbiImport(env: Env) {
  const stats = {
    annoncesInZip: 0, upserted: 0, photosUploaded: 0, photosSkipped: 0,
    errors: 0, errorDetails: [] as string[],
  };

  try {
    // 1. Read zip from R2
    const zipObj = await env.PHOTOS.get('lbi/import.zip');
    if (!zipObj) {
      return { error: 'No zip found at lbi/import.zip in R2. Upload first with: wrangler r2 object put pujol-photos/lbi/import.zip --file=1_immopujol.zip' };
    }
    const zipBuffer = await zipObj.arrayBuffer();

    // 2. Extract Annonces.csv from zip
    const unzipped = unzipSync(new Uint8Array(zipBuffer));
    const csvBytes = unzipped['Annonces.csv'];
    if (!csvBytes) {
      return { error: 'Annonces.csv not found in zip. Files found: ' + Object.keys(unzipped).join(', ') };
    }

    // Decode as latin1 (LBI uses ISO-8859-1)
    const csvText = new TextDecoder('iso-8859-1').decode(csvBytes);
    const annonces = parseLbiCsv(csvText);
    stats.annoncesInZip = annonces.length;
    console.log(`[lbi-import] Found ${annonces.length} annonces in zip`);

    // 3. Upload photos to R2
    const photoMap = new Map<string, string[]>();
    for (const a of annonces) {
      try {
        const keys = await uploadLbiPhotos(env.PHOTOS, a, stats);
        photoMap.set(a.slug, keys);
        console.log(`[lbi-import] ${a.reference}: ${keys.length} photos`);
      } catch (e: any) {
        stats.errors++;
        stats.errorDetails.push(`${a.slug} photos: ${e.message}`);
        photoMap.set(a.slug, a.photos);
      }
    }

    // 4. Batch upsert annonces into D1
    const now = new Date().toISOString();
    const upsertStmts = annonces.map(a => buildLbiUpsertStmt(env.DB, a, now));
    for (let i = 0; i < upsertStmts.length; i += 100) {
      const results = await env.DB.batch(upsertStmts.slice(i, i + 100));
      for (const r of results) {
        if (r.meta.changes > 0) stats.upserted++;
      }
    }

    // 5. Link photos — get IDs, delete old, insert new
    const slugLookups = annonces.map(a =>
      env.DB.prepare('SELECT id, slug FROM annonces WHERE slug = ?').bind(a.slug)
    );
    const slugResults = await env.DB.batch(slugLookups);
    const slugToId = new Map<string, number>();
    for (const r of slugResults) {
      const row = (r.results as any[])[0];
      if (row) slugToId.set(row.slug, row.id);
    }

    const photoStmts: D1PreparedStatement[] = [];
    for (const a of annonces) {
      const annonceId = slugToId.get(a.slug);
      if (!annonceId) continue;
      const keys = photoMap.get(a.slug) || [];
      photoStmts.push(
        env.DB.prepare('DELETE FROM annonces_photos WHERE annonce_id = ?').bind(annonceId)
      );
      for (let i = 0; i < keys.length; i++) {
        photoStmts.push(
          env.DB.prepare('INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES (?,?,?,?)')
            .bind(annonceId, keys[i], i, 'r2')
        );
      }
    }
    for (let i = 0; i < photoStmts.length; i += 100) {
      await env.DB.batch(photoStmts.slice(i, i + 100));
    }

    console.log('[lbi-import] Done:', JSON.stringify(stats));
  } catch (e: any) {
    stats.errors++;
    stats.errorDetails.push(`FATAL: ${e.message}`);
    console.error('[lbi-import] Fatal:', e);
  }

  return stats;
}

// ── Write active.json snapshot to R2 ──
// Listing pages (prerendered) fetch this JSON at build time instead of querying D1.

const R2_PUBLIC = 'https://pub-a37eed540afe4dc9b4479da74ba265e1.r2.dev';

function resolvePhotoUrl(url: string): string {
  return url.startsWith('http') ? url : `${R2_PUBLIC}/${url}`;
}

async function writeActiveJson(env: Env): Promise<number> {
  const annonces = await env.DB
    .prepare("SELECT * FROM annonces WHERE status = 'active' ORDER BY date_creation DESC")
    .all<Record<string, any>>();

  if (annonces.results.length === 0) {
    await env.PHOTOS.put('annonces/active.json', '[]', {
      httpMetadata: { contentType: 'application/json' },
    });
    return 0;
  }

  const ids = annonces.results.map(a => a.id as number);
  const photoMap = new Map<number, string[]>();
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const photos = await env.DB
      .prepare(
        `SELECT annonce_id, url, position FROM annonces_photos
         WHERE annonce_id IN (${batch.map(() => '?').join(',')})
         ORDER BY position ASC`
      )
      .bind(...batch)
      .all<{ annonce_id: number; url: string; position: number }>();
    for (const p of photos.results) {
      const list = photoMap.get(p.annonce_id) || [];
      list.push(resolvePhotoUrl(p.url));
      photoMap.set(p.annonce_id, list);
    }
  }

  const json = annonces.results.map(a => ({
    id: String(a.id),
    reference: a.reference_agence || a.ubiflow_reference || '',
    titre: a.titre || '',
    description: a.descriptif || '',
    dateSaisie: '',
    contactAAfficher: a.contact_a_afficher || '',
    emailAAfficher: a.email_a_afficher || '',
    telephoneAAfficher: a.telephone_a_afficher || '',
    type: (a.type_annonce || 'L') as 'V' | 'L',
    prix: a.prix ?? null,
    prixHorsHonoraires: null,
    loyer: null,
    loyerCC: a.loyer_cc ?? null,
    charges: a.charges ?? null,
    depotGarantie: a.depot_garantie ?? null,
    honorairesChargeAcquereur: false,
    devise: 'EUR',
    libelleType: a.type_bien || '',
    codePostal: a.code_postal || '',
    adresse: a.adresse || '',
    ville: a.ville || '',
    quartier: a.quartier || '',
    latitude: a.latitude ?? null,
    longitude: a.longitude ?? null,
    surface: a.surface ?? null,
    surfaceHabitable: null,
    surfaceTerrain: a.surface_terrain ?? null,
    surfaceTerrasse: null,
    nbPieces: a.nb_pieces ?? null,
    nbChambres: a.nb_chambres ?? null,
    nbSallesDeBain: a.nb_salles_bain ?? null,
    nbWC: a.nb_wc ?? null,
    etage: a.etage || '',
    nbEtages: a.nb_etages || '',
    exposition: '',
    cuisine: '',
    typeChauffage: a.type_chauffage || '',
    chauffageEnergie: '',
    ascenseur: !!a.ascenseur,
    terrasse: !!a.terrasse,
    balcon: false,
    garage: !!a.garage,
    parking: !!a.parking,
    cave: !!a.cave,
    interphone: !!a.interphone,
    copropriete: false,
    chargesCopropriete: null,
    alurNbLots: null,
    anneeConstruction: '',
    vueSurMer: false,
    dpeValeurConso: a.dpe_valeur || '',
    dpeEtiquetteConso: a.dpe_note || '',
    dpeEtiquetteGes: a.ges_note || '',
    dpeEstimationMin: '',
    dpeEstimationMax: '',
    dpeValeurGes: a.ges_valeur || '',
    photos: photoMap.get(a.id as number) || [],
    visiteVirtuelle: a.url_visite_virtuelle || '',
    mandatNumero: a.mandat_numero || '',
    mandatType: a.mandat_type || '',
    slug: a.slug || '',
    meuble: !!a.meuble,
  }));

  await env.PHOTOS.put('annonces/active.json', JSON.stringify(json), {
    httpMetadata: { contentType: 'application/json' },
  });

  // Slim version with only card-rendering fields (~80% smaller)
  const cards = json.map(a => ({
    type: a.type, slug: a.slug, titre: a.titre, libelleType: a.libelleType,
    prix: a.prix, loyerCC: a.loyerCC, loyer: a.loyer,
    depotGarantie: a.depotGarantie, surface: a.surface,
    nbPieces: a.nbPieces, nbChambres: a.nbChambres,
    codePostal: a.codePostal, ville: a.ville, quartier: a.quartier,
    photos: a.photos.slice(0, 4),
    meuble: a.meuble, parking: a.parking, garage: a.garage,
    terrasse: a.terrasse, balcon: a.balcon,
  }));
  await env.PHOTOS.put('annonces/cards.json', JSON.stringify(cards), {
    httpMetadata: { contentType: 'application/json' },
  });

  console.log(`[cron-sync] Wrote active.json + cards.json with ${json.length} annonces`);
  return json.length;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Manual trigger: GET /sync
    if (url.pathname === '/sync') {
      const stats = await runSync(env);
      const jsonCount = await writeActiveJson(env);
      return new Response(JSON.stringify({ ...stats, activeJsonWritten: jsonCount }, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Status: GET /status — show recent sync logs
    if (url.pathname === '/status') {
      const logs = await env.DB
        .prepare('SELECT * FROM sync_log ORDER BY id DESC LIMIT 10')
        .all();
      return new Response(JSON.stringify(logs.results, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // LBI zip import: GET /import-lbi
    if (url.pathname === '/import-lbi') {
      const result = await runLbiImport(env);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('pujol-cron-sync: /sync, /status, /import-lbi', { status: 200 });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      let changed = false;

      // 1. Ubiflow XML sync
      const stats = await runSync(env);
      if (stats.inserted > 0 || stats.closed > 0) changed = true;

      // 2. LBI zip import (if zip exists in R2)
      try {
        const lbiResult = await runLbiImport(env);
        if ('error' in lbiResult) {
          console.log(`[cron-sync] LBI skipped: ${lbiResult.error}`);
        } else if (lbiResult.upserted > 0) {
          console.log(`[cron-sync] LBI imported ${lbiResult.upserted} annonces`);
          changed = true;
        }
      } catch (e: any) {
        console.error(`[cron-sync] LBI import error: ${e.message}`);
      }

      // 3. Write active.json snapshot to R2 (always, so listing pages stay fresh)
      try {
        await writeActiveJson(env);
      } catch (e: any) {
        console.error(`[cron-sync] Failed to write active.json: ${e.message}`);
      }

      // 4. Trigger redeploy only if something changed
      if (changed) {
        console.log('[cron-sync] Changes detected, triggering redeploy');
        await triggerRedeploy(env);
      } else {
        console.log('[cron-sync] No listing changes, skipping redeploy');
      }
    })());
  },
};
