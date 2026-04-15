import { defineCollection, z } from 'astro:content';

// Property listing schema — based on 80-field WP All Import mapping
const annonces = defineCollection({
  type: 'data',
  schema: z.object({
    // Identity
    id: z.number(),
    title: z.string(),
    slug: z.string(),
    permalink: z.string(),
    status: z.enum(['publish', 'draft', 'pending', 'closed']).default('publish'),
    date: z.string(),

    // Property classification
    referenceAgence: z.string(), // wpcf-reference-agence (unique key)
    typeAnnonce: z.enum(['L', 'V']).optional(), // L=Location, V=Vente
    typeBien: z.string().optional(), // wpcf-type-bien
    termine: z.enum(['Terminé', 'Ouverte']).optional(), // active vs closed listing

    // Location
    adresse: z.string().optional(), // wpcf-property-location
    codePostal: z.string().optional(), // wpcf-code-post
    ville: z.string().optional(), // wpcf-ville
    quartier: z.string().optional(), // wpcf-quartier-proximite
    arrondissement: z.string().optional(),
    coordinates: z.object({
      lat: z.number(),
      lng: z.number(),
    }).optional(),

    // Pricing
    prix: z.number().optional(), // wpcf-property-price (sale)
    loyerCC: z.number().optional(), // wpcf-loyer-cc (rent incl. charges)
    loyerHT: z.number().optional(), // wpcf-loyer-ht (rent excl. charges)
    charges: z.number().optional(), // wpcf-property-charges
    honoraires: z.string().optional(), // wpcf-honoraires
    garantie: z.string().optional(), // wpcf-property-garantie

    // Property details
    surface: z.number().optional(), // wpcf-property-size
    surfaceTerrain: z.number().optional(), // wpcf-surface-terrain
    nbPieces: z.number().optional(), // wpcf-property-allrooms
    nbChambres: z.number().optional(), // wpcf-property-bedrooms
    nbSallesBain: z.number().optional(),
    nbSallesEau: z.number().optional(),
    nbWC: z.number().optional(),
    etage: z.string().optional(), // wpcf-etage
    nbEtages: z.string().optional(), // wpcf-nb-etages

    // Features
    meuble: z.boolean().optional(), // wpcf-meuble
    coupDeCoeur: z.boolean().optional(), // wpcf-coup-de-coeur
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

    // Energy
    dpeNote: z.string().optional(), // wpcf-energy (A-G)
    dpeValeur: z.string().optional(), // wpcf-consommation-energie
    gesNote: z.string().optional(), // wpcf-bilan-emission-ges (A-G)
    gesValeur: z.string().optional(), // wpcf-emissions-ges1
    typeChauffage: z.string().optional(), // wpcf-type-de-chauffage
    cuisine: z.string().optional(),

    // Content
    libelle: z.string().optional(), // wpcf-libelle (label/title)
    descriptif: z.string().optional(), // wpcf-descriptif (HTML description)
    dateDisponibilite: z.string().optional(),

    // Media
    photos: z.array(z.string()).optional(), // wpcf-photo-1 through 9
    urlVisiteVirtuelle: z.string().optional(),

    // Contact
    contactAAfficher: z.string().optional(),
    telephoneAAfficher: z.string().optional(),
    emailAAfficher: z.string().optional(),

    // Taxonomies
    taxonomyArrondissement: z.string().optional(),
    taxonomyQuartier: z.string().optional(),
    taxonomyTypeBien: z.string().optional(),

    // SEO
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
  }),
});

// Blog articles
const articles = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    date: z.string(),
    excerpt: z.string().optional(),
    categories: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    featuredImage: z.string().optional(),
    author: z.string().optional(),
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
  }),
});

// Service pages
const services = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    subtitle: z.string().optional(),
    heroVideo: z.string().optional(),
    featuredImage: z.string().optional(),
    relatedForm: z.string().optional(), // Gravity Form ID
    formTitle: z.string().optional(),
    formSubtitle: z.string().optional(),
    btnText: z.string().optional(),
    taxonomy: z.string().optional(), // pujol_services
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
  }),
});

// Expert profiles
const experts = defineCollection({
  type: 'data',
  schema: z.object({
    title: z.string(), // Full name
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

// Static pages
const pages = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    template: z.string().optional(),
    featuredImage: z.string().optional(),
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
  }),
});

export const collections = {
  annonces,
  articles,
  services,
  experts,
  pages,
};
