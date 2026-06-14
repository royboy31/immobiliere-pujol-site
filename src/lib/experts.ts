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
  department?: string;
  listingOnly?: boolean;
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
