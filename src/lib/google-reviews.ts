// Homepage reviews data types + fallback.
// The actual data is read from public/_data/google-reviews.json
// directly in index.astro (SSG only) — this file just exports types and fallback.

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

export const FALLBACK: ReviewData = {
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
