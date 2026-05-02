// Ubiflow → D1 + R2 sync worker
// Called by Cron Trigger (hourly) or manually via /api/sync endpoint

import { fetchUbiflowAnnonces, type UbiflowAnnonce } from './ubiflow';

interface SyncEnv {
  DB: D1Database;
  PHOTOS: R2Bucket;
}

interface SyncResult {
  annoncesInFeed: number;
  inserted: number;
  updated: number;
  closed: number;
  photosUploaded: number;
  errors: number;
  errorDetails: string[];
}

/**
 * Upsert a single annonce into D1 and upload its photos to R2.
 */
async function upsertAnnonce(
  db: D1Database,
  photos: R2Bucket,
  annonce: UbiflowAnnonce,
  result: SyncResult,
): Promise<void> {
  const now = new Date().toISOString();

  // Check if annonce already exists
  const existing = await db
    .prepare('SELECT id, status FROM annonces WHERE slug = ?')
    .bind(annonce.slug)
    .first<{ id: number; status: string }>();

  // Upload photos to R2, build new URL list
  const r2PhotoUrls: string[] = [];
  for (let i = 0; i < annonce.photos.length; i++) {
    const photoUrl = annonce.photos[i];
    const r2Key = `annonces/${annonce.slug}/${i}.jpg`;

    try {
      // Check if already in R2
      const head = await photos.head(r2Key);
      if (head) {
        r2PhotoUrls.push(r2Key);
        continue;
      }

      // Download and upload to R2
      const resp = await fetch(photoUrl);
      if (!resp.ok) {
        r2PhotoUrls.push(photoUrl); // Keep original URL as fallback
        continue;
      }
      const blob = await resp.arrayBuffer();
      await photos.put(r2Key, blob, {
        httpMetadata: { contentType: resp.headers.get('content-type') || 'image/jpeg' },
      });
      r2PhotoUrls.push(r2Key);
      result.photosUploaded++;
    } catch (e) {
      // Keep original URL on failure
      r2PhotoUrls.push(photoUrl);
    }
  }

  if (existing) {
    // Update existing annonce
    await db
      .prepare(
        `UPDATE annonces SET
          status = 'active',
          ubiflow_annonce_id = ?, ubiflow_reference = ?,
          type_annonce = ?, type_bien = ?,
          adresse = ?, code_postal = ?, ville = ?, quartier = ?,
          latitude = ?, longitude = ?,
          prix = ?, loyer_cc = ?, charges = ?, depot_garantie = ?,
          honoraires = ?,
          surface = ?, surface_terrain = ?,
          nb_pieces = ?, nb_chambres = ?, nb_salles_bain = ?, nb_wc = ?,
          etage = ?, nb_etages = ?,
          ascenseur = ?, cave = ?, terrasse = ?, parking = ?, garage = ?,
          interphone = ?,
          dpe_note = ?, dpe_valeur = ?, ges_note = ?,
          type_chauffage = ?,
          titre = ?, descriptif = ?,
          contact_a_afficher = ?, telephone_a_afficher = ?, email_a_afficher = ?,
          mandat_numero = ?, mandat_type = ?,
          date_modification = ?, source = 'ubiflow',
          date_fermeture = NULL,
          updated_at = ?
        WHERE id = ?`,
      )
      .bind(
        annonce.id, annonce.reference,
        annonce.type, annonce.libelleType,
        annonce.adresse, annonce.codePostal, annonce.ville, annonce.quartier,
        annonce.latitude, annonce.longitude,
        annonce.prix, annonce.loyerCC, annonce.charges, annonce.depotGarantie,
        annonce.honorairesChargeAcquereur ? 'Charge acquéreur' : null,
        annonce.surface, annonce.surfaceTerrain,
        annonce.nbPieces, annonce.nbChambres, annonce.nbSallesDeBain, annonce.nbWC,
        annonce.etage || null, annonce.nbEtages || null,
        annonce.ascenseur ? 1 : 0, annonce.cave ? 1 : 0,
        annonce.terrasse ? 1 : 0, annonce.parking ? '1' : null,
        annonce.garage ? '1' : null, annonce.interphone ? 1 : 0,
        annonce.dpeEtiquetteConso || null, annonce.dpeValeurConso || null,
        annonce.dpeEtiquetteGes || null,
        annonce.typeChauffage || null,
        annonce.titre, annonce.description,
        annonce.contactAAfficher, annonce.telephoneAAfficher, annonce.emailAAfficher,
        annonce.mandatNumero || null, annonce.mandatType || null,
        now, now,
        existing.id,
      )
      .run();

    // Replace photos
    await db.prepare('DELETE FROM annonces_photos WHERE annonce_id = ?').bind(existing.id).run();
    for (let i = 0; i < r2PhotoUrls.length; i++) {
      await db
        .prepare('INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES (?, ?, ?, ?)')
        .bind(existing.id, r2PhotoUrls[i], i, 'r2')
        .run();
    }

    result.updated++;
  } else {
    // Insert new annonce
    const insert = await db
      .prepare(
        `INSERT INTO annonces (
          slug, status,
          ubiflow_annonce_id, ubiflow_reference,
          type_annonce, type_bien,
          adresse, code_postal, ville, quartier,
          latitude, longitude,
          prix, loyer_cc, charges, depot_garantie,
          honoraires,
          surface, surface_terrain,
          nb_pieces, nb_chambres, nb_salles_bain, nb_wc,
          etage, nb_etages,
          ascenseur, cave, terrasse, parking, garage,
          interphone,
          dpe_note, dpe_valeur, ges_note,
          type_chauffage,
          titre, descriptif,
          contact_a_afficher, telephone_a_afficher, email_a_afficher,
          mandat_numero, mandat_type,
          date_creation, date_modification, source,
          created_at, updated_at
        ) VALUES (
          ?, 'active',
          ?, ?,
          ?, ?,
          ?, ?, ?, ?,
          ?, ?,
          ?, ?, ?, ?,
          ?,
          ?, ?,
          ?, ?, ?, ?,
          ?, ?,
          ?, ?, ?, ?, ?,
          ?,
          ?, ?, ?,
          ?,
          ?, ?,
          ?, ?, ?,
          ?, ?,
          ?, ?, 'ubiflow',
          ?, ?
        )`,
      )
      .bind(
        annonce.slug,
        annonce.id, annonce.reference,
        annonce.type, annonce.libelleType,
        annonce.adresse, annonce.codePostal, annonce.ville, annonce.quartier,
        annonce.latitude, annonce.longitude,
        annonce.prix, annonce.loyerCC, annonce.charges, annonce.depotGarantie,
        annonce.honorairesChargeAcquereur ? 'Charge acquéreur' : null,
        annonce.surface, annonce.surfaceTerrain,
        annonce.nbPieces, annonce.nbChambres, annonce.nbSallesDeBain, annonce.nbWC,
        annonce.etage || null, annonce.nbEtages || null,
        annonce.ascenseur ? 1 : 0, annonce.cave ? 1 : 0,
        annonce.terrasse ? 1 : 0, annonce.parking ? '1' : null,
        annonce.garage ? '1' : null, annonce.interphone ? 1 : 0,
        annonce.dpeEtiquetteConso || null, annonce.dpeValeurConso || null,
        annonce.dpeEtiquetteGes || null,
        annonce.typeChauffage || null,
        annonce.titre, annonce.description,
        annonce.contactAAfficher, annonce.telephoneAAfficher, annonce.emailAAfficher,
        annonce.mandatNumero || null, annonce.mandatType || null,
        now, now,
        now, now,
      )
      .run();

    const annonceId = insert.meta.last_row_id;
    for (let i = 0; i < r2PhotoUrls.length; i++) {
      await db
        .prepare('INSERT INTO annonces_photos (annonce_id, url, position, source) VALUES (?, ?, ?, ?)')
        .bind(annonceId, r2PhotoUrls[i], i, 'r2')
        .run();
    }

    result.inserted++;
  }
}

