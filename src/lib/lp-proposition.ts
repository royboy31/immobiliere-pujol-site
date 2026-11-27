// TEST (10/11/2026): shared data for the gestion locative layout proposal pages.
// Figures: Caroline, call of 10/11 (Fathom 896090948, 07:55), also stated on
// /services/le-cout-de-la-gestion-locative/ and /services/loyer-impaye-marseille-procedure/.
// Photos: Caroline's albums (October 2026 shoot + "Jolis appartements"). Caroline 18/11: no Benoît (sales,
// his photos go to Vente), no building exteriors (Syndic); Gaël's visits and apartment interiors, and
// no photo repeated from one page to the next.
// compare.webp is still the old placeholder (unused on these pages).

const IMG = '/images/services/lp-proposition/';
const OLD = '/images/services/lp-magazine/';
type Img = { src: string; w: number; h: number };

export const LP_IMG = {
  hero: { src: IMG + 'hero.webp', w: 1024, h: 640 },
  proofs: { src: IMG + 'proofs.webp', w: 1024, h: 640 },
  final: { src: IMG + 'final.webp', w: 1600, h: 1067 },
  compare: { src: OLD + 'compare.webp', w: 1200, h: 1800 },
  steps: [
    { src: IMG + 'step1.webp', w: 1024, h: 683 },
    { src: IMG + 'step2.webp', w: 1024, h: 640 },
    { src: IMG + 'step3.webp', w: 1024, h: 640 },
    { src: IMG + 'step4.webp', w: 1024, h: 683 },
    { src: IMG + 'step5.webp', w: 1024, h: 683 },
  ] as Img[],
};

export const KEY_FIGURES = [
  { pre: 'à partir de', value: '3,75 % HT', label: 'Taux de gestion (4,5 % TTC)' },
  { pre: '', value: '1,8 %', label: 'Assurance loyers impayés, sans plafond ni franchise' },
  { pre: '', value: '18 jours', label: 'Délai médian de relocation' },
];

export type ProfileCard = {
  slug: string;
  service: string; // content id in src/content/services
  kicker: string;
  question: string;
  color: 'green' | 'orange' | 'slate' | 'sand';
  img: Img;
  heroPos?: string; // desktop object-position of the hero photo, when the wide crop cuts a head
  heroPosMobile?: string; // object-position of the hero photo on mobile, when the centre crop cuts the subject
  pics: Img[]; // section photos, own to this page
  heroCtas: Cta[];
  guides?: Guide[]; // downloadable against email + consent (GuideDownload.astro)
  sections: SectionCta[]; // CTAs under the sections, matched on the start of the section title
};

// CTAs: Caroline's Doc "Immo Pujol - Analyse Préparatoire 1/2", tabs G1 to G4 (snapshot 19/11/2026),
// labels word for word. Download and "receive by email" CTAs are left out until the guide or the
// email exists; G4 "Réserver un entretien avec" is left out until Caroline completes it.
export type Cta = { label: string; href: string; style?: 'text' | 'line' }; // text: Doc "CTA texte / discret"
export type Guide = { id: string; title: string; sub: string; cover: string }; // PDF path lives in the email worker only
export type SectionCta = { match: string; id?: string; ctas?: Cta[] };

export const CONSEILLER = '/services/contacter-un-conseiller-en-gestion-locative/';
// Gaëlle's Google booking page (same as the QR code on her contact page). Caroline 19/11 video:
// "Réserver…" CTAs go straight to the agenda.
export const AGENDA = 'https://calendar.google.com/calendar/appointments/schedules/AcZssZ0fgtiWYuB8b-HQxfvOfUQ0ZkIXJk4eE-GTP7MyGPDnx3DcAXrFqHCYKrlEZPcLxDxAjP78k1bT';
export const ESTIMATION = '/services/demander-une-estimation-du-loyer-de-votre-appartement-sur-marseille/#form';
const FORM = '#form';
const norm = (s: string) => s.normalize('NFC').replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
export const sectionFor = (card: ProfileCard, title: string) => card.sections.find((s) => norm(title).startsWith(norm(s.match)));

