// Internal-link rotation for the closed-annonce template.
//
// Goal: every closed listing renders a block of internal links, but each page
// links to a DIFFERENT, evenly-distributed slice of the site so we spread link
// equity instead of always pushing the same pages (which would unbalance the
// internal mesh). Selection is deterministic (seeded by the listing slug) so
// the build is stable and crawlers see a consistent link graph.

export interface LinkItem {
  url: string;
  title: string;
  type: string; // 'service' | 'article' | 'arrondissement'
}

interface LinkPool {
  count: number;
  links: LinkItem[];
}

/**
 * Load the pre-built link pool (public/_data/link-pool.json) via the Cloudflare
 * ASSETS binding, falling back to a plain fetch in dev.
 */
export async function loadLinkPool(
  assets: { fetch: (req: Request) => Promise<Response> } | undefined,
  baseUrl: URL,
): Promise<LinkItem[]> {
  const url = new URL('/_data/link-pool.json', baseUrl);
  try {
    const resp = assets
      ? await assets.fetch(new Request(url.toString()))
      : await fetch(url.toString());
    if (!resp.ok) return [];
    const data = (await resp.json()) as LinkPool;
    return Array.isArray(data.links) ? data.links : [];
  } catch {
    return [];
  }
}

// Deterministic 32-bit FNV-1a hash.
export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function gcd(a: number, b: number): number {
  while (b) { [a, b] = [b, a % b]; }
  return a;
}

// A stride that is coprime with the pool length so that stepping by it visits
// distinct indices (full coverage) while jumping across the sorted pool, which
// mixes link types within a single page.
function coprimeStride(len: number): number {
  for (const p of [769, 797, 811, 1009, 1013, 1117, 1201]) {
    const s = p % len;
    if (s > 1 && gcd(s, len) === 1) return s;
  }
  return 1;
}

/**
 * Pick `count` links from `pool`, seeded by `seed` (the listing slug).
 * Same seed always yields the same set; different seeds rotate the window so
 * coverage across all listings is roughly uniform.
 */
export function pickRotatedLinks(pool: LinkItem[], seed: string, count: number): LinkItem[] {
  const len = pool.length;
  if (!len) return [];
  const n = Math.min(count, len);
  const start = hashString(seed) % len;
  const stride = coprimeStride(len);
  const out: LinkItem[] = [];
  const seen = new Set<number>();
  for (let i = 0; out.length < n && i < len; i++) {
    const idx = (start + i * stride) % len;
    if (seen.has(idx)) continue;
    seen.add(idx);
    out.push(pool[idx]);
  }
  return out;
}
