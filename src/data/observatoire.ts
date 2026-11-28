// Observatoire des prix à Marseille (quote PWS-PUJ-20261123-01): one price base feeds the observatoire,
// the map, the 16 arrondissement pages and the price blocks. Filled by the import of each edition
// (extraction checked against the source PDF). Rules: every figure carries its real period; a missing
// area/type shows "donnée non disponible"; no figure is invented, extrapolated or compared across
// non-comparable windows. Public label: "Analyse Immobilière Pujol" (never the source's name).

export type PropertyType = 'appartement_ancien' | 'appartement_neuf' | 'maison';

export type PriceRow = {
  area: string;            // '13000' for the whole city, '13001'..'13016' for an arrondissement
  type: PropertyType;
  medianM2?: number;       // median price per m², EUR
  medianPrice?: number;    // median price, EUR
  medianSurface?: number;  // m²
  sales?: number;          // number of sales in the period, when the report gives it
};

export type Edition = {
  id: string;              // e.g. '2025-09_2026-08'
  periodStart: string;     // ISO date, first day of the sales window
  periodEnd: string;       // ISO date, last day of the sales window
  publishedAt: string;     // ISO date the edition was imported and published on the site
  rows: PriceRow[];
};

// Editions, newest first. Only rows checked against the source tables (Codex extraction, FABLE check 28/11:
// Marseille + 16 arrondissements, old apartments; arrondissement sales add up to the Marseille total).
// Houses have no median per m² in these tables: they stay "donnée non disponible".
export const EDITIONS: Edition[] = [
  {"id": "2025-09_2026-08", "periodStart": "2025-09-01", "periodEnd": "2026-08-31", "publishedAt": "2026-11-28", "rows": [{"area": "13000", "type": "appartement_ancien", "medianM2": 3210, "medianPrice": 175000, "medianSurface": 60, "sales": 9827}, {"area": "13001", "type": "appartement_ancien", "medianM2": 3170, "medianPrice": 165200, "medianSurface": 55, "sales": 708}, {"area": "13002", "type": "appartement_ancien", "medianM2": 3310, "medianPrice": 160000, "medianSurface": 48, "sales": 401}, {"area": "13003", "type": "appartement_ancien", "medianM2": 1810, "medianPrice": 79400, "medianSurface": 48, "sales": 414}, {"area": "13004", "type": "appartement_ancien", "medianM2": 2900, "medianPrice": 160000, "medianSurface": 58, "sales": 867}, {"area": "13005", "type": "appartement_ancien", "medianM2": 3430, "medianPrice": 162700, "medianSurface": 51, "sales": 854}, {"area": "13006", "type": "appartement_ancien", "medianM2": 3790, "medianPrice": 226500, "medianSurface": 61, "sales": 879}, {"area": "13007", "type": "appartement_ancien", "medianM2": 4900, "medianPrice": 261800, "medianSurface": 58, "sales": 630}, {"area": "13008", "type": "appartement_ancien", "medianM2": 4180, "medianPrice": 276100, "medianSurface": 69, "sales": 1084}, {"area": "13009", "type": "appartement_ancien", "medianM2": 3120, "medianPrice": 190000, "medianSurface": 64, "sales": 863}, {"area": "13010", "type": "appartement_ancien", "medianM2": 2640, "medianPrice": 150000, "medianSurface": 60, "sales": 734}, {"area": "13011", "type": "appartement_ancien", "medianM2": 2560, "medianPrice": 165000, "medianSurface": 67, "sales": 410}, {"area": "13012", "type": "appartement_ancien", "medianM2": 3380, "medianPrice": 208500, "medianSurface": 65, "sales": 597}, {"area": "13013", "type": "appartement_ancien", "medianM2": 2530, "medianPrice": 152000, "medianSurface": 64, "sales": 660}, {"area": "13014", "type": "appartement_ancien", "medianM2": 1720, "medianPrice": 96900, "medianSurface": 61, "sales": 354}, {"area": "13015", "type": "appartement_ancien", "medianM2": 1450, "medianPrice": 80800, "medianSurface": 60, "sales": 293}, {"area": "13016", "type": "appartement_ancien", "medianM2": 2990, "medianPrice": 184000, "medianSurface": 61, "sales": 79}]},
];

export const latestEdition = (): Edition | undefined => EDITIONS[0];

export const findRow = (e: Edition | undefined, area: string, type: PropertyType): PriceRow | undefined =>
  e?.rows.find((r) => r.area === area && r.type === type);

const fmtDate = (iso: string) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "ventes de septembre 2025 à août 2026" */
export const periodLabel = (e: Edition) => `ventes de ${fmtDate(e.periodStart)} à ${fmtDate(e.periodEnd)}`;

export const eur = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';

export const NA = 'donnée non disponible';
