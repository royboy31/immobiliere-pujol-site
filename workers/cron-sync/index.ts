// Cron worker — runs hourly, syncs Ubiflow feed → D1 + R2
// Deployed as a separate worker alongside the main Astro site

import { XMLParser } from 'fast-xml-parser';

const UBIFLOW_URL =
  'https://sw.ubiflow.net/diffusion-annonces.php?MDP_PARTENAIRE=55a6fc447c0ac5c3840087406768fbc760671110&DIFFUSEUR=IMMOBILIERE_PUJOL&ANNONCEUR=ag132582';

interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
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
  const diagnostics = raw.diagnostics || {};
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
      dpe_note, dpe_valeur, ges_note, type_chauffage,
      titre, descriptif,
      contact_a_afficher, telephone_a_afficher, email_a_afficher,
      mandat_numero, mandat_type,
      date_creation, date_modification, source, created_at, updated_at
    ) VALUES (
      ?,'active',?,?, ?,?, ?,?,?,?,?,?, ?,?,?,?,?, ?,?, ?,?,?,?, ?,?,?,?,?, ?,?,?, ?,?,?,?, ?,?, ?,?,?, ?,?, ?,?,'ubiflow',?,?
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
      ges_note=excluded.ges_note, type_chauffage=excluded.type_chauffage,
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
    a.honorairesChargeAcquereur ? 'Charge acquéreur' : null,
    a.surface, a.surfaceTerrain,
    a.nbPieces, a.nbChambres, a.nbSallesDeBain, a.nbWC,
    a.etage || null, a.nbEtages || null,
    a.ascenseur ? 1 : 0, a.cave ? 1 : 0, a.terrasse ? 1 : 0,
    a.parking ? '1' : null, a.garage ? '1' : null, a.interphone ? 1 : 0,
    a.dpeEtiquetteConso || null, a.dpeValeurConso || null, a.dpeEtiquetteGes || null,
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Manual trigger: GET /sync
    if (url.pathname === '/sync') {
      const stats = await runSync(env);
      return new Response(JSON.stringify(stats, null, 2), {
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

    return new Response('pujol-cron-sync: /sync to trigger, /status to check logs', { status: 200 });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runSync(env));
  },
};
