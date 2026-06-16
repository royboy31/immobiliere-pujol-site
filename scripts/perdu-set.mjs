// Listings Caroline flagged "perdu" (lost, not sold by the agency) in the
// closed-sales sheet. PHASE 1: hide them from every on-site display (expert
// pages + internal-link pools) but KEEP the detail URL resolving (the closed
// page still renders) so the historical Google traffic / indexed URLs are not
// lost. No redirects or deletions here — that is phase 2.
//
// Source of truth: migration/perdu-slugs.txt — the slugs of the sheet rows
// whose "Statut flux actuel" is "perdu" (654 rows as of 16 Jun 2026).
// Regenerate from the sheet export with scripts/gen-perdu-slugs is not needed;
// the txt is committed and edited when Caroline updates the sheet.

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function loadPerdu() {
  const slugs = new Set();
  const tokens = new Set(); // leading reference token — matches across slug-drift
  try {
    const txt = await readFile(join(ROOT, 'migration/perdu-slugs.txt'), 'utf-8');
    for (const line of txt.split('\n')) {
      const s = line.trim().toLowerCase();
      if (!s) continue;
      slugs.add(s);
      tokens.add(s.split('-')[0]);
    }
  } catch {
    /* no file -> hide nothing (fail open) */
  }
  const isPerdu = (slug) => {
    const s = (slug || '').toLowerCase();
    if (!s) return false;
    return slugs.has(s) || tokens.has(s.split('-')[0]);
  };
  return { slugs, tokens, isPerdu };
}
