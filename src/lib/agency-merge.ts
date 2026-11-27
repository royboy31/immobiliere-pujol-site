// T3 (Caroline 27/11): /services/ pages merged into /service-immobilier/agence-immobiliere-pujol/.
// Their markdown stays (the agency page reads the story texts from it) but they are no longer
// built as pages: public/_redirects sends their URLs to the agency page (stories) or to the
// French service page (English pages). Keep scripts/gen-sitemap-slugs.mjs in sync.
export const AGENCY = '/service-immobilier/agence-immobiliere-pujol/';

export const MERGED_SERVICE_LINKS: Record<string, string | null> = {
  'lhistoire-de-la-societe': `${AGENCY}#histoire`,
  'le-mot-de-stephane': `${AGENCY}#mot-de-stephane`,
  'la-mission-de-immobiliere-pujol': `${AGENCY}#mission`,
  'pourquoi-nous-faisons-ce-metier': `${AGENCY}#pourquoi-nous-faisons-ce-metier`,
  // English pages: redirected, and dropped from sibling navigation.
  'advisory-transactions-service': null,
  'property-management-question-expertise': null,
  'simple-efficient-rental-management': null,
};

export const isMergedService = (slug: string): boolean => slug in MERGED_SERVICE_LINKS;

/** Rewrites a sibling-nav href that points at a merged page. Returns null to drop the link. */
export function remapMergedHref(href: string): string | null {
  const m = href.match(/^\/services\/([^/]+)\/$/);
  if (!m || !isMergedService(m[1])) return href;
  return MERGED_SERVICE_LINKS[m[1]];
}
