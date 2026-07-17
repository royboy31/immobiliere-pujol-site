// D1-backed blog articles: the runtime source of truth for the blog editor.
// At build time these rows are synced into src/content/articles/*.md (see the
// annonces pattern in scripts/sync-d1-to-content.mjs) and rendered by the
// existing [...slug].astro route. The admin reads/writes here directly.

export interface BlogArticle {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  body_html: string;
  featured_image: string;
  categories: string[];
  tags: string[];
  author: string;
  article_date: string;          // display/publish date, YYYY-MM-DD
  // SEO
  seo_title: string;
  seo_description: string;
  canonical_url: string;
  focus_keyword: string;
  noindex: boolean;
  nofollow: boolean;
  // Open Graph / social
  og_title: string;
  og_description: string;
  og_image: string;
  twitter_card: string;          // 'summary' | 'summary_large_image'
  // expert CTA card
  expert_cta: string;
  expert_cta_title: string;
  // lifecycle
  status: 'draft' | 'published';
  created_by: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export type ArticleInput = Partial<Omit<BlogArticle, 'id' | 'created_at' | 'updated_at'>>;

/** Get the D1 binding from the Worker runtime (works in `astro dev` too). */
export async function getDB(): Promise<D1Database> {
  const { env } = await import('cloudflare:workers');
  const db = (env as any).DB as D1Database;
  if (!db) throw new Error('D1 binding "DB" is not available');
  return db;
}

// Fresh-DB schema. Existing DBs are upgraded additively by the migration below.
const SCHEMA = `CREATE TABLE IF NOT EXISTS blog_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT,
  body_html TEXT,
  featured_image TEXT,
  categories TEXT,
  tags TEXT,
  author TEXT,
  article_date TEXT,
  seo_title TEXT,
  seo_description TEXT,
  canonical_url TEXT,
  focus_keyword TEXT,
  noindex INTEGER NOT NULL DEFAULT 0,
  nofollow INTEGER NOT NULL DEFAULT 0,
  og_title TEXT,
  og_description TEXT,
  og_image TEXT,
  twitter_card TEXT NOT NULL DEFAULT 'summary_large_image',
  expert_cta TEXT,
  expert_cta_title TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT,
  published_json TEXT
)`;

// Columns added after the first schema — applied to pre-existing tables so the
// same code upgrades an old local (or staging) DB without dropping data.
const ADD_COLUMNS: Record<string, string> = {
  article_date: 'TEXT',
  canonical_url: 'TEXT',
  focus_keyword: 'TEXT',
  noindex: 'INTEGER NOT NULL DEFAULT 0',
  nofollow: 'INTEGER NOT NULL DEFAULT 0',
  og_title: 'TEXT',
  og_description: 'TEXT',
  og_image: 'TEXT',
  twitter_card: "TEXT NOT NULL DEFAULT 'summary_large_image'",
  // Frozen snapshot of the last explicitly-published state. The build-time sync
  // reads THIS (never the live working row), so a rebuild can't publish an
  // in-progress edit. Set/cleared by publishArticles() (the "Publier" action).
  published_json: 'TEXT',
};

let schemaReady = false;

/** Idempotent: creates the table if missing, migrates missing columns, and seeds
 *  demo rows in an empty DB when SEED_DEMO=1 (local only). Safe on every request. */
export async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;
  await db.prepare(SCHEMA).run();
  // additive migration for older tables
  const info = await db.prepare('PRAGMA table_info(blog_articles)').all();
  const existing = new Set((info.results || []).map((r: any) => r.name));
  for (const [col, def] of Object.entries(ADD_COLUMNS)) {
    if (!existing.has(col)) await db.prepare(`ALTER TABLE blog_articles ADD COLUMN ${col} ${def}`).run();
  }
  let allowSeed = false;
  try { allowSeed = (await import('cloudflare:workers')).env?.SEED_DEMO === '1'; } catch { /* not in worker ctx */ }
  if (allowSeed) {
    const { count } = (await db.prepare('SELECT COUNT(*) AS count FROM blog_articles').first<{ count: number }>()) || { count: 0 };
    if (!count) await seedDemo(db);
  }
  schemaReady = true;
}

