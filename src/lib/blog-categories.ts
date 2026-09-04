export const slugifyBlogCategory = (name: string): string =>
  name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const HIDDEN_BLOG_CATEGORIES = new Set([
  'l-immobilier-neuf-a-marseille',
]);

export const isVisibleBlogCategory = (name: string): boolean =>
  !HIDDEN_BLOG_CATEGORIES.has(slugifyBlogCategory(name));
