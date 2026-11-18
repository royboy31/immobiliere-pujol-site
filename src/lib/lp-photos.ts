// Photos of the 5 gestion locative proposal pages, editable by Caroline in the admin (Roy 18/11/2026).
//
// SCOPE: photos only. The text and layout of the pages stay in code. The 21 placements below are a
// fixed registry: the admin can change the photo and its framing of a known slot, never add one.
//
// Storage: D1 table `lp_photos`, one row per slot that was ever edited. No row (or a NULL value)
// means "the photo committed in the repo" (LP_IMG / PROFILES in lp-proposition.ts).
//   draft_json     what the admin is preparing (shown in the admin and on ?apercu=1)
//   published_json what visitors see. The pages are rendered on request, so publishing is
//                  immediate: no site rebuild, and nothing else in the admin gets published with it.
//   previous_json  the published photo before the last publish, for "Photo précédente".
//   revision       bumped on every write; a stale editor gets a conflict instead of overwriting.
//
// Kept free of `cloudflare:workers` so the tests can run it on node:sqlite.

import { LP_IMG, PROFILES } from './lp-proposition.ts';

export type Photo = { src: string; w: number; h: number; pos?: string; posMobile?: string };
export type Shape = 'hero' | 'step' | 'proof' | 'final' | 'section';
export type Slot = { id: string; page: string; label: string; shape: Shape; def: Photo };
export type PageDef = { id: string; title: string; url: string };

const BASE = '/service-immobilier/gestion-locative-proposition/';

export const LP_PAGES: PageDef[] = [
  { id: 'accueil', title: 'Page d’accueil gestion locative', url: BASE },
  ...PROFILES.map((p) => ({ id: p.slug, title: p.kicker, url: `${BASE}${p.slug}/` })),
];

const STEP_LABELS = [
  'Étape 1 : estimation du loyer',
  'Étape 2 : mise en location',
  'Étape 3 : gestion au quotidien',
  'Étape 4 : sécurité financière',
  'Étape 5 : conseils et accompagnement',
];

export const LP_SLOTS: Slot[] = [
  { id: 'accueil-hero', page: 'accueil', label: 'Grande photo en haut de page', shape: 'hero', def: LP_IMG.hero },
  ...LP_IMG.steps.map((img, i) => ({
    id: `accueil-step${i + 1}`, page: 'accueil', label: STEP_LABELS[i], shape: 'step' as Shape, def: img,
  })),
  { id: 'accueil-proofs', page: 'accueil', label: 'Bloc « Pourquoi autant de bailleurs nous confient… »', shape: 'proof', def: LP_IMG.proofs },
  { id: 'accueil-final', page: 'accueil', label: 'Bandeau du bas « Prêt à sécuriser vos loyers… »', shape: 'final', def: LP_IMG.final },
  ...PROFILES.flatMap((p) => [
    {
      id: `${p.slug}-hero`, page: p.slug, label: 'Grande photo en haut de page (aussi sur la carte de la page d’accueil)',
      shape: 'hero' as Shape, def: { ...p.img, pos: p.heroPos, posMobile: p.heroPosMobile },
    },
    ...p.pics.map((img, i) => ({
      id: `${p.slug}-s${i + 1}`, page: p.slug, label: `Photo de section ${i + 1}`, shape: 'section' as Shape, def: img,
    })),
  ]),
];

const SLOT_BY_ID = new Map(LP_SLOTS.map((s) => [s.id, s]));
export const slotsOfPage = (page: string) => LP_SLOTS.filter((s) => s.page === page);
export const getSlot = (id: string) => SLOT_BY_ID.get(id);

// ── validation ───────────────────────────────────────────────────────────────

/** Uploaded photos live in R2 under lp-proposition/<sha256>.<ext>, served by /media/<key>/. */
export const UPLOAD_SRC = /^\/media\/lp-proposition\/[a-f0-9]{64}\.(webp|jpg|png)\/$/;
const POS = /^(100|[1-9]?\d)% (100|[1-9]?\d)%$/;
const DEFAULT_SRCS = new Set(LP_SLOTS.map((s) => s.def.src));

/** Returns a clean Photo or an error message (French, shown to the admin). */
export function validatePhoto(v: any): Photo | string {
  if (!v || typeof v !== 'object') return 'Photo manquante';
  const src = String(v.src || '');
  if (!UPLOAD_SRC.test(src) && !DEFAULT_SRCS.has(src)) return 'Adresse de photo non autorisée';
  const w = Math.round(Number(v.w)), h = Math.round(Number(v.h));
  if (!(w >= 200 && w <= 6000 && h >= 200 && h <= 6000)) return 'Dimensions de photo invalides';
  const out: Photo = { src, w, h };
  for (const k of ['pos', 'posMobile'] as const) {
    if (v[k] == null || v[k] === '') continue;
    if (!POS.test(String(v[k]))) return 'Cadrage invalide';
    out[k] = String(v[k]);
  }
  return out;
}

