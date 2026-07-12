// D1-backed newsletter campaign LOG. The subscriber list lives in Brevo — this
// table only records what was composed/sent (for the in-admin history + stats),
// per newsletter-dev-spec.md §2. Isolated table `newsletter_campaigns`; never
// touches annonces or any pre-existing table.

export interface NewsletterCampaign {
  id: number;
  brevo_campaign_id: number | null; // returned by Brevo, null until sent
  subject: string;
  preheader: string;
  template: string;                 // 'blog' | 'listings' | 'broadcast'
  intro: string;
  outro: string;
  article_slugs: string[];          // template A selection (kept for spec compat)
  content_json: any;                // full template-specific composed content
  status: 'draft' | 'sent';
  recipient_count: number | null;
  created_by: string;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export type CampaignInput = Partial<Omit<NewsletterCampaign, 'id' | 'created_at' | 'updated_at'>>;

/** Get the D1 binding from the Worker runtime (works in `astro dev` too). */
export async function getDB(): Promise<D1Database> {
  const { env } = await import('cloudflare:workers');
  const db = (env as any).DB as D1Database;
  if (!db) throw new Error('D1 binding "DB" is not available');
  return db;
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS newsletter_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brevo_campaign_id INTEGER,
  subject TEXT NOT NULL,
  preheader TEXT,
  template TEXT NOT NULL DEFAULT 'blog',
  intro TEXT,
  outro TEXT,
  article_slugs TEXT,
  content_json TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  recipient_count INTEGER,
  created_by TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

// Additive migration for tables created from an earlier schema (the spec's
// original shape lacked content_json).
const ADD_COLUMNS: Record<string, string> = {
  content_json: 'TEXT',
};

let schemaReady = false;

export async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;
  await db.prepare(SCHEMA).run();
  const info = await db.prepare('PRAGMA table_info(newsletter_campaigns)').all();
  const existing = new Set((info.results || []).map((r: any) => r.name));
  for (const [col, def] of Object.entries(ADD_COLUMNS)) {
    if (!existing.has(col)) await db.prepare(`ALTER TABLE newsletter_campaigns ADD COLUMN ${col} ${def}`).run();
  }
  schemaReady = true;
}

function toCampaign(row: any): NewsletterCampaign {
  return {
    ...row,
    article_slugs: safeArr(row.article_slugs),
    content_json: safeObj(row.content_json),
    status: row.status === 'sent' ? 'sent' : 'draft',
    preheader: row.preheader || '',
    intro: row.intro || '',
    outro: row.outro || '',
  };
}
function safeArr(v: any): string[] {
  if (!v) return [];
  try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
}
function safeObj(v: any): any {
  if (!v) return null;
  try { return JSON.parse(v); } catch { return null; }
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function listCampaigns(db: D1Database): Promise<NewsletterCampaign[]> {
  const { results } = await db.prepare(
    'SELECT * FROM newsletter_campaigns ORDER BY datetime(created_at) DESC'
  ).all();
  return (results || []).map(toCampaign);
}

export async function getCampaign(db: D1Database, id: number): Promise<NewsletterCampaign | null> {
  const row = await db.prepare('SELECT * FROM newsletter_campaigns WHERE id = ?').bind(id).first();
  return row ? toCampaign(row) : null;
}

export async function createCampaign(db: D1Database, input: CampaignInput, adminEmail: string): Promise<NewsletterCampaign> {
  const res = await db.prepare(
    `INSERT INTO newsletter_campaigns
      (subject, preheader, template, intro, outro, article_slugs, content_json,
       status, recipient_count, brevo_campaign_id, created_by, sent_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    (input.subject || 'Sans objet').trim(), input.preheader || '',
    input.template || 'blog', input.intro || '', input.outro || '',
    JSON.stringify(input.article_slugs || []), JSON.stringify(input.content_json ?? null),
    input.status === 'sent' ? 'sent' : 'draft',
    input.recipient_count ?? null, input.brevo_campaign_id ?? null,
    adminEmail, input.sent_at ?? null,
  ).run();
  const id = res.meta.last_row_id as number;
  return (await getCampaign(db, id))!;
}

export async function updateCampaign(db: D1Database, id: number, input: CampaignInput): Promise<NewsletterCampaign | null> {
  const existing = await getCampaign(db, id);
  if (!existing) return null;
  const pick = <K extends keyof NewsletterCampaign>(k: K) => (input[k] ?? existing[k]);
  await db.prepare(
    `UPDATE newsletter_campaigns SET
       subject=?, preheader=?, template=?, intro=?, outro=?, article_slugs=?, content_json=?,
       status=?, recipient_count=?, brevo_campaign_id=?, sent_at=?, updated_at=datetime('now')
     WHERE id=?`
  ).bind(
    (input.subject ?? existing.subject).trim(), pick('preheader'), pick('template'), pick('intro'), pick('outro'),
    JSON.stringify(input.article_slugs ?? existing.article_slugs),
    JSON.stringify(input.content_json ?? existing.content_json),
    input.status ?? existing.status, input.recipient_count ?? existing.recipient_count,
    input.brevo_campaign_id ?? existing.brevo_campaign_id, input.sent_at ?? existing.sent_at,
    id,
  ).run();
  return await getCampaign(db, id);
}

/** Mark a campaign as sent after Brevo confirms. */
export async function markSent(db: D1Database, id: number, brevoCampaignId: number | null, recipientCount: number | null): Promise<NewsletterCampaign | null> {
  await db.prepare(
    `UPDATE newsletter_campaigns SET status='sent', brevo_campaign_id=?, recipient_count=?, sent_at=datetime('now'), updated_at=datetime('now') WHERE id=?`
  ).bind(brevoCampaignId, recipientCount, id).run();
  return await getCampaign(db, id);
}

export async function deleteCampaign(db: D1Database, id: number): Promise<boolean> {
  const res = await db.prepare('DELETE FROM newsletter_campaigns WHERE id = ?').bind(id).run();
  return (res.meta.changes || 0) > 0;
}
