// Alert subscriptions store (D1). A buyer/renter registers search criteria and
// the site notifies them when a matching listing is published. Mirrors the
// structure of newsletter-db.ts (same getDB / ensureSchema / lazy-migration idiom).
//
// Lifecycle: a public signup is created `pending` and only becomes `active` when
// the person clicks the double-opt-in link. A back-office manual add is created
// `active` directly (the request was already expressed) but still gets a
// confirmation/management email. Only `active` alerts are matched against new listings.

export type AlertStatus = 'pending' | 'active' | 'paused' | 'unsub';
export type Transac = 'V' | 'L';

export interface Alert {
  id: string;
  created_at: number;
  email: string;
  prenom: string | null;
  nom: string | null;
  phone: string | null;
  transac: Transac;
  cp: string | null;      // one or more codes postaux, stored as a sorted CSV ("13001,13006")
  kind: string | null;
  budget_max: number | null;
  chambres_min: number | null;
  proprietaire: number;   // 0|1 — vente only
  bien_a_vendre: number;  // 0|1 — vente only
  source_ref: string | null;
  negociateur_email: string | null;
  status: AlertStatus;
  confirmed_at: number | null;
  last_notified_at: number | null;
  token: string;          // secret for confirm / manage / unsubscribe links
}

export interface AlertInput {
  email: string;
  prenom?: string | null;
  nom?: string | null;
  phone?: string | null;
  transac: Transac;
  cp?: string | null;
  kind?: string | null;
  budget_max?: number | null;
  chambres_min?: number | null;
  proprietaire?: boolean;
  bien_a_vendre?: boolean;
  source_ref?: string | null;
  negociateur_email?: string | null;
  status?: AlertStatus;   // defaults to 'pending' (public opt-in); back-office passes 'active'
}

export const KIND_LABELS: Record<string, string> = {
  appartement: 'Appartement',
  maison: 'Maison',
  parking: 'Parking / Garage',
  local: 'Local / Bureau',
  terrain: 'Terrain',
  autre: 'Autre',
};

/** One-line French summary of an alert's criteria, e.g.
 *  "Location · Appartement · 13006 · 2 chambres · budget max 900 €". */
export function describeCriteria(a: Pick<Alert, 'transac' | 'kind' | 'cp' | 'budget_max' | 'chambres_min'>): string {
  const parts: string[] = [a.transac === 'V' ? 'Vente' : 'Location'];
  if (a.kind) parts.push(KIND_LABELS[a.kind] || a.kind);
  if (a.cp) parts.push(a.cp.split(',').join(', '));
  if (a.chambres_min) parts.push(a.chambres_min >= 4
    ? '4 chambres et plus'
    : `${a.chambres_min} chambre${a.chambres_min > 1 ? 's' : ''}`);
  if (a.budget_max) parts.push(`budget max ${a.budget_max.toLocaleString('fr-FR')} €`);
  return parts.join(' · ');
}

/** D1 binding from the Worker runtime (works in `astro dev` too). */
export async function getDB(): Promise<D1Database> {
  const { env } = await import('cloudflare:workers');
  const db = (env as any).DB as D1Database;
  if (!db) throw new Error('D1 binding "DB" is not available');
  return db;
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  email TEXT NOT NULL,
  prenom TEXT, nom TEXT, phone TEXT,
  transac TEXT NOT NULL,
  cp TEXT, kind TEXT,
  budget_max INTEGER, chambres_min INTEGER,
  proprietaire INTEGER DEFAULT 0,
  bien_a_vendre INTEGER DEFAULT 0,
  source_ref TEXT,
  negociateur_email TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  confirmed_at INTEGER,
  last_notified_at INTEGER,
  token TEXT NOT NULL
)`;
const INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_alerts_match ON alerts(status, transac, cp, kind)`,
  `CREATE INDEX IF NOT EXISTS idx_alerts_token ON alerts(token)`,
  `CREATE INDEX IF NOT EXISTS idx_alerts_email ON alerts(email)`,
];

let schemaReady = false;
export async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;
  await db.prepare(SCHEMA).run();
  for (const ix of INDEXES) await db.prepare(ix).run();
  schemaReady = true;
}

