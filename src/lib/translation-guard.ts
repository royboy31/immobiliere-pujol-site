// Browser page translation (Chrome/Google Translate, Edge/Bing Translator)
// rewrites the admin editor's DOM in place. Saving then stores the translated
// text, as happened with Thibault Arnoux's bio (French replaced by English).
// Unwrapping the markup is not enough, the text inside is already translated,
// so any save carrying these markers is rejected outright.

const MARKERS = [
  /<font\b[^>]*vertical-align:\s*inherit/i, // Google Translate in Chrome
  /\b_msttexthash\s*=/i,                    // Microsoft Translator in Edge
];

export class TranslatedContentError extends Error {
  constructor() {
    super(
      'Enregistrement refusé : la page a été traduite automatiquement par le navigateur. ' +
      'Désactivez la traduction (icône de traduction dans la barre d’adresse, choisir « Français »), ' +
      'rechargez la page puis refaites vos modifications.',
    );
    this.name = 'TranslatedContentError';
  }
}

export function hasBrowserTranslation(value: unknown): boolean {
  if (typeof value === 'string') return MARKERS.some((re) => re.test(value));
  if (Array.isArray(value)) return value.some(hasBrowserTranslation);
  if (value && typeof value === 'object') return Object.values(value).some(hasBrowserTranslation);
  return false;
}

export function assertNotBrowserTranslated(input: unknown): void {
  if (hasBrowserTranslation(input)) throw new TranslatedContentError();
}