// ── storage ──────────────────────────────────────────────────────────────────

type Row = {
  slot: string; draft_json: string | null; published_json: string | null; previous_json: string | null;
  revision: number; updated_by: string | null; updated_at: string | null; published_at: string | null;
};

export async function ensureLpPhotosSchema(db: D1Database): Promise<void> {
  await db.prepare(`CREATE TABLE IF NOT EXISTS lp_photos (
    slot TEXT PRIMARY KEY,
    draft_json TEXT,
    published_json TEXT,
    previous_json TEXT,
    revision INTEGER NOT NULL DEFAULT 0,
    updated_by TEXT,
    updated_at TEXT,
    published_by TEXT,
    published_at TEXT
  )`).run();
}

async function rows(db: D1Database): Promise<Map<string, Row>> {
  const { results } = await db.prepare('SELECT * FROM lp_photos').all();
  return new Map((results as any[] || []).map((r) => [String(r.slot), { ...r, revision: Number(r.revision || 0) } as Row]));
}

const parse = (json: string | null, def: Photo): Photo => {
  if (!json) return def;
  try { const v = validatePhoto(JSON.parse(json)); return typeof v === 'string' ? def : v; } catch { return def; }
};
const norm = (json: string | null | undefined) => json || null;

export type SlotState = Slot & {
  draft: Photo; published: Photo; previous: Photo | null;
  pending: boolean; isDefault: boolean; revision: number; updatedBy: string | null; updatedAt: string | null; publishedAt: string | null;
};

export async function getSlotStates(db: D1Database): Promise<SlotState[]> {
  const byId = await rows(db);
  return LP_SLOTS.map((s) => {
    const r = byId.get(s.id);
    return {
      ...s,
      draft: parse(r?.draft_json ?? null, s.def),
      published: parse(r?.published_json ?? null, s.def),
      previous: r?.previous_json ? parse(r.previous_json, s.def) : null,
      pending: norm(r?.draft_json) !== norm(r?.published_json),
      isDefault: !norm(r?.draft_json),
      revision: r?.revision ?? 0,
      updatedBy: r?.updated_by ?? null,
      updatedAt: r?.updated_at ?? null,
      publishedAt: r?.published_at ?? null,
    };
  });
}

/** slot id → photo, as visitors (published) or the admin preview (draft) see it. */
export async function getPhotoMap(db: D1Database, mode: 'published' | 'draft'): Promise<Record<string, Photo>> {
  const states = await getSlotStates(db);
  return Object.fromEntries(states.map((s) => [s.id, mode === 'draft' ? s.draft : s.published]));
}

export const defaultPhotoMap = (): Record<string, Photo> => Object.fromEntries(LP_SLOTS.map((s) => [s.id, s.def]));

export class ConflictError extends Error {}

const now = () => new Date().toISOString();

/**
 * Set the draft of one slot. `photo` null = back to the repo photo. `expectedRevision` is the revision
 * the editor loaded; if someone saved in between, nothing is written and ConflictError is thrown.
 */
export async function saveDraft(db: D1Database, slotId: string, photo: Photo | null, expectedRevision: number, by: string): Promise<number> {
  const slot = getSlot(slotId);
  if (!slot) throw new Error('Emplacement inconnu');
  let json: string | null = null;
  if (photo) {
    const v = validatePhoto(photo);
    if (typeof v === 'string') throw new Error(v);
    // Storing the repo photo with its repo framing is the same as "no change".
    json = v.src === slot.def.src && v.pos === slot.def.pos && v.posMobile === slot.def.posMobile ? null : JSON.stringify(v);
  }
  const r = (await rows(db)).get(slotId);
  if ((r?.revision ?? 0) !== expectedRevision) throw new ConflictError('Modifié entre-temps');
  if (!r) {
    const res = await db.prepare(
      `INSERT OR IGNORE INTO lp_photos (slot, draft_json, revision, updated_by, updated_at) VALUES (?,?,1,?,?)`
    ).bind(slotId, json, by, now()).run();
    if (!res.meta.changes) throw new ConflictError('Modifié entre-temps');
    return 1;
  }
  const res = await db.prepare(
    `UPDATE lp_photos SET draft_json = ?, revision = revision + 1, updated_by = ?, updated_at = ? WHERE slot = ? AND revision = ?`
  ).bind(json, by, now(), slotId, expectedRevision).run();
  if (!res.meta.changes) throw new ConflictError('Modifié entre-temps');
  return expectedRevision + 1;
}

/** Draft of a slot back to the photo that was online before the last publish. */
export async function draftFromPrevious(db: D1Database, slotId: string, expectedRevision: number, by: string): Promise<number> {
  const r = (await rows(db)).get(slotId);
  const slot = getSlot(slotId);
  if (!slot || !r?.previous_json) throw new Error('Pas de photo précédente');
  return saveDraft(db, slotId, parse(r.previous_json, slot.def), expectedRevision, by);
}

