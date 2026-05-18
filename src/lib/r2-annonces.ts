// Fetch active annonces from the pre-built JSON snapshot in R2.
// Used by prerendered listing pages (index, locations, ventes) at build time.

import type { UbiflowAnnonce } from './ubiflow';

const R2_PUBLIC = 'https://pub-a37eed540afe4dc9b4479da74ba265e1.r2.dev';
const ACTIVE_JSON_URL = `${R2_PUBLIC}/annonces/active.json`;

/**
 * Fetch all active listings from the R2 JSON snapshot.
 * Falls back to an empty array if the JSON is missing or malformed.
 */
export async function fetchActiveListings(): Promise<UbiflowAnnonce[]> {
  try {
    const resp = await fetch(ACTIVE_JSON_URL);
    if (!resp.ok) {
      console.error(`[r2-annonces] Failed to fetch active.json: ${resp.status}`);
      return [];
    }
    const all = await resp.json() as UbiflowAnnonce[];
    // Deduplicate by address + price + surface (same property from multiple sources)
    const seen = new Map<string, UbiflowAnnonce>();
    for (const a of all) {
      const addr = (a.adresse || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (addr && a.prix && a.surface) {
        const key = `${a.type}|${a.codePostal}|${addr}|${a.prix}|${a.surface}`;
        if (!seen.has(key)) seen.set(key, a);
      } else {
        seen.set(a.slug, a);
      }
    }
    return [...seen.values()];
  } catch (e: any) {
    console.error(`[r2-annonces] Error fetching active.json: ${e.message}`);
    return [];
  }
}
