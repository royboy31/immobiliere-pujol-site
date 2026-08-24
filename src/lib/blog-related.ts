export interface RelatedArticleEntry {
  slug: string;
  title: string;
  image?: string;
  date?: string;
}

/** Caroline's valid choices first, then newest eligible articles up to `limit`. */
export function buildRelatedArticles(
  articles: RelatedArticleEntry[],
  currentSlug: string,
  curatedSlugs: string[],
  limit = 6,
): RelatedArticleEntry[] {
  const eligible = articles
    .filter((article) => article.slug && article.slug !== currentSlug && !article.slug.startsWith('local/'))
    .sort((a, b) => {
      const byDate = (Date.parse(b.date || '') || 0) - (Date.parse(a.date || '') || 0);
      return byDate || a.title.localeCompare(b.title, 'fr');
    });
  const bySlug = new Map(eligible.map((article) => [article.slug, article]));
  const curated = [...new Set(curatedSlugs)]
    .map((slug) => bySlug.get(slug))
    .filter((article): article is RelatedArticleEntry => !!article);
  const selected = new Set(curated.map((article) => article.slug));
  const fallback = eligible
    .filter((article) => !selected.has(article.slug))
    .slice(0, Math.max(0, limit - curated.length));
  return [...curated, ...fallback];
}
