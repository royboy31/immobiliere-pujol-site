import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Blog articles (891 markdown files)
const articles = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/articles' }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    date: z.string().optional(),
    excerpt: z.string().optional(),
    categories: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    featuredImage: z.string().optional(),
    author: z.string().optional(),
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
    // Slug of an expert (src/content/experts/<slug>.json) whose contact card
    // (photo + call/email/RDV) is appended at the end of the article.
    expertCta: z.string().optional(),
    // Optional heading shown above that expert card.
    expertCtaTitle: z.string().optional(),
    // Ordered related-article slugs selected in the admin editor.
    relatedArticles: z.array(z.string()).optional(),
    // Extended SEO / Open Graph — written from D1 by sync-d1-articles-to-content.mjs
    // and emitted in [...slug].astro's <head>. focusKeyword is editor-only (not rendered).
    canonicalUrl: z.string().optional(),
    focusKeyword: z.string().optional(),
    noindex: z.boolean().optional(),
    nofollow: z.boolean().optional(),
    ogTitle: z.string().optional(),
    ogDescription: z.string().optional(),
    ogImage: z.string().optional(),
    twitterCard: z.string().optional(),
  }),
});

// Service detail pages — /services/{slug}/ (77 markdown files)
const services = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/services' }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    subtitle: z.string().optional(),
    date: z.string().optional(),
    heroVideo: z.string().optional(),
    featuredImage: z.string().optional(),
    relatedForm: z.string().optional(),
    formTitle: z.string().optional(),
    formSubtitle: z.string().optional(),
    btnText: z.string().optional(),
    ctaText: z.string().optional(),
    taxonomy: z.string().optional(),
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
  }),
});

// Service landing pages — /service-immobilier/{slug}/ (27 markdown files)
const serviceImmobilier = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/serviceImmobilier' }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    subtitle: z.string().optional(),
    heroImage: z.string().optional(),
    ctaText: z.string().optional(),
    parentService: z.string().optional(),
    relatedForm: z.string().optional(),
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
  }),
});

// Expert profiles (23 JSON files)
const experts = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/experts' }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    fonction: z.string().optional(),
    description: z.string().optional(),
    photo: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    linkedin: z.string().optional(),
    facebook: z.string().optional(),
    instagram: z.string().optional(),
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
    // Set to true to keep the JSON (and therefore the /experts/{slug}/ detail
    // page + backlinks) but hide the card from the /experts/ listing.
    hidden: z.boolean().optional(),
    // Rental négociateurs (gestion locative): show only their photo on their
    // listings — no phone, no email, no link to an expert page (Caroline, 08/06).
    // Also excluded from the /experts/ listing.
    listingOnly: z.boolean().optional(),
    // Section the expert appears under on the /experts/ index. One of:
    // "Direction" | "Vente" | "Gestion locative" | "Syndic" | "Contentieux".
    department: z.string().optional(),
    // Manual sort position within a department on the /experts/ index (lower
    // first). Cards without an order keep their default (alphabetical) order
    // after the ordered ones. Caroline's ordering, video review 12/06.
    order: z.number().optional(),
    // Google Calendar appointment-schedule URL — powers the "Réserver un
    // rendez-vous" button on the expert page (Caroline, 11/06).
    agenda: z.string().url().optional(),
    // Arrondissements / zone the expert covers, shown under the role on the
    // expert page (Caroline doc 11/06). E.g. "Marseille Est & Nord : 13011, 13012".
    secteur: z.string().optional(),
  }),
});

// Static pages (32 markdown files)
const pages = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    date: z.string().optional(),
    template: z.string().optional(),
    featuredImage: z.string().optional(),
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
  }),
});

// Arrondissement taxonomy pages (65 JSON files)
const arrondissements = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/arrondissements' }),
  schema: z.object({
    id: z.number(),
    name: z.string(),
    slug: z.string(),
    count: z.number(),
    zipContent: z.string().optional(),
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
  }),
});

// Property listings (5,259 JSON files) — historical data, will move to D1 in Gate 2
const annonces = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/annonces' }),
  schema: z.object({
    id: z.number(),
    title: z.string(),
    slug: z.string(),
    permalink: z.string().optional(),
    status: z.string().optional(),
    date: z.string().optional(),
    referenceAgence: z.string().optional(),
    typeAnnonce: z.string().optional(),
    typeBien: z.string().optional(),
    termine: z.string().optional(),
    adresse: z.string().optional(),
    codePostal: z.string().optional(),
    ville: z.string().optional(),
    quartier: z.string().optional(),
    arrondissement: z.string().optional(),
    coordinates: z.object({ lat: z.number(), lng: z.number() }).optional(),
    prix: z.number().optional(),
    loyerCC: z.number().optional(),
    loyerHT: z.number().optional(),
    charges: z.number().optional(),
    honoraires: z.string().optional(),
    garantie: z.string().optional(),
    surface: z.number().optional(),
    surfaceTerrain: z.number().optional(),
    nbPieces: z.number().optional(),
    nbChambres: z.number().optional(),
    nbSallesBain: z.number().optional(),
    nbSallesEau: z.number().optional(),
    nbWC: z.number().optional(),
    etage: z.string().optional(),
    nbEtages: z.string().optional(),
    meuble: z.boolean().optional(),
    coupDeCoeur: z.boolean().optional(),
    ascenseur: z.boolean().optional(),
    cave: z.boolean().optional(),
    parking: z.string().optional(),
    garage: z.string().optional(),
    terrasse: z.boolean().optional(),
    balcon: z.string().optional(),
    piscine: z.boolean().optional(),
    digicode: z.boolean().optional(),
    interphone: z.boolean().optional(),
    gardien: z.boolean().optional(),
    dpeNote: z.string().optional(),
    dpeValeur: z.string().optional(),
    gesNote: z.string().optional(),
    gesValeur: z.string().optional(),
    typeChauffage: z.string().optional(),
    cuisine: z.string().optional(),
    libelle: z.string().optional(),
    descriptif: z.string().optional(),
    dateDisponibilite: z.string().optional(),
    photos: z.array(z.string()).optional(),
    urlVisiteVirtuelle: z.string().optional(),
    contactAAfficher: z.string().optional(),
    telephoneAAfficher: z.string().optional(),
    emailAAfficher: z.string().optional(),
    taxonomyArrondissement: z.string().optional(),
    taxonomyQuartier: z.string().optional(),
    taxonomyTypeBien: z.string().optional(),
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
  }),
});

export const collections = {
  annonces,
  arrondissements,
  articles,
  services,
  serviceImmobilier,
  experts,
  pages,
};