async function seedDemo(db: D1Database): Promise<void> {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const IMG = 'https://pub-a37eed540afe4dc9b4479da74ba265e1.r2.dev/2022/04/1585843061716.jpeg';
  const demos: ArticleInput[] = [
    {
      slug: 'bienvenue-sur-le-nouvel-editeur-de-blog',
      title: 'Bienvenue sur le nouvel éditeur de blog',
      excerpt: "Un exemple d'article créé directement depuis l'espace d'administration.",
      featured_image: IMG, article_date: today, categories: ['Actualités'], tags: ['démo'],
      author: 'Immobilière Pujol', status: 'published', published_at: now,
      seo_title: 'Nouvel éditeur de blog — Immobilière Pujol',
      seo_description: "Découvrez le nouvel éditeur d'articles : rédaction visuelle, images, et un référencement (SEO) complet.",
      focus_keyword: 'éditeur de blog', og_title: 'Le nouvel éditeur de blog Pujol',
      og_description: 'Rédigez des articles riches et parfaitement référencés.', og_image: IMG,
      body_html:
        '<p>Ceci est un article de démonstration. Vous pouvez le <strong>modifier</strong>, le supprimer ou en créer un nouveau.</p>' +
        '<h2>Un titre de section</h2>' +
        '<p>Le corps de l’article est du HTML — l’éditeur propose un mode visuel et un mode source.</p>' +
        '<ul><li>Création d’articles</li><li>Édition en visuel ou en HTML</li><li>Référencement (SEO) complet</li></ul>',
    },
    {
      slug: 'investir-dans-l-ancien-a-marseille',
      title: "Investir dans l'ancien à Marseille : nos conseils",
      excerpt: "Pourquoi l'immobilier ancien du centre de Marseille reste une valeur sûre.",
      featured_image: IMG, article_date: today, categories: ['Investissement'], tags: ['ancien', 'marseille'],
      author: 'Immobilière Pujol', status: 'published', published_at: now,
      body_html:
        '<p>Le centre historique de Marseille offre des opportunités d’investissement rares.</p>' +
        '<h3>Un rendement attractif</h3><p>Les quartiers du 13005 et du 13006 conjuguent charme et rentabilité.</p>',
    },
    {
      slug: 'brouillon-a-completer',
      title: 'Brouillon à compléter',
      excerpt: 'Un article encore en brouillon, non publié.',
      article_date: today, categories: [], tags: [], author: 'Immobilière Pujol', status: 'draft',
      body_html: '<p>À compléter…</p>',
    },
  ];
  for (const d of demos) await createArticle(db, d, 'seed@local');
}

// ── row <-> object mapping ───────────────────────────────────────────────────

