// Expert lookup by email
// Matches Ubiflow `contactAAfficher` to an expert. Uses import.meta.glob so only
// the experts JSON files are bundled into the SSR chunk (not the full content
// data layer, which includes 5,000+ annonces and would blow the Worker size limit).

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
  }
  cachedMap = map;
  return map;
}

export function findExpertByEmail(rawEmail: string | undefined | null): Expert | null {
  if (!rawEmail) return null;
  return getExpertMap().get(normalizeEmail(rawEmail)) ?? null;
}

export type ExpertType = 'rental' | 'sales' | 'other';

// Classify expert by fonction so the page can theme rentals (green) vs sales (orange).
// Rental wins ties because "gestion locative" appears alongside "vente" in mixed roles
// (e.g. Caroline Pujol — "Vente, rénovation et gestion de biens immobiliers").
export function getExpertType(expert: Pick<Expert, 'fonction'>): ExpertType {
  const f = (expert.fonction || '').toLowerCase();
  if (!f) return 'other';
  if (/locati|locatif|location|loueur|loue/.test(f)) return 'rental';
  if (/vente|transaction/.test(f)) return 'sales';
  return 'other';
}
