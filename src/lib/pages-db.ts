// D1-backed LEGAL pages: the runtime source of truth for the legal-pages editor.
//
// SCOPE — deliberately just the two legal pages. The `pages` content collection
// holds 29 files, including home.md, experts.md and the vente/syndic/gestion
// landing pages. Those must NOT become admin-editable: a bad edit there would
// hit the whole site. LEGAL_SLUGS below is the allowlist, and it is the only
// thing that ever gets seeded, listed, or synced back out. Widen it on purpose,
// never by accident.
//
// Legal pages are a fixed set, so there is no create and no delete here, and the
// slug is not editable — changing it would break a live URL that other pages and
// external sites link to.
//
// At build time the published snapshot is written back to src/content/pages/*.md
// by scripts/sync-d1-pages-to-content.mjs and rendered by the existing
// [...slug].astro route.

// The allowlist lives in ./legal-pages so the public [...slug].astro route can
// share it without importing D1.
export { LEGAL_SLUGS } from './legal-pages';
import { LEGAL_SLUGS, isLegalPage } from './legal-pages';

export interface SitePage {
  id: number;
  slug: string;
  title: string;
  seo_title: string;
  seo_description: string;
  body_html: string;
  published_json: string | null;
  published_at: string | null;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export type PageInput = Partial<Pick<SitePage, 'title' | 'seo_title' | 'seo_description' | 'body_html'>>;

/** Get the D1 binding from the Worker runtime (works in `astro dev` too). */
export async function getDB(): Promise<D1Database> {
  const { env } = await import('cloudflare:workers');
  const db = (env as any).DB as D1Database;
  if (!db) throw new Error('D1 binding "DB" is not available');
  return db;
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS site_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  seo_title TEXT,
  seo_description TEXT,
  body_html TEXT,
  published_json TEXT,
  published_at TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);`;

export async function ensureSchema(db: D1Database): Promise<void> {
  await db.prepare(SCHEMA).run();
  await seedFromContent(db);
}

// ── seeding from the committed files ─────────────────────────────────────────

/** Minimal frontmatter split for our own files: 4 quoted scalars, HTML body. */
function parseMarkdown(raw: string): { fm: Record<string, string>; body: string } | null {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  const fm: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w]*):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1).replace(/\\"/g, '"');
    }
    fm[kv[1]] = v;
  }
  return { fm, body: m[2] };
}

/**
 * On an empty table, seed from the committed .md files — they are the current
 * live content, so they are the correct cutover baseline. Only LEGAL_SLUGS are
 * taken, whatever else the collection contains.
 */
async function seedFromContent(db: D1Database): Promise<void> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM site_pages').first<{ n: number }>();
  if ((row?.n || 0) > 0) return;

  const mods = import.meta.glob('../content/pages/*.md', { eager: true, query: '?raw', import: 'default' });
  const allowed = new Set<string>(LEGAL_SLUGS);

  for (const raw of Object.values(mods) as string[]) {
    const parsed = parseMarkdown(raw);
    if (!parsed?.fm.slug || !allowed.has(parsed.fm.slug)) continue;
    await db
      .prepare(
        `INSERT OR IGNORE INTO site_pages (slug, title, seo_title, seo_description, body_html, updated_by)
         VALUES (?,?,?,?,?,?)`
      )
      .bind(
        parsed.fm.slug,
        parsed.fm.title || parsed.fm.slug,
        parsed.fm.seoTitle || '',
        parsed.fm.seoDescription || '',
        parsed.body.trim(),
        'seed',
      )
      .run();
  }
}

// ── reads ────────────────────────────────────────────────────────────────────

function toPage(row: any): SitePage {
  return {
    id: Number(row.id),
    slug: String(row.slug),
    title: String(row.title || ''),
    seo_title: String(row.seo_title || ''),
    seo_description: String(row.seo_description || ''),
    body_html: String(row.body_html || ''),
    published_json: row.published_json ? String(row.published_json) : null,
    published_at: row.published_at ? String(row.published_at) : null,
    updated_by: String(row.updated_by || ''),
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
  };
}

export async function listPages(db: D1Database): Promise<SitePage[]> {
  const { results } = await db
    .prepare('SELECT * FROM site_pages ORDER BY title ASC')
    .all();
  return (results || []).map(toPage).filter((p) => isLegalPage(p.slug));
}

export async function getPage(db: D1Database, id: number): Promise<SitePage | null> {
  const row = await db.prepare('SELECT * FROM site_pages WHERE id = ?').bind(id).first();
  if (!row) return null;
  const page = toPage(row);
  // Defence in depth: never hand back a row outside the allowlist, even if one
  // somehow got into the table.
  return isLegalPage(page.slug) ? page : null;
}

// ── writes (edit only — no create, no delete, slug immutable) ────────────────

export async function updatePage(
  db: D1Database,
  id: number,
  input: PageInput,
  adminEmail: string,
): Promise<SitePage | null> {
  const existing = await getPage(db, id);
  if (!existing) return null;

  const title = (input.title ?? existing.title).trim() || existing.title;
  await db
    .prepare(
      `UPDATE site_pages
       SET title = ?, seo_title = ?, seo_description = ?, body_html = ?, updated_by = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    )
    .bind(
      title,
      input.seo_title ?? existing.seo_title,
      input.seo_description ?? existing.seo_description,
      input.body_html ?? existing.body_html,
      adminEmail,
      id,
    )
    .run();
  return await getPage(db, id);
}

// ── publish snapshot (mirrors blog-db) ───────────────────────────────────────

const PAGE_SNAPSHOT_JSON = `json_object(
  'slug', slug, 'title', title, 'seo_title', seo_title,
  'seo_description', seo_description, 'body_html', body_html
)`;

/** Freeze the current rows as the published snapshot the build reads. */
export async function publishPages(db: D1Database): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(`UPDATE site_pages SET published_json = ${PAGE_SNAPSHOT_JSON}, published_at = ?`)
    .bind(now)
    .run();
}

/** Pages edited since (or never) published — powers the "N modifications non publiées" banner. */
export async function countPendingPages(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM site_pages
       WHERE published_json IS NULL OR published_at IS NULL
          OR datetime(updated_at) > datetime(published_at)`
    )
    .first<{ n: number }>();
  return row?.n || 0;
}

export interface PendingPageChange {
  id: number;
  slug: string;
  title: string;
}

/** Exact legal-page set shown by the global publication preview. */
export async function listPendingPageChanges(db: D1Database): Promise<PendingPageChange[]> {
  const { results } = await db.prepare(
    `SELECT id, slug, title FROM site_pages
     WHERE published_json IS NULL OR published_at IS NULL
        OR datetime(updated_at) > datetime(published_at)
     ORDER BY title ASC`
  ).all();
  return (results || []).map((row: any) => ({
    id: Number(row.id),
    slug: String(row.slug || ''),
    title: String(row.title || row.slug || ''),
  })).filter((page) => isLegalPage(page.slug));
}
