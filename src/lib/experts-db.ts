// D1-backed expert profiles: the runtime source of truth for the expert editor.
// Mirrors the blog-article backend (src/lib/blog-db.ts). At build time these rows
// will be synced into src/content/experts/*.json (deferred — see BLOG-EDITOR-
// PROGRESS.md), which the existing /experts/ pages + lib/experts.ts consume. The
// admin reads/writes here directly. Only ever touches the isolated `experts`
// table — never annonces or any pre-existing table.

export interface ExpertRecord {
  id: number;
  slug: string;
  title: string;                 // "Prénom Nom – Rôle" (display name is derived from this)
  fonction: string;              // short tagline, e.g. "La patronne"
  description: string;           // HTML bio
  photo: string;
  phone: string;
  email: string;
  email_aliases: string[];       // extra emails that resolve to this expert (feed matching)
  linkedin: string;
  facebook: string;
  instagram: string;
  seo_title: string;
  seo_description: string;
  department: string;            // '' | Direction | Vente | Gestion locative | Syndic | Contentieux
  sort_order: number | null;     // manual position within a department (lower first)
  agenda: string;                // Google Calendar appointment URL
  secteur: string;               // covered zone, e.g. "Marseille Est & Nord : 13011, 13012"
  hidden: boolean;               // keep the detail page but drop from the /experts/ listing
  listing_only: boolean;         // photo-only on listings; no page, excluded from /experts/
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type ExpertInput = Partial<Omit<ExpertRecord, 'id' | 'created_at' | 'updated_at'>>;

/** Get the D1 binding from the Worker runtime (works in `astro dev` too). */
export async function getDB(): Promise<D1Database> {
  const { env } = await import('cloudflare:workers');
  const db = (env as any).DB as D1Database;
  if (!db) throw new Error('D1 binding "DB" is not available');
  return db;
}

// Fresh-DB schema. `sort_order` (not `order` — reserved word). Existing DBs are
// upgraded additively by the migration below.
const SCHEMA = `CREATE TABLE IF NOT EXISTS experts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  fonction TEXT,
  description TEXT,
  photo TEXT,
  phone TEXT,
  email TEXT,
  email_aliases TEXT,
  linkedin TEXT,
  facebook TEXT,
  instagram TEXT,
  seo_title TEXT,
  seo_description TEXT,
  department TEXT,
  sort_order INTEGER,
  agenda TEXT,
  secteur TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  listing_only INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT,
  published_json TEXT
)`;

// Columns added after the first schema — applied to pre-existing tables so the
// same code upgrades an old local (or staging) DB without dropping data.
const ADD_COLUMNS: Record<string, string> = {
  email_aliases: 'TEXT',
  agenda: 'TEXT',
  secteur: 'TEXT',
  sort_order: 'INTEGER',
  listing_only: 'INTEGER NOT NULL DEFAULT 0',
  // Frozen snapshot of the last explicitly-published state (see blog-db.ts). The
  // build-time sync reads published_json only; set by publishExperts() ("Publier").
  published_at: 'TEXT',
  published_json: 'TEXT',
};

let schemaReady = false;

/** Idempotent: creates the table if missing, migrates missing columns, and seeds
 *  the real expert profiles into an empty DB when SEED_DEMO=1 (local only). */
export async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;
  await db.prepare(SCHEMA).run();
  const info = await db.prepare('PRAGMA table_info(experts)').all();
  const existing = new Set((info.results || []).map((r: any) => r.name));
  for (const [col, def] of Object.entries(ADD_COLUMNS)) {
    if (!existing.has(col)) await db.prepare(`ALTER TABLE experts ADD COLUMN ${col} ${def}`).run();
  }
  let allowSeed = false;
  try { allowSeed = (await import('cloudflare:workers')).env?.SEED_DEMO === '1'; } catch { /* not in worker ctx */ }
  if (allowSeed) {
    const { count } = (await db.prepare('SELECT COUNT(*) AS count FROM experts').first<{ count: number }>()) || { count: 0 };
    if (!count) await seedFromContent(db);
  }
  schemaReady = true;
}

