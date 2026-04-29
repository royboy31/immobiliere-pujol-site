// Build-time Google-reviews fetcher.
//
// The WordPress plugin on the live site (immobiliere-pujol.fr) renders the
// 4 most recent reviews directly in the HTML. We scrape that block at build
// time and bake the result into the static homepage. If the fetch ever
// fails (network, layout change), we fall back to a hard-coded snapshot so
// the build never breaks.

export interface GoogleReview {
  author: string;
  rating: number;
  date: string;
  text: string;
  avatar?: string;
  profileUrl?: string;
}

const SOURCE_URL = 'https://www.immobiliere-pujol.fr/';

const FALLBACK: GoogleReview[] = [
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
];

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘')
    .replace(/&hellip;/g, '…')
    .replace(/&nbsp;/g, ' ');
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

function parseReviews(html: string): GoogleReview[] {
  const block = html.match(/<ul class="listing">([\s\S]*?)<\/ul>/);
  if (!block) return [];
  const items = [...block[1].matchAll(/<li class="rating-(\d+)"[^>]*>([\s\S]*?)<\/li>/g)];

  return items
    .map(([, ratingStr, body]): GoogleReview | null => {
      const rating = Number(ratingStr) || 5;
      const author = stripTags(body.match(/<span class="author-name">([\s\S]*?)<\/span>/)?.[1] || '');
      if (!author) return null;
      const date = stripTags(body.match(/<span class="date">([\s\S]*?)<\/span>/)?.[1] || '');
      const snippet = stripTags(body.match(/<span class="review-snippet">([\s\S]*?)<\/span>/)?.[1] || '');
      const more = stripTags(body.match(/<span class="review-full-text">([\s\S]*?)<\/span>/)?.[1] || '');
      const text = (snippet + (more ? ' ' + more : '')).trim();
      const avatar = body.match(/<img[^>]+src="([^"]+)"/)?.[1];
      const profileUrl = body.match(/href="(https:\/\/www\.google\.com\/maps\/contrib\/[^"]+)"/)?.[1];
      return { author, rating, date, text, avatar, profileUrl };
    })
    .filter((r): r is GoogleReview => r !== null);
}

export async function fetchGoogleReviews(): Promise<GoogleReview[]> {
  try {
    const res = await fetch(SOURCE_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PujolBuild/1.0)' },
      // 8s timeout via AbortController
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return FALLBACK;
    const html = await res.text();
    const parsed = parseReviews(html);
    return parsed.length > 0 ? parsed : FALLBACK;
  } catch {
    return FALLBACK;
  }
}
