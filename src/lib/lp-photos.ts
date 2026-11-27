// Photos of the gestion locative landing + 4 profile pages, PRODUCTION snapshot.
//
// On staging Caroline chose these photos in the photo editor (D1 table lp_photos). Production does
// not ship the editor: this file freezes her 21 published choices as read from staging D1 on
// 27/11/2026 (all 21 published, draft == published). Each file in
// public/images/services/lp-proposition/published/ is byte-identical to its staging R2 object
// (sha256 = the hash in the original key). Framing: the published values carry no pos/posMobile,
// exactly as rendered on staging.

export type Photo = { src: string; w: number; h: number; pos?: string; posMobile?: string };

export const LP_PHOTOS: Record<string, Photo> = {
  'accueil-final': {"src": "/images/services/lp-proposition/published/accueil-final.webp", "w": 1586, "h": 992},
  'accueil-hero': {"src": "/images/services/lp-proposition/published/accueil-hero.webp", "w": 1585, "h": 992},
  'accueil-proofs': {"src": "/images/services/lp-proposition/published/accueil-proofs.webp", "w": 1600, "h": 1000},
  'accueil-step1': {"src": "/images/services/lp-proposition/published/accueil-step1.webp", "w": 1586, "h": 992},
  'accueil-step2': {"src": "/images/services/lp-proposition/published/accueil-step2.webp", "w": 1024, "h": 683},
  'accueil-step3': {"src": "/images/services/lp-proposition/published/accueil-step3.webp", "w": 1024, "h": 640},
  'accueil-step4': {"src": "/images/services/lp-proposition/published/accueil-step4.webp", "w": 1512, "h": 1040},
  'accueil-step5': {"src": "/images/services/lp-proposition/published/accueil-step5.webp", "w": 1513, "h": 1040},
  'coproprietaire-hero': {"src": "/images/services/lp-proposition/published/coproprietaire-hero.webp", "w": 1600, "h": 1067},
  'coproprietaire-s1': {"src": "/images/services/lp-proposition/published/coproprietaire-s1.webp", "w": 1600, "h": 533},
  'coproprietaire-s2': {"src": "/images/services/lp-proposition/published/coproprietaire-s2.webp", "w": 1536, "h": 1024},
  'coproprietaire-s3': {"src": "/images/services/lp-proposition/published/coproprietaire-s3.webp", "w": 1600, "h": 1067},
  'deja-en-agence-hero': {"src": "/images/services/lp-proposition/published/deja-en-agence-hero.webp", "w": 1600, "h": 533},
  'deja-en-agence-s1': {"src": "/images/services/lp-proposition/published/deja-en-agence-s1.webp", "w": 1585, "h": 992},
  'deja-en-agence-s2': {"src": "/images/services/lp-proposition/published/deja-en-agence-s2.webp", "w": 1535, "h": 1024},
  'je-gere-seul-hero': {"src": "/images/services/lp-proposition/published/je-gere-seul-hero.webp", "w": 1600, "h": 535},
  'je-gere-seul-s1': {"src": "/images/services/lp-proposition/published/je-gere-seul-s1.webp", "w": 1024, "h": 640},
  'je-gere-seul-s2': {"src": "/images/services/lp-proposition/published/je-gere-seul-s2.webp", "w": 1585, "h": 992},
  'premiere-location-hero': {"src": "/images/services/lp-proposition/published/premiere-location-hero.webp", "w": 1600, "h": 535},
  'premiere-location-s1': {"src": "/images/services/lp-proposition/published/premiere-location-s1.webp", "w": 1600, "h": 535},
  'premiere-location-s2': {"src": "/images/services/lp-proposition/published/premiere-location-s2.webp", "w": 1536, "h": 1024},
};

export function posStyle(p: Photo, hero = false): string | undefined {
  const [a, b] = hero ? ['--hero-pos', '--hero-pos-mobile'] : ['--pos', '--pos-m'];
  const parts = [p.pos && `${a}: ${p.pos}`, p.posMobile && `${b}: ${p.posMobile}`].filter(Boolean);
  return parts.length ? parts.join('; ') : undefined;
}
