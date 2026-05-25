// Homepage reviews reader.
//
// At build time, scripts/sync-google-reviews.mjs:
//   1. Scrapes Google rating + review count from the WordPress site
//   2. Loads the 50 most recent OpinionSystem reviews (mixed across experts)
//   3. Writes public/_data/google-reviews.json
//
// This module reads that file at build/render time.

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface HomepageReview {
  author: string;
  rating: number;
  date: string;
  text: string;
  property?: string;
  expert?: string;
}

export interface GoogleStats {
  rating: number;
  reviewCount: number;
}

export interface ReviewData {
  stats: GoogleStats;
  reviews: HomepageReview[];
}

const FALLBACK: ReviewData = {
  stats: { rating: 4.7, reviewCount: 2050 },
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

export async function fetchGoogleReviews(): Promise<ReviewData> {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const raw = await readFile(
      join(__dirname, '..', '..', 'public', '_data', 'google-reviews.json'),
      'utf-8',
    );
    const data = JSON.parse(raw);
    return {
      stats: {
        rating: data.rating ?? FALLBACK.stats.rating,
        reviewCount: data.reviewCount ?? FALLBACK.stats.reviewCount,
      },
      reviews: data.reviews?.length > 0 ? data.reviews : FALLBACK.reviews,
    };
  } catch {
    return FALLBACK;
  }
}
