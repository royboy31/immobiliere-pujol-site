// Gestion locative guide navigation: 12 sections in the order Caroline set on
// 29/10 ("Gestion locative.docx"). The hub page lists every section; each guide
// page's sidebar shows its own section, pages in this order. Edit here only.
// Caroline 27/11 (video 58725797) + Roy 14:21: sections and links are worded as the questions owners ask.
// `title` is the question (block, sidebar, breadcrumb); `short` keeps the former name for reference.
export type GuideSection = { id: string; title: string; short: string; pages: string[] };

const p = (slug: string) => `/services/${slug}/`;

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: 'gestion-locative',
    title: 'Que recouvre la gestion locative ?', short: 'Gestion locative',
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
      p('coproprietaire-syndic-gestion-locative-marseille'), // G4 (LP persona, 30/10)
    ],
  },
  {
    id: 'changer-d-agence-de-gestion',
    title: 'Comment changer d’agence ?', short: "Changer d'agence de gestion",
    pages: [
      p('changer-agence-gestion-locative-marseille'), // G1
      p('changement-gestionnaire-locatif-etapes-marseille'), // Titre 4
      p('checklist-changer-agence-gestion-locative'), // Titre 14
      p('comparer-agences-gestion-locative-marseille'), // Titre 15
    ],
  },
  {
    id: 'estimation-du-loyer',
    title: 'Comment estimer son loyer ?', short: 'Estimation du loyer',
    pages: [
      p('estimer-votre-loyer'), // GL3.1
      p('comment-nous-estimons-le-prix-de-votre-loyer-sur-marseille'), // GL3.2
    ],
  },
  {
    id: 'le-marche-et-le-prix-des-loyers',
    title: 'Quel est le marché et les prix des loyers à Marseille ?', short: 'Le marché et le prix des loyers',
    pages: [
      p('etude-sur-le-marche-de-la-location-a-marseille'), // GL6.1
    ],
  },
  {
    id: 'mettre-en-location',
    title: 'Comment mettre en location ?', short: 'Mettre en location',
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
    title: 'Comment bien commercialiser son bien ?', short: 'Commercialisation',
    pages: [
      p('labellisation-des-appartements-a-louer-et-strategies-de-commercialisation'), // GL3.3
      p('ce-que-nous-ferons-pour-louer-rapidement-votre-appartement'), // GL3.4
    ],
  },
  {
    id: 'selection-du-locataire',
    title: 'Comment bien sélectionner son locataire ?', short: 'Sélection du locataire',
    pages: [
      p('nos-resultats-en-termes-de-location-dappartements-a-marseille-et-de-prix'), // GL2.1
      p('comment-verifier-la-solvabilite-lors-dune-location-a-marseille'), // GL2.4
      p('comment-choisir-son-locataire-pour-une-gestion-immobiliere-sans-risque'), // GL2.5
      p('selection-locataire-garanties-marseille'), // ML3.2
    ],
  },
  {
    id: 'securite-juridique',
    title: 'Comment sécuriser vos contrats et prévenir les litiges ?', short: 'Sécurité juridique',
    pages: [
      p('la-securite-dans-le-choix-des-locataires-des-contrats-et-des-actes'), // GL2.2
      p('eviter-les-litiges-avec-vos-locataires-a-marseille'), // GL2.3
    ],
  },
  {
    id: 'assurances-locatives',
    title: 'Quelles sont les assurances locatives en gestion locative ?', short: 'Assurances locatives',
    pages: [
      p('notre-offre-dassurance-loyers-impayes-pno-vacances-locatives'), // GL4.1
      p('notre-garantie-de-loyers-impayes'), // GL4.2
    ],
  },
  {
    id: 'loyers-impayes',
    title: 'Comment gérer les loyers impayés ?', short: 'Loyers impayés',
    pages: [
      p('loyer-impaye-marseille-procedure'), // Titre 1
      p('gestion-loyers-impayes-marseille'), // Titre 2
    ],
  },
  {
    id: 'rentabilite-investissement-locatif',
    title: 'Comment rentabiliser son investissement locatif ?', short: 'Rentabilité de son investissement locatif',
    pages: [
      p('premiere-mise-en-location-marseille'), // G3 (LP persona, 30/10)
      p('reduire-vacance-locative-marseille'), // Titre 6
      p('ameliorer-rentabilite-locative-marseille'), // Titre 8
      p('investissement-locatif-marseille-parcours'), // Titre 16
      p('erreurs-primo-bailleur-marseille'), // Titre 17
    ],
  },
  {
    id: 'travaux-et-renovation-energetique',
    title: 'Quels travaux et quelle rénovation énergétique prévoir ?', short: 'Travaux et rénovation énergétique',
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

/** Each guide link worded as the owner's question (Caroline 27/11). Labels only: page H1/SEO titles are unchanged. */
const GUIDE_QUESTIONS: Record<string, string> = {
  "le-cout-de-la-gestion-locative": "Combien coûte la gestion locative à Marseille ?",
  "notre-expertise-de-la-gestion-immobiliere-a-marseille": "Comment choisir son administrateur de biens à Marseille ?",
  "nos-plus-en-gestion-immobiliere-et-location-dappartements": "Quels sont les avantages de la gestion locative Pujol ?",
  "une-relation-personnalisee": "En quoi notre gestion locative est-elle personnalisée ?",
  "recevez-votre-devis-de-location-en-24h": "Comment obtenir un devis de gestion locative en 24 h ?",
  "devis-gestion-locative-marseille": "Que comprend un devis de gestion locative à Marseille ?",
  "deleguer-gestion-locative-marseille": "Pourquoi déléguer sa gestion locative à Marseille ?",
  "taches-gestion-locative-deleguees-marseille": "Quelles tâches déléguez-vous avec la gestion locative ?",
  "syndic-gestion-locative-pujol-marseille": "Pourquoi confier syndic et gestion locative à la même agence ?",
  "coproprietaire-syndic-gestion-locative-marseille": "Copropriétaire chez Pujol, pourquoi nous confier aussi votre gestion locative ?",
  "changer-agence-gestion-locative-marseille": "Comment changer d’agence de gestion locative à Marseille ?",
  "changement-gestionnaire-locatif-etapes-marseille": "Quelles sont les étapes pour changer de gestionnaire locatif ?",
  "checklist-changer-agence-gestion-locative": "Que vérifier avant de changer d’agence de gestion ?",
  "comparer-agences-gestion-locative-marseille": "Comment comparer les agences de gestion locative à Marseille ?",
  "estimer-votre-loyer": "Comment estimer votre loyer à Marseille en 2026 ?",
  "comment-nous-estimons-le-prix-de-votre-loyer-sur-marseille": "Comment estimons-nous le loyer de votre bien ?",
  "etude-sur-le-marche-de-la-location-a-marseille": "Comment se porte le marché de la location à Marseille en 2026 ?",
  "nos-resultats-pour-la-mise-en-location": "Quels résultats obtenons-nous en mise en location ?",
  "lagence-de-location-immobiliere-pujol-a-marseille": "Pourquoi passer par une agence de location à Marseille ?",
  "nos-prestations-de-mise-en-location": "Comment vous accompagnons-nous dans la mise en location ?",
  "si-vous-souhaitez-nous-confier-uniquement-la-location-de-votre-appartement": "Mise en location seule ou gestion complète, que choisir ?",
  "comment-mettre-en-location-un-appartement": "Comment mettre un appartement en location à Marseille ?",
  "labellisation-des-appartements-a-louer-et-strategies-de-commercialisation": "Comment valoriser et commercialiser un appartement à Marseille ?",
  "ce-que-nous-ferons-pour-louer-rapidement-votre-appartement": "Comment louons-nous rapidement votre appartement ?",
  "nos-resultats-en-termes-de-location-dappartements-a-marseille-et-de-prix": "Quels sont nos résultats et nos tarifs de location ?",
  "comment-verifier-la-solvabilite-lors-dune-location-a-marseille": "Comment vérifier la solvabilité d’un locataire ?",
  "comment-choisir-son-locataire-pour-une-gestion-immobiliere-sans-risque": "Comment choisir son locataire sans prendre de risque ?",
  "selection-locataire-garanties-marseille": "Quelles garanties demander au locataire ?",
  "la-securite-dans-le-choix-des-locataires-des-contrats-et-des-actes": "Comment sécuriser vos contrats de location ?",
  "eviter-les-litiges-avec-vos-locataires-a-marseille": "Comment prévenir les litiges avec vos locataires ?",
  "notre-offre-dassurance-loyers-impayes-pno-vacances-locatives": "Quelles assurances locatives choisir, GLI ou PNO ?",
  "notre-garantie-de-loyers-impayes": "Que couvre notre garantie loyers impayés à 1,8 % TTC ?",
  "loyer-impaye-marseille-procedure": "Quelles sont les étapes de la procédure en cas de loyer impayé ?",
  "gestion-loyers-impayes-marseille": "Comment vous accompagnons-nous en cas de loyers impayés ?",
  "premiere-mise-en-location-marseille": "Comment réussir sa première mise en location à Marseille ?",
  "reduire-vacance-locative-marseille": "Comment réduire la vacance locative à Marseille ?",
  "ameliorer-rentabilite-locative-marseille": "Comment améliorer la rentabilité locative sans tout rénover ?",
  "investissement-locatif-marseille-parcours": "Comment investir à Marseille, de l’achat à la première location ?",
  "erreurs-primo-bailleur-marseille": "Quelles erreurs éviter pour un premier investissement locatif ?",
  "obligations-bailleur-marseille-2026": "Quelles sont les obligations du bailleur à Marseille en 2026 ?",
  "dpe-renovation-energetique-location-marseille": "Comment concilier DPE et rénovation locative à Marseille ?",
  "renovation-locative-avant-apres-marseille": "À quoi ressemble une rénovation locative, avant et après ?",
};

/** Question label for a guide link (/services/<slug>/), or undefined if the page has none. */
export function guideQuestion(href: string): string | undefined {
  const slug = href.replace(/^\/services\//, '').replace(/\/$/, '');
  return GUIDE_QUESTIONS[slug];
}
