// D1 query layer for annonces
// Replaces fetchUbiflowAnnonces() (live XML) and getClosedAnnonce() (static JSON)

const R2_PUBLIC = 'https://pub-a37eed540afe4dc9b4479da74ba265e1.r2.dev';

/** Relative paths (from Ubiflow/R2 sync) need the R2 base URL; full URLs are kept as-is. */
function resolvePhotoUrl(url: string): string {
  return url.startsWith('http') ? url : `${R2_PUBLIC}/${url}`;
}

export interface DbAnnonce {
  id: number;
  slug: string;
  status: string;
  type_annonce: string;
  type_bien: string;
  titre: string;
  descriptif: string;
  reference_agence: string;
  ubiflow_reference: string;
  adresse: string;
  code_postal: string;
  ville: string;
  quartier: string;
  latitude: number | null;
  longitude: number | null;
  prix: number | null;
  loyer_cc: number | null;
  loyer_ht: number | null;
  charges: number | null;
  depot_garantie: number | null;
  honoraires: string | null;
  honoraires_etat_des_lieux: number | null;
  surface: number | null;
  surface_terrain: number | null;
  nb_pieces: number | null;
  nb_chambres: number | null;
  nb_salles_bain: number | null;
  nb_wc: number | null;
  etage: string | null;
  nb_etages: string | null;
  meuble: number;
  ascenseur: number;
  cave: number;
  terrasse: number;
  parking: string | null;
  garage: string | null;
  interphone: number;
  url_visite_virtuelle: string | null;
  dpe_note: string | null;
  dpe_valeur: string | null;
  ges_note: string | null;
  ges_valeur: string | null;
  type_chauffage: string | null;
  contact_a_afficher: string | null;
  telephone_a_afficher: string | null;
  email_a_afficher: string | null;
  mandat_numero: string | null;
  mandat_type: string | null;
  source: string;
  date_fermeture: string | null;
}

export interface DbPhoto {
  url: string;
  position: number;
  source: string;
}

/**
 * Get all active annonces (replaces fetchUbiflowAnnonces)
 */
export async function getActiveAnnonces(db: D1Database): Promise<(DbAnnonce & { photos: string[] })[]> {
  const annonces = await db
    .prepare("SELECT * FROM annonces WHERE status = 'active' ORDER BY date_creation DESC")
    .all<DbAnnonce>();

  // Batch-load photos for all active annonces
  const ids = annonces.results.map(a => a.id);
  if (ids.length === 0) return [];

  const photosResult = await db
    .prepare(
      `SELECT annonce_id, url, position FROM annonces_photos
       WHERE annonce_id IN (${ids.map(() => '?').join(',')})
       ORDER BY position ASC`,
    )
    .bind(...ids)
    .all<{ annonce_id: number; url: string; position: number }>();

  // Group photos by annonce_id
  const photoMap = new Map<number, string[]>();
  for (const p of photosResult.results) {
    const list = photoMap.get(p.annonce_id) || [];
    list.push(resolvePhotoUrl(p.url));
    photoMap.set(p.annonce_id, list);
  }

  return annonces.results.map(a => ({
    ...a,
    photos: photoMap.get(a.id) || [],
  }));
}

/**
 * Get a single annonce by slug (active or closed)
 */
export async function getAnnonceBySlug(
  db: D1Database,
  slug: string,
): Promise<(DbAnnonce & { photos: string[] }) | null> {
  const annonce = await db
    .prepare('SELECT * FROM annonces WHERE slug = ?')
    .bind(slug)
    .first<DbAnnonce>();

  if (!annonce) return null;

  const photos = await db
    .prepare('SELECT url, position FROM annonces_photos WHERE annonce_id = ? ORDER BY position ASC')
    .bind(annonce.id)
    .all<{ url: string; position: number }>();

  return {
    ...annonce,
    photos: photos.results.map(p => resolvePhotoUrl(p.url)),
  };
}

/**
 * Get related annonces (same arrondissement/code_postal, active, different slug)
 */
