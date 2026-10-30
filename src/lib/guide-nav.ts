// Gestion locative guide navigation: 12 sections in the order Caroline set on
// 29/10 ("Gestion locative.docx"). The hub page lists every section; each guide
// page's sidebar shows its own section, pages in this order. Edit here only.
export type GuideSection = { id: string; title: string; pages: string[] };

const p = (slug: string) => `/services/${slug}/`;

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: 'gestion-locative',
    title: 'Gestion locative',
    pages: [
      p('le-cout-de-la-gestion-locative'), // GL1.1
      p('notre-expertise-de-la-gestion-immobiliere-a-marseille'), // GL1.2
      p('nos-plus-en-gestion-immobiliere-et-location-dappartements'), // GL1.3
      p('une-relation-personnalisee'), // GL1.5
      p('recevez-votre-devis-de-location-en-24h'), // ML1.3
      p('devis-gestion-locative-marseille'), // ML3.4
      p('deleguer-gestion-locative-marseille'), // G2
      p('taches-gestion-locative-deleguees-marseille'), // Titre 3
      p('syndic-gestion-locative-pujol-marseille'), // Titre 13
    ],
  },
  {
    id: 'changer-d-agence-de-gestion',
    title: "Changer d'agence de gestion",
    pages: [
      p('changer-agence-gestion-locative-marseille'), // G1
      p('changement-gestionnaire-locatif-etapes-marseille'), // Titre 4
      p('checklist-changer-agence-gestion-locative'), // Titre 14
      p('comparer-agences-gestion-locative-marseille'), // Titre 15
    ],
  },
  {
    id: 'estimation-du-loyer',
    title: 'Estimation du loyer',
    pages: [
      p('estimer-votre-loyer'), // GL3.1
      p('comment-nous-estimons-le-prix-de-votre-loyer-sur-marseille'), // GL3.2
    ],
  },
  {
    id: 'le-marche-et-le-prix-des-loyers',
    title: 'Le marché et le prix des loyers',
    pages: [
      p('etude-sur-le-marche-de-la-location-a-marseille'), // GL6.1
    ],
  },
  {
    id: 'mettre-en-location',
    title: 'Mettre en location',
    pages: [
      p('nos-resultats-pour-la-mise-en-location'), // ML1.1
      p('lagence-de-location-immobiliere-pujol-a-marseille'), // ML1.2
      p('nos-prestations-de-mise-en-location'), // ML2.1
      p('si-vous-souhaitez-nous-confier-uniquement-la-location-de-votre-appartement'), // ML2.2
      p('comment-mettre-en-location-un-appartement'), // ML2.3
    ],
  },
  {
    id: 'commercialisation',
    title: 'Commercialisation',
    pages: [
      p('labellisation-des-appartements-a-louer-et-strategies-de-commercialisation'), // GL3.3
      p('ce-que-nous-ferons-pour-louer-rapidement-votre-appartement'), // GL3.4
    ],
  },
  {
    id: 'selection-du-locataire',
    title: 'Sélection du locataire',
    pages: [
      p('nos-resultats-en-termes-de-location-dappartements-a-marseille-et-de-prix'), // GL2.1
      p('comment-verifier-la-solvabilite-lors-dune-location-a-marseille'), // GL2.4
      p('comment-choisir-son-locataire-pour-une-gestion-immobiliere-sans-risque'), // GL2.5
      p('selection-locataire-garanties-marseille'), // ML3.2
    ],
  },
  {
    id: 'securite-juridique',
    title: 'Sécurité juridique',
    pages: [
      p('la-securite-dans-le-choix-des-locataires-des-contrats-et-des-actes'), // GL2.2
      p('eviter-les-litiges-avec-vos-locataires-a-marseille'), // GL2.3
    ],
  },
  {
    id: 'assurances-locatives',
    title: 'Assurances locatives',
    pages: [
      p('notre-offre-dassurance-loyers-impayes-pno-vacances-locatives'), // GL4.1
      p('notre-garantie-de-loyers-impayes'), // GL4.2
    ],
  },
  {
    id: 'loyers-impayes',
    title: 'Loyers impayés',
    pages: [
      p('loyer-impaye-marseille-procedure'), // Titre 1
      p('gestion-loyers-impayes-marseille'), // Titre 2
    ],
  },
  {
    id: 'rentabilite-investissement-locatif',
    title: 'Rentabilité de son investissement locatif',
    pages: [
      p('reduire-vacance-locative-marseille'), // Titre 6
      p('ameliorer-rentabilite-locative-marseille'), // Titre 8
      p('investissement-locatif-marseille-parcours'), // Titre 16
      p('erreurs-primo-bailleur-marseille'), // Titre 17
    ],
  },
  {
    id: 'travaux-et-renovation-energetique',
    title: 'Travaux et rénovation énergétique',
    pages: [
      p('obligations-bailleur-marseille-2026'), // Titre 5
      p('dpe-renovation-energetique-location-marseille'), // Titre 10
      p('renovation-locative-avant-apres-marseille'), // Titre 11
    ],
  },
];

export const GUIDE_HUB = '/service-immobilier/gestion-locative/';

export function guideSectionFor(path: string): GuideSection | undefined {
  return GUIDE_SECTIONS.find((s) => s.pages.includes(path));
}
