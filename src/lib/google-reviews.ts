// Google reviews reader.
//
// At build time, scripts/sync-google-reviews.mjs scrapes the WordPress
// site and writes public/_data/google-reviews.json.  This module reads
// that file and returns the stats + reviews.  Falls back to hardcoded
// snapshot if the JSON is missing.

export interface GoogleReview {
  author: string;
  rating: number;
  date: string;
  text: string;
  profileUrl?: string | null;
}

export interface GoogleStats {
  rating: number;
  reviewCount: number;
}

export interface GoogleReviewData {
  stats: GoogleStats;
  reviews: GoogleReview[];
}

const FALLBACK: GoogleReviewData = {
  stats: { rating: 4.7, reviewCount: 2049 },
  reviews: [
    {
      author: 'Metehan',
      rating: 5,
      date: '2026',
      text: "Je vous remercie très sincèrement pour votre excellente coopération à mon égard, Madame Sene Madjiguène.",
    },
    {
      author: 'Nora',
      rating: 5,
      date: '2026',
      text: "Très bonne expérience avec cette agence immobilière. L'équipe est vraiment humaine, à l'écoute et bienveillante.",
    },
    {
      author: 'Maryline',
      rating: 5,
      date: '2026',
      text: "J'ai trouvé la location qui correspond à tous mes critères grâce à cette agence ! Je suis particulièrement ravie de l'accompagnement.",
    },
  ],
};

/**
 * Fetch Google review data from the pre-built JSON.
 * Works both at SSG build time (direct file read) and SSR runtime (ASSETS fetch).
 */
export async function fetchGoogleReviews(): Promise<GoogleReviewData> {
  try {
    // Try ASSETS binding first (Cloudflare Workers runtime)
    let res: Response | null = null;
    try {
      const { env } = await import('cloudflare:workers');
      const assets = (env as any)?.ASSETS;
      if (assets) {
        res = await assets.fetch(new Request('https://placeholder/_data/google-reviews.json'));
      }
    } catch {}

    // Fallback: direct file read (build time / dev)
    if (!res || !res.ok) {
      const { readFile } = await import('node:fs/promises');
      const { join, dirname } = await import('node:path');
      const { fileURLToPath } = await import('node:url');
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const raw = await readFile(join(__dirname, '..', '..', 'public', '_data', 'google-reviews.json'), 'utf-8');
      const data = JSON.parse(raw);
      return parsePayload(data);
    }

    return parsePayload(await res.json());
  } catch {
    return FALLBACK;
  }
}

function parsePayload(data: any): GoogleReviewData {
  return {
    stats: {
      rating: data.rating ?? FALLBACK.stats.rating,
      reviewCount: data.reviewCount ?? FALLBACK.stats.reviewCount,
    },
    reviews: data.reviews?.length > 0 ? data.reviews : FALLBACK.reviews,
  };
}