/**
 * Main sync function. Fetches Ubiflow feed, upserts all annonces to D1,
 * and marks annonces no longer in the feed as 'closed'.
 */
export async function syncAnnonces(env: SyncEnv): Promise<SyncResult> {
  const result: SyncResult = {
    annoncesInFeed: 0,
    inserted: 0,
    updated: 0,
    closed: 0,
    photosUploaded: 0,
    errors: 0,
    errorDetails: [],
  };

  // 1. Fetch feed
  const annonces = await fetchUbiflowAnnonces();
  result.annoncesInFeed = annonces.length;

  // 2. Upsert each annonce
  const feedSlugs = new Set<string>();
  for (const annonce of annonces) {
    feedSlugs.add(annonce.slug);
    try {
      await upsertAnnonce(env.DB, env.PHOTOS, annonce, result);
    } catch (e: any) {
      result.errors++;
      result.errorDetails.push(`${annonce.slug}: ${e.message}`);
    }
  }

  // 3. Close annonces that are no longer in the feed
  //    Only close annonces sourced from ubiflow that are currently active
  const activeUbiflow = await env.DB
    .prepare("SELECT id, slug FROM annonces WHERE status = 'active' AND source = 'ubiflow'")
    .all<{ id: number; slug: string }>();

  const now = new Date().toISOString();
  for (const row of activeUbiflow.results) {
    if (!feedSlugs.has(row.slug)) {
      await env.DB
        .prepare("UPDATE annonces SET status = 'closed', date_fermeture = ?, updated_at = ? WHERE id = ?")
        .bind(now, now, row.id)
        .run();
      result.closed++;
    }
  }

  // 4. Log sync
  await env.DB
    .prepare(
      `INSERT INTO sync_log (annonces_in_feed, inserted, updated, closed, errors, error_details)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      result.annoncesInFeed,
      result.inserted,
      result.updated,
      result.closed,
      result.errors,
      result.errorDetails.length ? JSON.stringify(result.errorDetails) : null,
    )
    .run();

  return result;
}
