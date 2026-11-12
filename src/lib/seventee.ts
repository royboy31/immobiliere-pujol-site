import { classifyKind } from './annonces-filter.ts';

export function getSeventeeApplicationUrl(
  _transaction: string | null | undefined,
  _propertyType: string | null | undefined,
  _reference: string | null | undefined,
): string | null {
  // Rental enquiries return to the existing site form after leaving Seventee.
  return null;
}

export function isCommercialRental(
  transaction: string | null | undefined,
  propertyType: string | null | undefined,
): boolean {
  return transaction === 'L' && classifyKind(propertyType || undefined) === 'local';
}