// Seed the real 27 profiles from src/content/experts/*.json into an empty LOCAL
// DB so the editor opens with production data. Gated by SEED_DEMO=1 → never runs
// against staging/prod. Eager glob (only the small expert JSONs, not the content
// data layer) mirrors admin-pujol/experts/index.astro + lib/experts.ts.
type ExpertJson = {
  title?: string; slug?: string; fonction?: string; description?: string; photo?: string;
  phone?: string; email?: string; emailAliases?: string[]; linkedin?: string; facebook?: string;
  instagram?: string; seoTitle?: string; seoDescription?: string; department?: string;
  order?: number; agenda?: string; secteur?: string; hidden?: boolean; listingOnly?: boolean;
};
async function seedFromContent(db: D1Database): Promise<void> {
  const mods = import.meta.glob<ExpertJson>('../content/experts/*.json', { eager: true, import: 'default' });
  const rows = Object.values(mods);
  for (const e of rows) {
    await createExpert(db, {
      slug: e.slug, title: e.title, fonction: e.fonction, description: e.description, photo: e.photo,
      phone: e.phone, email: e.email, email_aliases: e.emailAliases || [],
      linkedin: e.linkedin, facebook: e.facebook, instagram: e.instagram,
      seo_title: e.seoTitle, seo_description: e.seoDescription, department: e.department,
      sort_order: typeof e.order === 'number' ? e.order : null,
      agenda: e.agenda, secteur: e.secteur, hidden: !!e.hidden, listing_only: !!e.listingOnly,
    }, 'seed@local');
  }
}

// ── row <-> object mapping ───────────────────────────────────────────────────

function toExpert(row: any): ExpertRecord {
  return {
    ...row,
    email_aliases: safeJson(row.email_aliases),
    hidden: !!row.hidden,
    listing_only: !!row.listing_only,
    sort_order: row.sort_order === null || row.sort_order === undefined ? null : Number(row.sort_order),
    fonction: row.fonction || '',
    description: row.description || '',
  };
}
function safeJson(v: any): string[] {
  if (!v) return [];
  try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
}