/**
 * SQL guard: true only while every slot of the page still has the revision the editor saw
 * (slot → revision; 0 = no row yet). Used inside a single UPDATE so the check and the write are one
 * atomic statement: either the whole page changes or nothing does.
 */
function pageGuard(ids: string[], revisions: Record<string, number>): { sql: string; binds: (string | number)[] } {
  const exp = ids.map((id) => [id, Math.max(0, Math.floor(Number(revisions?.[id] ?? 0)) || 0)] as const);
  const withRow = exp.filter(([, r]) => r > 0).length;
  const inList = ids.map(() => '?').join(',');
  const cases = exp.map(() => 'WHEN ? THEN ?').join(' ');
  return {
    sql: `(SELECT COUNT(*) FROM lp_photos g WHERE g.slot IN (${inList})) = ?
      AND (SELECT COUNT(*) FROM lp_photos g WHERE g.slot IN (${inList}) AND g.revision = CASE g.slot ${cases} END) = ?`,
    binds: [...ids, withRow, ...ids, ...exp.flatMap(([id, r]) => [id, r]), withRow],
  };
}

const PENDING = `IFNULL(draft_json, '') <> IFNULL(published_json, '')`;

/** Runs one guarded page UPDATE; returns the changed slots, or throws ConflictError if the guard failed. */
async function guardedPageUpdate(db: D1Database, page: string, revisions: Record<string, number>, set: string, setBinds: (string | number)[]): Promise<string[]> {
  const ids = slotsOfPage(page).map((s) => s.id);
  if (!ids.length) throw new Error('Page inconnue');
  const g = pageGuard(ids, revisions);
  const { results } = await db.prepare(
    `UPDATE lp_photos SET ${set} WHERE slot IN (${ids.map(() => '?').join(',')}) AND ${PENDING} AND ${g.sql} RETURNING slot`
  ).bind(...setBinds, ...ids, ...g.binds).all();
  const changed = ((results as any[]) || []).map((r) => String(r.slot));
  if (changed.length) return changed;
  // Nothing written: either nothing was pending, or the page changed under the editor.
  const byId = await rows(db);
  for (const id of ids) if ((byId.get(id)?.revision ?? 0) !== Number(revisions?.[id] ?? 0)) throw new ConflictError('Modifié entre-temps');
  return [];
}

/**
 * Put the drafts of ONE page online, all slots at once or none. `revisions` is what the editor saw
 * (slot → revision): if any slot of the page changed since, nothing is published. Returns the slots
 * that changed.
 */
export async function publishPage(db: D1Database, page: string, revisions: Record<string, number>, by: string): Promise<string[]> {
  return guardedPageUpdate(db, page, revisions,
    `previous_json = published_json, published_json = draft_json, revision = revision + 1, published_by = ?, published_at = ?`, [by, now()]);
}

/** Throw away the unpublished drafts of one page (draft = what is online), same all-or-nothing rule. */
export async function discardPage(db: D1Database, page: string, revisions: Record<string, number>, by: string): Promise<string[]> {
  return guardedPageUpdate(db, page, revisions,
    `draft_json = published_json, revision = revision + 1, updated_by = ?, updated_at = ?`, [by, now()]);
}

/** Groups of slots showing the same photo (her first complaint was the same photos everywhere). */
export function duplicateGroups(map: Record<string, Photo>): string[][] {
  const bySrc = new Map<string, string[]>();
  for (const s of LP_SLOTS) {
    const src = map[s.id]?.src;
    if (!src) continue;
    bySrc.set(src, [...(bySrc.get(src) || []), s.id]);
  }
  return [...bySrc.values()].filter((g) => g.length > 1);
}

// ── rendering helpers for the two page templates ────────────────────────────

/** Inline style carrying the framing; the SCSS reads --pos / --pos-m (hero: --hero-pos / --hero-pos-mobile). */
export function posStyle(p: Photo, hero = false): string | undefined {
  const [a, b] = hero ? ['--hero-pos', '--hero-pos-mobile'] : ['--pos', '--pos-m'];
  const parts = [p.pos && `${a}: ${p.pos}`, p.posMobile && `${b}: ${p.posMobile}`].filter(Boolean);
  return parts.length ? parts.join('; ') : undefined;
}

/**
 * Which section headings use which section photo on a profile page. Mirrors the photo loop of
 * [profil].astro (every 'cards' block takes the next photo, cycling), so the admin can say where
 * each photo shows.
 */
export function sectionPhotoUses(blocks: { kind: string; title: string }[], count: number): string[][] {
  const uses: string[][] = Array.from({ length: count }, () => []);
  let i = 0;
  for (const b of blocks) if (b.kind === 'cards' && count) uses[i++ % count].push(b.title);
  return uses;
}
