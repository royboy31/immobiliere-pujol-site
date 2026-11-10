// TEST (10/11/2026): shared data for the gestion locative layout proposal pages.
// Figures: Caroline, call of 10/11 (Fathom 896090948, 07:55), also stated on
// /services/le-cout-de-la-gestion-locative/ and /services/loyer-impaye-marseille-procedure/.
// Photos are placeholders from Caroline's albums until the Sebanado shoot selection arrives.

const IMG = '/images/services/lp-magazine/';
type Img = { src: string; w: number; h: number };

export const LP_IMG = {
  hero: { src: IMG + 'hero.webp', w: 1800, h: 1201 },
  proofs: { src: IMG + 'proofs.webp', w: 1400, h: 1050 },
  final: { src: IMG + 'final.webp', w: 1600, h: 1200 },
  compare: { src: IMG + 'compare.webp', w: 1200, h: 1800 },
  steps: [
    { src: IMG + 'step1.webp', w: 1400, h: 1050 },
    { src: IMG + 'step2.webp', w: 1200, h: 1800 },
    { src: IMG + 'step3.webp', w: 1400, h: 934 },
    { src: IMG + 'step4.webp', w: 1200, h: 1800 },
    { src: IMG + 'step5.webp', w: 1400, h: 934 },
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
};

export const PROFILES: ProfileCard[] = [
  { slug: 'deja-en-agence', service: 'changer-agence-gestion-locative-marseille', kicker: 'Je suis déjà en agence', question: 'Déçu de votre agence actuelle ?', color: 'green', img: { src: IMG + 'p-agence.webp', w: 900, h: 600 } },
  { slug: 'je-gere-seul', service: 'deleguer-gestion-locative-marseille', kicker: 'Je gère seul ma location', question: 'Gérer seul devient complexe et chronophage ?', color: 'orange', img: { src: IMG + 'p-seul.webp', w: 800, h: 533 } },
  { slug: 'premiere-location', service: 'premiere-mise-en-location-marseille', kicker: 'Je loue pour la première fois', question: 'Premier investissement ?', color: 'slate', img: { src: IMG + 'p-premier.webp', w: 900, h: 600 } },
  { slug: 'coproprietaire', service: 'coproprietaire-syndic-gestion-locative-marseille', kicker: 'Je suis copropriétaire chez Immobilière Pujol', question: 'Votre syndic peut aussi gérer votre location', color: 'sand', img: { src: IMG + 'p-copro.webp', w: 900, h: 1350 } },
];
