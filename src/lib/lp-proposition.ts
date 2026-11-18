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
};

export const PROFILES: ProfileCard[] = [
  { slug: 'deja-en-agence', service: 'changer-agence-gestion-locative-marseille', kicker: 'Je suis déjà en agence', question: 'Déçu de votre agence actuelle ?', color: 'green', img: { src: IMG + 'p-agence.webp', w: 1024, h: 683 }, heroPos: '50% 18%', heroPosMobile: '68% 40%', pics: [{ src: IMG + 's-agence-1.webp', w: 1024, h: 683 }, { src: IMG + 's-agence-2.webp', w: 1024, h: 683 }] },
  { slug: 'je-gere-seul', service: 'deleguer-gestion-locative-marseille', kicker: 'Je gère seul ma location', question: 'Gérer seul devient complexe et chronophage ?', color: 'orange', img: { src: IMG + 'p-seul.webp', w: 1024, h: 640 }, pics: [{ src: IMG + 's-seul-1.webp', w: 1024, h: 683 }, { src: IMG + 's-seul-2.webp', w: 1024, h: 683 }] },
  { slug: 'premiere-location', service: 'premiere-mise-en-location-marseille', kicker: 'Je loue pour la première fois', question: 'Premier investissement ?', color: 'slate', img: { src: IMG + 'p-premier.webp', w: 1024, h: 683 }, heroPos: '50% 12%', heroPosMobile: '72% 40%', pics: [{ src: IMG + 's-premier-1.webp', w: 1024, h: 640 }, { src: IMG + 's-premier-2.webp', w: 1024, h: 683 }] },
  { slug: 'coproprietaire', service: 'coproprietaire-syndic-gestion-locative-marseille', kicker: 'Je suis copropriétaire chez Immobilière Pujol', question: 'Votre syndic peut aussi gérer votre location', color: 'sand', img: { src: IMG + 'p-copro.webp', w: 1600, h: 1067 }, pics: [{ src: IMG + 's-copro-1.webp', w: 1024, h: 683 }, { src: IMG + 's-copro-2.webp', w: 1024, h: 683 }, { src: IMG + 's-copro-3.webp', w: 800, h: 533 }] },
];
