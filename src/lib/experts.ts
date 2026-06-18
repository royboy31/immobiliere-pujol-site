// Expert lookup by email
// Matches Ubiflow `contactAAfficher` to an expert. Uses import.meta.glob so only
// the experts JSON files are bundled into the SSR chunk (not the full content
// data layer, which includes 5,000+ annonces and would blow the Worker size limit).

import reassignmentsJson from '../data/expert-reassignments.json';

export interface Expert {
  slug: string;
  title: string;
  fonction?: string;
  description?: string;
  photo?: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  facebook?: string;
  instagram?: string;
  seoTitle?: string;
  seoDescription?: string;
  department?: string;
  listingOnly?: boolean;
  emailAliases?: string[];
}

const expertModules = import.meta.glob<Expert>(
  '../content/experts/*.json',
  { eager: true, import: 'default' }
);

function normalizeEmail(raw: string | undefined | null): string {
  if (!raw) return '';
  // Feed values can look like "x@y.fr|x@y.fr|x@y.fr" or "x@y.fr!" — take first token, strip noise.
  return raw.split('|')[0].trim().replace(/!+$/, '').toLowerCase();
}

let cachedMap: Map<string, Expert> | null = null;

function getExpertMap(): Map<string, Expert> {
  if (cachedMap) return cachedMap;
  const map = new Map<string, Expert>();
  for (const expert of Object.values(expertModules)) {
    const key = normalizeEmail(expert.email);
    if (key) map.set(key, expert);
    // Also index aliases (e.g. benoit@ → benoitmarinvicente@) so feed/override
    // emails in the short form still resolve to the right expert.
    for (const alias of expert.emailAliases ?? []) {
      const ak = normalizeEmail(alias);
      if (ak && !map.has(ak)) map.set(ak, expert);
    }
  }
  cachedMap = map;
  return map;
}

export function findExpertByEmail(rawEmail: string | undefined | null): Expert | null {
  if (!rawEmail) return null;
  return getExpertMap().get(normalizeEmail(rawEmail)) ?? null;
}

// Closed-history negotiator reassignment (Caroline's sheet, 2026-06): maps a
// listing `reference_agence` → the corrected expert email. LBI is the source of
// truth for ACTIVE biens, so this only applies to non-active (history) biens —
// if a bien reopens, the feed takes over and the override is skipped.
const REASSIGNMENTS = reassignmentsJson as Record<string, string>;
export function reassignedEmail(
  reference: string | null | undefined,
  status: string | null | undefined,
): string | null {
  const ref = (reference || '').toUpperCase();
  if (!ref || status === 'active') return null;
  return REASSIGNMENTS[ref] ?? null;
}

export type ExpertType = 'rental' | 'sales' | 'syndic' | 'other';

// Classify expert for theming: vente=orange (sales), location/gestion=green
// (rental), syndic=blue, direction=neutral grey (other). Department is the
// authoritative signal (Caroline's choice, meeting 15/05) since a fonction can
// mention several métiers (e.g. Caroline Pujol — "Vente, rénovation et gestion");
// fonction is the fallback when no department is set.
export function getExpertType(expert: Pick<Expert, 'fonction' | 'department'>): ExpertType {
  const dept = (expert.department || '').toLowerCase();
  if (dept === 'direction') return 'other';
  if (dept === 'syndic') return 'syndic';
  if (dept === 'vente') return 'sales';
  if (dept === 'gestion locative') return 'rental';

  const f = (expert.fonction || '').toLowerCase();
  if (!f) return 'other';
  if (/syndic|copropri/.test(f)) return 'syndic';
  if (/locati|locatif|location|loueur|loue/.test(f)) return 'rental';
  if (/vente|transaction/.test(f)) return 'sales';
  return 'other';
}