export async function getRelatedAnnonces(
  db: D1Database,
  codePostal: string,
  excludeSlug: string,
  limit = 5,
): Promise<{ slug: string; titre: string; prix: number | null; type_annonce: string; code_postal: string }[]> {
  const results = await db
    .prepare(
      `SELECT slug, titre, prix, type_annonce, code_postal
       FROM annonces
       WHERE code_postal = ? AND slug != ? AND status = 'active'
       ORDER BY date_creation DESC
       LIMIT ?`,
    )
    .bind(codePostal, excludeSlug, limit)
    .all<{ slug: string; titre: string; prix: number | null; type_annonce: string; code_postal: string }>();

  return results.results;
}

/**
 * Get a small pool of similar active annonces with photos for "Biens similaires".
 * Prefers same type + code_postal, falls back to any active annonce.
 */
export async function getSimilarPool(
  db: D1Database,
  excludeSlug: string,
  type: string,
  codePostal: string | null,
  limit = 6,
): Promise<(DbAnnonce & { photos: string[] })[]> {
  const annonces = await db
    .prepare(
      `SELECT * FROM annonces
       WHERE slug != ? AND status = 'active'
       ORDER BY
         CASE WHEN type_annonce = ? THEN 0 ELSE 1 END,
         CASE WHEN code_postal = ? THEN 0 ELSE 1 END,
         date_creation DESC
       LIMIT ?`,
    )
    .bind(excludeSlug, type, codePostal || '', limit)
    .all<DbAnnonce>();

  const ids = annonces.results.map(a => a.id);
  if (ids.length === 0) return [];

  const photosResult = await db
    .prepare(
      `SELECT annonce_id, url, position FROM annonces_photos
       WHERE annonce_id IN (${ids.map(() => '?').join(',')})
       ORDER BY position ASC`,
    )
    .bind(...ids)
    .all<{ annonce_id: number; url: string; position: number }>();

  const photoMap = new Map<number, string[]>();
  for (const p of photosResult.results) {
    const list = photoMap.get(p.annonce_id) || [];
    list.push(resolvePhotoUrl(p.url));
    photoMap.set(p.annonce_id, list);
  }

  return annonces.results.map(a => ({
    ...a,
    photos: photoMap.get(a.id) || [],
  }));
}

/**
 * Scan a description for the first virtual-tour URL we recognise.
 * Used as a fallback when `url_visite_virtuelle` isn't populated — agents
 * frequently paste the tour link directly into the descriptif text.
 */
export function extractTourUrl(description: string | null | undefined): string {
  if (!description) return '';
  const patterns = [
    /https?:\/\/(?:www\.|my\.)?matterport\.com\/show\/\?[^\s<>"'|]+/i,
    /https?:\/\/(?:[^\s<>"'|/]+\.)?previsite\.com\/[^\s<>"'|]+/i,
    /https?:\/\/youtu\.be\/[^\s<>"'|]+/i,
    /https?:\/\/(?:www\.)?youtube\.com\/(?:watch\?[^\s<>"'|]*v=[A-Za-z0-9_-]+[^\s<>"'|]*|embed\/[A-Za-z0-9_-]+[^\s<>"'|]*)/i,
    /https?:\/\/(?:www\.|player\.)?vimeo\.com\/[^\s<>"'|]+/i,
  ];
  for (const re of patterns) {
    const m = description.match(re);
    if (m) return m[0].replace(/[.,;:)]+$/, ''); // strip trailing punctuation
  }
  return '';
}

/**
 * Format price for display (mirrors ubiflow.ts formatPrice)
 */
export function formatDbPrice(a: DbAnnonce): string {
  const fmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  if (a.type_annonce === 'V' && a.prix) {
    return fmt.format(a.prix);
  }
  if (a.type_annonce === 'L') {
    const loyer = a.loyer_cc ?? a.prix;
    if (loyer) return fmt.format(loyer) + '/mois';
  }
  return 'Prix sur demande';
}
