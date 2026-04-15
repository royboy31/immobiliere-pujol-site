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
  articles,
  services,
  serviceImmobilier,
  experts,
  pages,
};
