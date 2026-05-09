// Helpers used by the listing pages to expose filter-friendly metadata on each
// annonce card. Kept in sync with the FilterBar.astro component which reads the
// data-* attributes from the rendered cards.

import type { UbiflowAnnonce } from './ubiflow';

export type Kind = 'appartement' | 'maison' | 'parking' | 'local' | 'terrain' | 'autre';

export function classifyKind(libelle: string | undefined): Kind {
  const s = (libelle || '').toLowerCase();
  if (!s) return 'autre';
  // T1..T9, F1..F9, "appartement", "studio", "duplex/triplex" — all flats.
  if (/(appartement|studio|loft|duplex|triplex|^[tf]\d)/.test(s)) return 'appartement';
  if (/(maison|villa|propri[ée]t[ée])/.test(s)) return 'maison';
  if (/(parking|garage|box|stationnement)/.test(s)) return 'parking';
  if (/(local|commerce|boutique|bureau|atelier|entrep[ôo]t)/.test(s)) return 'local';
  if (/terrain/.test(s)) return 'terrain';
  return 'autre';
}

export function isMeuble(a: UbiflowAnnonce): boolean {
  if (a.meuble) return true;
  const t = `${a.libelleType || ''} ${a.titre || ''}`.toLowerCase();
  return /meubl[ée]/.test(t);
}

export function hasExterieur(a: UbiflowAnnonce): boolean {
  return !!(a.terrasse || a.balcon || a.surfaceTerrasse);
}

export function hasParking(a: UbiflowAnnonce): boolean {
  return !!(a.parking || a.garage);
}

// Price used for budget filtering (vente -> prix, location -> loyerCC ?? loyer).
export function filterPrice(a: UbiflowAnnonce): number {
  if (a.type === 'V') return a.prix ?? 0;
  return a.loyerCC ?? a.loyer ?? 0;
}

// Bucketize nbPieces for the dropdown: 1, 2, 3, 4+.
export function piecesBucket(n: number | null | undefined): string {
  if (!n) return '';
  if (n >= 4) return '4+';
  return String(n);
}

export interface KindOption {
  value: Kind | '';
  label: string;
  count: number;
}

// Build "type de bien" options from the annonce list, keeping only kinds that
// have at least one match so the dropdown stays short.
export function buildKindOptions(list: UbiflowAnnonce[]): KindOption[] {
  const counts = new Map<Kind, number>();
  for (const a of list) {
    const k = classifyKind(a.libelleType);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const labels: Record<Kind, string> = {
    appartement: 'Appartement',
    maison: 'Maison',
    parking: 'Parking / Garage',
    local: 'Local / Bureau',
    terrain: 'Terrain',
    autre: 'Autre',
  };
  const order: Kind[] = ['appartement', 'maison', 'parking', 'local', 'terrain', 'autre'];
  return order
    .filter((k) => (counts.get(k) ?? 0) > 0)
    .map((k) => ({ value: k, label: labels[k], count: counts.get(k) ?? 0 }));
}

// Unique sorted postal codes that appear at least once in the list.
export function buildArrondissements(list: UbiflowAnnonce[]): { code: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const a of list) {
    const cp = (a.codePostal || '').trim();
    if (!cp) continue;
    counts.set(cp, (counts.get(cp) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, count]) => ({ code, count }));
}