export const PROFILES: ProfileCard[] = [
  { slug: 'deja-en-agence', service: 'changer-agence-gestion-locative-marseille', kicker: 'Je suis déjà en agence', question: 'Déçu de votre agence actuelle ?', color: 'green', img: { src: IMG + 'p-agence.webp', w: 1024, h: 683 }, heroPos: '50% 18%', heroPosMobile: '68% 40%', pics: [{ src: IMG + 's-agence-1.webp', w: 1024, h: 683 }, { src: IMG + 's-agence-2.webp', w: 1024, h: 683 }], heroCtas: [{ label: 'Discuter avec notre expert et envisager le changement d’agence', href: CONSEILLER }], sections: [
    { match: 'Avant / après', ctas: [{ label: 'Voir comment d’autres bailleurs ont amélioré leur gestion en changeant d’agence', href: '#preuves', style: 'text' }] },
    // Release 27/11: hidden until the Phase 2 guides ship (FABLE): Caroline's CTA, unchanged, comes back then:
    // { label: 'Comprendre en détail comment se déroule un changement d’agence', href: '/services/changement-gestionnaire-locatif-etapes-marseille/', style: 'text' }
    { match: 'Changer d’agence de gestion, étape par étape', ctas: [] },
    { match: 'Tout ce que vous n’aurez pas à gérer', ctas: [{ label: 'Discutez avec un expert-conseil de la gestion locative', href: CONSEILLER, style: 'text' }] },
    { match: 'En 30 jours', ctas: [{ label: 'Faire le point sur la performance actuelle de la gestion de mon bien', href: CONSEILLER, style: 'text' }] }, // CTA tab suggestion
    { match: 'D’autres propriétaires bailleurs', id: 'preuves', ctas: [{ label: 'Parler à un gestionnaire pour envisager le changement d’agence', href: CONSEILLER, style: 'text' }] }, // CTA tab suggestion
    { match: 'Un diagnostic offert', ctas: [{ label: 'Réserver un diagnostic gratuit de changement d’agence avec un expert-conseil de la gestion locative', href: AGENDA }] },
    { match: 'Prêt à voir', ctas: [{ label: 'Obtenir mon devis de gestion locative chez Immobilière Pujol', href: FORM }, { label: 'Parler à un expert-conseil avant de décider de changer', href: CONSEILLER, style: 'line' }] },
  ] },
  { slug: 'je-gere-seul', service: 'deleguer-gestion-locative-marseille', kicker: 'Je gère seul ma location', question: 'Gérer seul devient complexe et chronophage ?', color: 'orange', img: { src: IMG + 'p-seul.webp', w: 1024, h: 640 }, pics: [{ src: IMG + 's-seul-1.webp', w: 1024, h: 683 }, { src: IMG + 's-seul-2.webp', w: 1024, h: 683 }], guides: [
    { id: 'gerer-seul-cout', title: 'Gérer seul ou déléguer ?', sub: 'Gérer seul vous coûte plus cher que de confier votre bien à un expert.', cover: '/images/services/guides/cover-gerer-seul-ou-deleguer.jpg' },
    { id: 'gerer-seul-risque', title: 'Gérer seul : vous portez le risque', sub: 'Responsabilité civile et pénale : dans un contexte législatif qui se durcit chaque année, l’erreur n’est plus une option.', cover: '/images/services/guides/cover-gerer-seul-risque.jpg' },
  ], heroCtas: [{ label: 'Parler à un expert-conseil de la gestion locative pour estimer vos gains et votre sécurité', href: CONSEILLER }], sections: [
    { match: 'Avant / après', ctas: [{ label: 'Voir tout ce que vous pourriez arrêter de gérer dès ce mois‑ci', href: CONSEILLER, style: 'text' }] },
    { match: 'En 30 jours', ctas: [{ label: 'Savoir comment nous sécurisons vos revenus et votre location', href: CONSEILLER, style: 'text' }] },
    { match: 'La fin de votre autogestion', ctas: [{ label: 'Réserver mon diagnostic gratuit de fin d’autogestion', href: AGENDA, style: 'text' }] },
    { match: 'Tout ce que vous n’aurez plus à faire', ctas: [{ label: 'Réserver un rendez-vous avec notre experte de la gestion locative', href: CONSEILLER, style: 'text' }] },
    { match: 'Vous pouvez nous confier', ctas: [{ label: 'Obtenir une proposition personnalisée de gestion locative', href: FORM, style: 'text' }] }, // CTA tab suggestion
    { match: 'Un diagnostic offert', ctas: [{ label: 'Réserver mon diagnostic gratuit', href: AGENDA }] },
    { match: 'Prêt à arrêter', ctas: [{ label: 'Obtenir mon devis de gestion locative', href: FORM }, { label: 'Parler à un expert de la gestion locative avant de décider', href: CONSEILLER, style: 'line' }] },
  ] },
  { slug: 'premiere-location', service: 'premiere-mise-en-location-marseille', kicker: 'Je loue pour la première fois', question: 'Premier investissement ?', color: 'slate', img: { src: IMG + 'p-premier.webp', w: 1024, h: 683 }, heroPos: '50% 12%', heroPosMobile: '72% 40%', pics: [{ src: IMG + 's-premier-1.webp', w: 1024, h: 640 }, { src: IMG + 's-premier-2.webp', w: 800, h: 533 }], heroCtas: [{ label: 'Faire estimer le loyer et la rentabilité de mon bien', href: ESTIMATION }], sections: [
    { match: 'Avant / après', ctas: [{ label: 'Voir à quoi ressemble une 1ère mise en location réussie', href: '#reussite', style: 'text' }] },
    { match: 'En 45 jours', id: 'reussite', ctas: [{ label: 'Faire valider mon plan de 1ère mise en location en 30 minutes', href: CONSEILLER, style: 'text' }] }, // CTA tab suggestion
    { match: 'Votre première mise en location, étape par étape', ctas: [{ label: 'Parler à un expert-conseil en gestion locative pour cadrer mon calendrier', href: CONSEILLER, style: 'text' }] },
    { match: 'Tout ce que vous n’aurez pas à improviser', ctas: [{ label: 'Parler à un gestionnaire avant de mettre mon bien en location', href: CONSEILLER, style: 'text' }] }, // CTA tab suggestion
    { match: 'Nous accompagnons déjà', ctas: [{ label: 'Estimer mon loyer par un gestionnaire qui signe 400 baux/an', href: ESTIMATION, style: 'text' }] }, // CTA tab suggestion
    { match: 'Avant la mise sur le marché', ctas: [{ label: 'Faire estimer le loyer et la rentabilité de mon bien', href: ESTIMATION }] },
    { match: 'Votre premier locataire', ctas: [{ label: 'Obtenir mon devis de gestion locative pour mon 1er bien', href: FORM }, { label: 'Parler à un gestionnaire avant de me lancer', href: CONSEILLER, style: 'line' }] },
  ] },
  { slug: 'coproprietaire', service: 'coproprietaire-syndic-gestion-locative-marseille', kicker: 'Je suis copropriétaire chez Immobilière Pujol', question: 'Votre syndic peut aussi gérer votre location', color: 'sand', img: { src: IMG + 'p-copro.webp', w: 1600, h: 1067 }, pics: [{ src: IMG + 's-copro-1.webp', w: 1024, h: 683 }, { src: IMG + 's-copro-2.webp', w: 1024, h: 683 }, { src: IMG + 's-copro-3.webp', w: 800, h: 533 }], heroCtas: [{ label: 'Parler à un gestionnaire pour faire le point sur votre bien à louer et à gérer', href: CONSEILLER }], sections: [
    { match: 'Les avantages pour vous de la synergie', ctas: [{ label: 'Planifier un entretien pour revoir mon lot et ma copropriété ensemble', href: CONSEILLER, style: 'text' }] }, // Doc "Réserver un entretien avec" is unfinished: CTA tab wording instead
    { match: 'Quand copropriété', ctas: [{ label: 'Demander un diagnostic copropriétaire bailleur (lot + copropriété)', href: CONSEILLER, style: 'text' }] }, // synergy guide not supplied: CTA tab wording instead
    { match: 'Tout ce que vous n’aurez plus à faire', ctas: [{ label: 'Déjà client Syndic ? Découvrez vos avantages exclusifs pour la gestion locative', href: '#diagnostic', style: 'text' }] },
    { match: 'Un diagnostic dédié', id: 'diagnostic', ctas: [{ label: 'Réserver mon diagnostic copropriétaire bailleur avec un gestionnaire expert', href: AGENDA }] },
    { match: 'Votre patrimoine locatif', ctas: [{ label: 'Voir ce que change la gestion locative Immobilière Pujol pour mon bien locatif', href: FORM }, { label: 'Parler à un gestionnaire dédié aux copropriétaires', href: CONSEILLER, style: 'line' }] },
  ] },
];