function toArticle(row: any): BlogArticle {
  return {
    ...row,
    categories: safeJson(row.categories),
    tags: safeJson(row.tags),
    noindex: !!row.noindex,
    nofollow: !!row.nofollow,
    article_date: row.article_date || '',
    twitter_card: row.twitter_card || 'summary_large_image',
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
    .slice(0, 96) || 'article';
}

// Normalise an EXPLICITLY-PROVIDED slug while preserving it faithfully. Unlike
// slugify() (used to derive a fresh slug from a title), this keeps path
// separators ("local/…"), non-ASCII ("les-prix-au-m²-…"), underscores
// ("__trashed-4") and the full length — it only lowercases, turns whitespace
// into dashes, and trims stray leading/trailing slashes. Legacy imported slugs
// (which are live URLs) must round-trip through this untouched, otherwise
// editing an article would silently change its URL. New posts with no slug still
// go through slugify(title).
export function normalizeSlug(input: string): string {
  return (input || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/^\/+|\/+$/g, '') || 'article';
}

async function uniqueSlug(db: D1Database, base: string, excludeId?: number): Promise<string> {
  let slug = base, n = 1;
  while (true) {
    const row = await db.prepare('SELECT id FROM blog_articles WHERE slug = ?').bind(slug).first<{ id: number }>();
    if (!row || row.id === excludeId) return slug;
    slug = `${base}-${++n}`;
  }
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function listArticles(db: D1Database): Promise<BlogArticle[]> {
  const { results } = await db.prepare('SELECT * FROM blog_articles ORDER BY datetime(updated_at) DESC').all();
  return (results || []).map(toArticle);
}

export async function getArticle(db: D1Database, id: number): Promise<BlogArticle | null> {
  const row = await db.prepare('SELECT * FROM blog_articles WHERE id = ?').bind(id).first();
  return row ? toArticle(row) : null;
}

const b = (v: any) => (v ? 1 : 0);

export async function createArticle(db: D1Database, input: ArticleInput, adminEmail: string): Promise<BlogArticle> {
  const title = (input.title || 'Sans titre').trim();
  const slug = await uniqueSlug(db, input.slug ? normalizeSlug(input.slug) : slugify(title));
  const status = input.status === 'published' ? 'published' : 'draft';
  const publishedAt = status === 'published' ? (input.published_at || new Date().toISOString()) : null;
  const articleDate = input.article_date || new Date().toISOString().slice(0, 10);
  const res = await db.prepare(
    `INSERT INTO blog_articles
      (slug, title, excerpt, body_html, featured_image, categories, tags, author, article_date,
       seo_title, seo_description, canonical_url, focus_keyword, noindex, nofollow,
       og_title, og_description, og_image, twitter_card,
       expert_cta, expert_cta_title, status, created_by, published_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    slug, title, input.excerpt || '', input.body_html || '', input.featured_image || '',
    JSON.stringify(input.categories || []), JSON.stringify(input.tags || []), input.author || '', articleDate,
    input.seo_title || '', input.seo_description || '', input.canonical_url || '', input.focus_keyword || '',
    b(input.noindex), b(input.nofollow),
    input.og_title || '', input.og_description || '', input.og_image || '', input.twitter_card || 'summary_large_image',
    input.expert_cta || '', input.expert_cta_title || '', status, adminEmail, publishedAt,
  ).run();
  const id = res.meta.last_row_id as number;
  return (await getArticle(db, id))!;
}

export async function updateArticle(db: D1Database, id: number, input: ArticleInput): Promise<BlogArticle | null> {
  const existing = await getArticle(db, id);
  if (!existing) return null;
  // Slug is frozen after creation to preserve indexed URLs, unless explicitly changed.
  const slug = input.slug && normalizeSlug(input.slug) !== existing.slug
    ? await uniqueSlug(db, normalizeSlug(input.slug), id)
    : existing.slug;
  const status = input.status === 'published' ? 'published' : (input.status === 'draft' ? 'draft' : existing.status);
  const publishedAt = status === 'published' ? (existing.published_at || new Date().toISOString()) : null;
  const pick = <K extends keyof BlogArticle>(k: K) => (input[k] ?? existing[k]);
  await db.prepare(
    `UPDATE blog_articles SET
       slug=?, title=?, excerpt=?, body_html=?, featured_image=?, categories=?, tags=?, author=?, article_date=?,
       seo_title=?, seo_description=?, canonical_url=?, focus_keyword=?, noindex=?, nofollow=?,
       og_title=?, og_description=?, og_image=?, twitter_card=?,
       expert_cta=?, expert_cta_title=?, status=?, published_at=?, updated_at=datetime('now')
     WHERE id=?`
  ).bind(
    slug, (input.title ?? existing.title).trim(), pick('excerpt'), pick('body_html'), pick('featured_image'),
    JSON.stringify(input.categories ?? existing.categories), JSON.stringify(input.tags ?? existing.tags),
    pick('author'), pick('article_date'),
    pick('seo_title'), pick('seo_description'), pick('canonical_url'), pick('focus_keyword'),
    b(input.noindex ?? existing.noindex), b(input.nofollow ?? existing.nofollow),
    pick('og_title'), pick('og_description'), pick('og_image'), pick('twitter_card'),
    pick('expert_cta'), pick('expert_cta_title'), status, publishedAt, id,
  ).run();
  return await getArticle(db, id);
}

export async function deleteArticle(db: D1Database, id: number): Promise<boolean> {
  const res = await db.prepare('DELETE FROM blog_articles WHERE id = ?').bind(id).run();
  return (res.meta.changes || 0) > 0;
}

// ── publish snapshot (the build-time sync reads published_json ONLY) ──────────

// Snapshot = json_object of the CONTENT columns only (skips id/status/lifecycle).
// Built server-side by SQLite so publish never streams every body_html into the
// Worker. scripts/sync-d1-articles-to-content.mjs parses this blob. Keep this
// list aligned with the columns above AND scripts/backfill-published-snapshot.mjs.
const ARTICLE_SNAPSHOT_JSON = `json_object(
  'slug', slug, 'title', title, 'excerpt', excerpt, 'body_html', body_html,
  'featured_image', featured_image, 'categories', categories, 'tags', tags,
  'author', author, 'article_date', article_date, 'seo_title', seo_title,
  'seo_description', seo_description, 'canonical_url', canonical_url,
  'focus_keyword', focus_keyword, 'noindex', noindex, 'nofollow', nofollow,
  'og_title', og_title, 'og_description', og_description, 'og_image', og_image,
  'twitter_card', twitter_card, 'expert_cta', expert_cta,
  'expert_cta_title', expert_cta_title)`;

/** "Publier": freeze every PUBLISHED article's current state into published_json
 *  (what the site builds from) and drop the snapshot for drafts. Idempotent —
 *  re-running reproduces identical snapshots. */
export async function publishArticles(db: D1Database): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(`UPDATE blog_articles SET published_json = ${ARTICLE_SNAPSHOT_JSON}, published_at = ? WHERE status = 'published'`).bind(now).run();
  await db.prepare(`UPDATE blog_articles SET published_json = NULL WHERE status = 'draft'`).run();
}

/** Count of articles with unpublished changes — powers the admin "N modifications
 *  non publiées" banner. Published rows edited since (or never) published, and
 *  drafts still live on the site, all count. */
export async function countPendingArticles(db: D1Database): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS n FROM blog_articles
     WHERE (status = 'published' AND (published_json IS NULL OR published_at IS NULL OR datetime(updated_at) > datetime(published_at)))
        OR (status = 'draft' AND published_json IS NOT NULL)`
  ).first<{ n: number }>();
  return row?.n || 0;
}