export function slugify(input: string): string {
  return (input || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || 'expert';
}

// The stored title is "Prénom Nom – Rôle" — the slug should come from the name
// half only (matching the existing hand-authored slugs).
function nameFromTitle(title: string): string {
  const cleaned = (title || '').split('|').pop()?.trim() || '';
  return cleaned.split(/\s+[–-]\s+/)[0].trim() || cleaned;
}

async function uniqueSlug(db: D1Database, base: string, excludeId?: number): Promise<string> {
  let slug = base, n = 1;
  while (true) {
    const row = await db.prepare('SELECT id FROM experts WHERE slug = ?').bind(slug).first<{ id: number }>();
    if (!row || row.id === excludeId) return slug;
    slug = `${base}-${++n}`;
  }
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

// Listing order mirrors the /experts/ index intent: grouped by department then by
// manual order, but the admin table is flat so we sort by department, sort_order,
// then name for a stable, scannable list.
export async function listExperts(db: D1Database): Promise<ExpertRecord[]> {
  const { results } = await db.prepare(
    `SELECT * FROM experts
     ORDER BY (department IS NULL OR department = '') ASC, department ASC,
              (sort_order IS NULL) ASC, sort_order ASC, title ASC`
  ).all();
  return (results || []).map(toExpert);
}

export async function getExpert(db: D1Database, id: number): Promise<ExpertRecord | null> {
  const row = await db.prepare('SELECT * FROM experts WHERE id = ?').bind(id).first();
  return row ? toExpert(row) : null;
}

const b = (v: any) => (v ? 1 : 0);
const num = (v: any) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

export async function createExpert(db: D1Database, input: ExpertInput, adminEmail: string): Promise<ExpertRecord> {
  const title = (input.title || 'Nouvel expert').trim();
  const slugBase = input.slug ? slugify(input.slug) : slugify(nameFromTitle(title));
  const slug = await uniqueSlug(db, slugBase);
  const res = await db.prepare(
    `INSERT INTO experts
      (slug, title, fonction, description, photo, phone, email, email_aliases,
       linkedin, facebook, instagram, seo_title, seo_description, department,
       sort_order, agenda, secteur, hidden, listing_only, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    slug, title, input.fonction || '', input.description || '', input.photo || '',
    input.phone || '', input.email || '', JSON.stringify(input.email_aliases || []),
    input.linkedin || '', input.facebook || '', input.instagram || '',
    input.seo_title || '', input.seo_description || '', input.department || '',
    num(input.sort_order), input.agenda || '', input.secteur || '',
    b(input.hidden), b(input.listing_only), adminEmail,
  ).run();
  const id = res.meta.last_row_id as number;
  return (await getExpert(db, id))!;
}

export async function updateExpert(db: D1Database, id: number, input: ExpertInput): Promise<ExpertRecord | null> {
  const existing = await getExpert(db, id);
  if (!existing) return null;
  // Slug is frozen after creation to preserve indexed URLs, unless explicitly changed.
  const slug = input.slug && slugify(input.slug) !== existing.slug
    ? await uniqueSlug(db, slugify(input.slug), id)
    : existing.slug;
  const pick = <K extends keyof ExpertRecord>(k: K) => (input[k] ?? existing[k]);
  await db.prepare(
    `UPDATE experts SET
       slug=?, title=?, fonction=?, description=?, photo=?, phone=?, email=?, email_aliases=?,
       linkedin=?, facebook=?, instagram=?, seo_title=?, seo_description=?, department=?,
       sort_order=?, agenda=?, secteur=?, hidden=?, listing_only=?, updated_at=datetime('now')
     WHERE id=?`
  ).bind(
    slug, (input.title ?? existing.title).trim(), pick('fonction'), pick('description'), pick('photo'),
    pick('phone'), pick('email'), JSON.stringify(input.email_aliases ?? existing.email_aliases),
    pick('linkedin'), pick('facebook'), pick('instagram'), pick('seo_title'), pick('seo_description'),
    pick('department'), input.sort_order === undefined ? existing.sort_order : num(input.sort_order),
    pick('agenda'), pick('secteur'), b(input.hidden ?? existing.hidden), b(input.listing_only ?? existing.listing_only),
    id,
  ).run();
  return await getExpert(db, id);
}

export async function deleteExpert(db: D1Database, id: number): Promise<boolean> {
  const res = await db.prepare('DELETE FROM experts WHERE id = ?').bind(id).run();
  return (res.meta.changes || 0) > 0;
}

// ── publish snapshot (the build-time sync reads published_json ONLY) ──────────

// Snapshot = json_object of the content columns (skips id/lifecycle). Built
// server-side by SQLite. scripts/sync-d1-experts-to-content.mjs parses this blob.
// Keep aligned with the columns above AND scripts/backfill-published-snapshot.mjs.
const EXPERT_SNAPSHOT_JSON = `json_object(
  'slug', slug, 'title', title, 'fonction', fonction, 'description', description,
  'photo', photo, 'phone', phone, 'email', email, 'email_aliases', email_aliases,
  'linkedin', linkedin, 'facebook', facebook, 'instagram', instagram,
  'seo_title', seo_title, 'seo_description', seo_description, 'department', department,
  'sort_order', sort_order, 'agenda', agenda, 'secteur', secteur,
  'hidden', hidden, 'listing_only', listing_only)`;

/** "Publier": freeze every expert's current state into published_json (what the
 *  site builds from). Experts have no draft lifecycle — visibility is governed by
 *  hidden/listing_only, which the snapshot carries. Idempotent. */
export async function publishExperts(db: D1Database): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(`UPDATE experts SET published_json = ${EXPERT_SNAPSHOT_JSON}, published_at = ?`).bind(now).run();
}

/** Count of experts with unpublished changes — for the admin banner. */
export async function countPendingExperts(db: D1Database): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS n FROM experts
     WHERE published_json IS NULL OR published_at IS NULL OR datetime(updated_at) > datetime(published_at)`
  ).first<{ n: number }>();
  return row?.n || 0;
}
