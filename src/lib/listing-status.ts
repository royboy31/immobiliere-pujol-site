// Maps the commercial status carried in the `termine` column (populated from
// the LBI feed's field 136 by the cron-sync worker) to the macaron label shown
// on ACTIVE listings. Closed listings use Vendu/Loué directly.
//
// Known active values: 'sous-offre', 'sous-compromis' (others → no macaron).
export function reservedLabel(status: string | null | undefined): string | null {
  const v = (status || '').trim().toLowerCase().replace(/\s+/g, '-');
  if (v === 'sous-offre') return 'Sous offre';
  if (v === 'sous-compromis') return 'Sous promesse';
  if (v === 'vendu') return 'Vendu';
  return null;
}

export function isReserved(status: string | null | undefined): boolean {
  return reservedLabel(status) !== null;
}