function randToken(): string {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

function toAlert(row: any): Alert {
  return row as Alert;
}

export async function createAlert(db: D1Database, input: AlertInput): Promise<Alert> {
  const id = crypto.randomUUID();
  const token = randToken();
  const now = Date.now();
  const status: AlertStatus = input.status || 'pending';
  await db.prepare(
    `INSERT INTO alerts
      (id, created_at, email, prenom, nom, phone, transac, cp, kind, budget_max, chambres_min,
       proprietaire, bien_a_vendre, source_ref, negociateur_email, status, confirmed_at, last_notified_at, token)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    id, now, input.email.trim().toLowerCase(), input.prenom || null, input.nom || null, input.phone || null,
    input.transac, input.cp || null, input.kind || null, input.budget_max ?? null, input.chambres_min ?? null,
    input.proprietaire ? 1 : 0, input.bien_a_vendre ? 1 : 0, input.source_ref || null, input.negociateur_email || null,
    status, status === 'active' ? now : null, null, token,
  ).run();
  return (await getAlert(db, id))!;
}

export async function getAlert(db: D1Database, id: string): Promise<Alert | null> {
  const row = await db.prepare('SELECT * FROM alerts WHERE id = ?').bind(id).first();
  return row ? toAlert(row) : null;
}

export async function getAlertByToken(db: D1Database, token: string): Promise<Alert | null> {
  const row = await db.prepare('SELECT * FROM alerts WHERE token = ?').bind(token).first();
  return row ? toAlert(row) : null;
}

/** Confirm a pending opt-in. Idempotent: an already-active alert is returned as-is. */
export async function confirmAlert(db: D1Database, token: string): Promise<Alert | null> {
  const alert = await getAlertByToken(db, token);
  if (!alert) return null;
  if (alert.status === 'pending') {
    await db.prepare(`UPDATE alerts SET status='active', confirmed_at=? WHERE id=?`).bind(Date.now(), alert.id).run();
    return await getAlert(db, alert.id);
  }
  return alert;
}

export async function unsubscribeAlert(db: D1Database, token: string): Promise<Alert | null> {
  const alert = await getAlertByToken(db, token);
  if (!alert) return null;
  await db.prepare(`UPDATE alerts SET status='unsub' WHERE id=?`).bind(alert.id).run();
  return await getAlert(db, alert.id);
}

/** Back-office: pause / re-activate / delete. */
export async function setAlertStatus(db: D1Database, id: string, status: AlertStatus): Promise<Alert | null> {
  await db.prepare(`UPDATE alerts SET status=? WHERE id=?`).bind(status, id).run();
  return await getAlert(db, id);
}

export async function deleteAlert(db: D1Database, id: string): Promise<boolean> {
  const res = await db.prepare('DELETE FROM alerts WHERE id = ?').bind(id).run();
  return (res.meta.changes || 0) > 0;
}

export async function listAlerts(db: D1Database, opts?: { transac?: Transac; status?: AlertStatus }): Promise<Alert[]> {
  const where: string[] = [];
  const binds: any[] = [];
  if (opts?.transac) { where.push('transac = ?'); binds.push(opts.transac); }
  if (opts?.status) { where.push('status = ?'); binds.push(opts.status); }
  const sql = `SELECT * FROM alerts ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC`;
  const { results } = await db.prepare(sql).bind(...binds).all();
  return (results || []).map(toAlert);
}

/** Dedup guard: same person, same exact criteria, still live (pending/active/paused). */
export async function findDuplicate(db: D1Database, input: AlertInput): Promise<Alert | null> {
  const row = await db.prepare(
    `SELECT * FROM alerts WHERE email=? AND transac=? AND status IN ('pending','active','paused')
       AND IFNULL(cp,'')=IFNULL(?,'') AND IFNULL(kind,'')=IFNULL(?,'')
       AND IFNULL(budget_max,-1)=IFNULL(?,-1) AND IFNULL(chambres_min,-1)=IFNULL(?,-1) LIMIT 1`
  ).bind(
    input.email.trim().toLowerCase(), input.transac,
    input.cp || null, input.kind || null, input.budget_max ?? null, input.chambres_min ?? null,
  ).first();
  return row ? toAlert(row) : null;
}

/**
 * Phase 2: active alerts a freshly-published listing satisfies. A NULL criterion
 * means "no preference" and matches anything. Budget is a ceiling. Bedroom values
 * 1 to 3 are exact; 4 means four or more. Missing listing data only matches alerts
 * with no bedroom preference.
 */
export async function findMatchingAlerts(
  db: D1Database,
  listing: { transac: Transac; cp: string | null; kind: string | null; prix: number | null; chambres: number | null },
): Promise<Alert[]> {
  const { results } = await db.prepare(
    `SELECT * FROM alerts WHERE status='active' AND transac=?
       AND (cp IS NULL OR instr(','||cp||',', ','||?||',') > 0)
       AND (kind IS NULL OR kind=?)
       AND (budget_max IS NULL OR ? IS NULL OR budget_max >= ?)
       AND (chambres_min IS NULL OR chambres_min = MIN(IFNULL(?, 0), 4))`
  ).bind(
    listing.transac, listing.cp, listing.kind,
    listing.prix, listing.prix, listing.chambres,
  ).all();
  return (results || []).map(toAlert);
}
