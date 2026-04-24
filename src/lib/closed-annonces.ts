// Loader for closed annonces.
//
// Closed annonces are stored as static JSON files in public/_data/annonces/
// (generated at build time from the content collection). We fetch them at
// SSR time via the Cloudflare ASSETS binding so the Worker bundle stays small.

export interface ClosedAnnonceRelated {
  slug: string;
  title: string;
  prix: number | null;
  type: 'V' | 'L' | string;
  cp: string;
}

export interface ClosedAnnonce {
  id?: number;
  slug: string;
  referenceAgence?: string;
  typeAnnonce?: 'V' | 'L' | string;
  termine?: string;
  status?: string;
  date?: string;
  adresse?: string;
  codePostal?: string;
  ville?: string;
  quartier?: string;
  prix?: number | null;
  loyerCC?: number | null;
  charges?: number | null;
  honoraires?: string;
  garantie?: string;
  surface?: number | null;
  surfaceTerrain?: number | null;
  nbPieces?: number | null;
  nbChambres?: number | null;
  nbSallesBain?: number | null;
  nbWC?: number | null;
  etage?: string | number;
  nbEtages?: string | number;
  dpeNote?: string;
  gesNote?: string;
  typeChauffage?: string;
  cuisine?: string;
  descriptif?: string;
  photos?: string[];
  contactAAfficher?: string;
  emailAAfficher?: string;
  telephoneAAfficher?: string;
  seoTitle?: string;
  seoDescription?: string;
  permalink?: string;
  related?: ClosedAnnonceRelated[];
}

/**
 * Load a closed annonce by slug. Returns null if not found.
 *
 * `assets` should be the Cloudflare ASSETS binding, i.e.
 * `Astro.locals.runtime.env.ASSETS`. When unavailable (e.g. in dev server
 * without wrangler), we fall back to a regular fetch relative to the site URL.
 */
export async function getClosedAnnonce(
  slug: string,
  assets: { fetch: (req: Request) => Promise<Response> } | undefined,
  baseUrl: URL,
): Promise<ClosedAnnonce | null> {
  if (!slug) return null;
  // Guard against weird slugs that could escape the asset path.
  if (!/^[A-Za-z0-9_-]+$/.test(slug)) return null;
  const url = new URL(`/_data/annonces/${slug}.json`, baseUrl);
  try {
    const resp = assets
      ? await assets.fetch(new Request(url.toString()))
      : await fetch(url.toString());
    if (!resp.ok) return null;
    return (await resp.json()) as ClosedAnnonce;
  } catch {
    return null;
  }
}

export function formatClosedPrice(a: ClosedAnnonce): string {
  if (a.typeAnnonce === 'V' && a.prix) {
    return new Intl.NumberFormat('fr-FR').format(a.prix) + ' €';
  }
  if (a.typeAnnonce === 'L' && (a.loyerCC || a.prix)) {
    const v = a.loyerCC ?? a.prix!;
    return new Intl.NumberFormat('fr-FR').format(v) + ' € CC/mois';
  }
  return '';
}

export function typeLabel(a: ClosedAnnonce): string {
  return a.typeAnnonce === 'V' ? 'Vente' : 'Location';
}
