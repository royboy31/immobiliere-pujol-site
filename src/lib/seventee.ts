import { classifyKind } from './annonces-filter.ts';

const SEVENTEE_AGENCY_URL = 'https://candidate.seventee.com/agencies/pujol/offers';

export function getSeventeeApplicationUrl(
  transaction: string | null | undefined,
  propertyType: string | null | undefined,
  reference: string | null | undefined,
): string | null {
  const normalizedReference = reference?.trim();
  if (transaction !== 'L' || !normalizedReference) return null;

  const kind = classifyKind(propertyType || undefined);
  if (!['appartement', 'maison', 'parking'].includes(kind)) return null;

  return `${SEVENTEE_AGENCY_URL}/${encodeURIComponent(normalizedReference)}`;
}
