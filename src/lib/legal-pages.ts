// The legal pages that are editable from the admin (D1 `site_pages`).
//
// Kept dependency-free on purpose: this is imported by the public [...slug].astro
// route as well as by the admin's pages-db, so it must not drag D1 or the
// content glob into the public bundle.
//
// The `pages` collection holds 29 files — home.md, experts.md, the vente/syndic/
// gestion landing pages — and only these two are D1-backed. Widen deliberately.

export const LEGAL_SLUGS = [
  'politique-de-confidentialite',
  'agence-immobiliere-marseille-gestion-locative-et-syndic/mentions-legales-immobiliere-pujol',
] as const;

export function isLegalPage(slug: string): boolean {
  return (LEGAL_SLUGS as readonly string[]).includes(slug);
}
