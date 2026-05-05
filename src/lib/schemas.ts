// JSON-LD schema builders. Each returns a plain object ready to be JSON.stringified.

const SITE_URL = 'https://www.immobiliere-pujol.fr';
const LOGO_URL = 'https://pub-a37eed540afe4dc9b4479da74ba265e1.r2.dev/2017/01/logo-immobilier-Pujol-h-RVB-300x90.jpg';
const PUBLISHER_NAME = 'Agence Immobilière Pujol';

const SAME_AS = [
  'https://www.facebook.com/immobilierepujol/',
  'https://www.instagram.com/immobiliere_pujol/',
  'https://www.linkedin.com/company/immobiliere-pujol/',
  'https://www.youtube.com/channel/UCqKIrOqKql-5A7sUsGuIphA',
];

// Opening hours — mirrored from the live schema.
// Agency is open Tue–Sat, mornings 9–12, afternoons 14–18 (shorter on Fri/Sat).
const OPENING_HOURS = [
  { day: 'Tuesday',  opens: '09:00', closes: '12:00' },
  { day: 'Tuesday',  opens: '14:00', closes: '18:00' },
  { day: 'Wednesday', opens: '09:00', closes: '12:00' },
  { day: 'Wednesday', opens: '14:00', closes: '18:00' },
  { day: 'Thursday',  opens: '09:00', closes: '12:00' },
  { day: 'Thursday',  opens: '14:00', closes: '18:00' },
  { day: 'Friday',    opens: '09:00', closes: '12:00' },
  { day: 'Friday',    opens: '14:00', closes: '17:00' },
  { day: 'Saturday',  opens: '09:00', closes: '12:00' },
];

export function buildRealEstateAgent() {
  return {
    '@context': 'https://schema.org',
    '@type': 'RealEstateAgent',
    '@id': `${SITE_URL}/#organization`,
    name: PUBLISHER_NAME,
    alternateName: 'Immobilière Pujol',
    url: SITE_URL,
    image: LOGO_URL,
    logo: LOGO_URL,
    telephone: '+33491373839',
    email: 'contact@immobiliere-pujol.fr',
    priceRange: '€-€€€',
    address: {
      '@type': 'PostalAddress',
      streetAddress: '7 rue du Dr Fiolle',
      addressLocality: 'Marseille',
      addressRegion: "Provence-Alpes-Côte d'Azur",
      postalCode: '13006',
      addressCountry: 'FR',
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: 43.2850383,
      longitude: 5.3833784,
    },
    openingHoursSpecification: OPENING_HOURS.map((h) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: `https://schema.org/${h.day}`,
      opens: `${h.opens}:00`,
      closes: `${h.closes}:00`,
    })),
    sameAs: SAME_AS,
  };
}

export function buildWebSite() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    name: 'Immobilière Pujol',
    alternateName: 'Immobilière Pujol',
    description: "Le site de l'agence immobilière Pujol à Marseille",
    url: SITE_URL,
    publisher: { '@id': `${SITE_URL}/#organization` },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/?s={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
    inLanguage: 'fr-FR',
  };
}

export function buildOrganization() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: PUBLISHER_NAME,
    url: SITE_URL,
    logo: {
      '@type': 'ImageObject',
      url: LOGO_URL,
    },
    sameAs: SAME_AS,
  };
}

interface ArticleLike {
  title: string;
  slug: string;
  date?: string;
  excerpt?: string;
  featuredImage?: string;
  author?: string;
  seoDescription?: string;
}

export function buildArticle(entry: ArticleLike, pageUrl: string) {
  const author = entry.author || 'Stéphane Pujol';
  const authorSlug = author.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .replace(/^-|-$/g, '');
  const description = (entry.seoDescription || entry.excerpt || entry.title).slice(0, 250);
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    mainEntityOfPage: { '@type': 'WebPage', '@id': pageUrl },
    headline: entry.title.slice(0, 110),
    description,
    ...(entry.date ? { datePublished: entry.date, dateModified: entry.date } : {}),
    ...(entry.featuredImage ? {
      image: {
        '@type': 'ImageObject',
        url: entry.featuredImage,
      },
    } : {}),
    author: {
      '@type': 'Person',
      name: author,
      url: `${SITE_URL}/author/${authorSlug}/`,
    },
    publisher: {
      '@type': 'Organization',
      name: PUBLISHER_NAME,
      logo: { '@type': 'ImageObject', url: LOGO_URL },
    },
    inLanguage: 'fr-FR',
  };
}

interface BreadcrumbItem { name: string; url: string; }

export function buildBreadcrumb(items: BreadcrumbItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  };
}

/** Auto-generate a sensible breadcrumb from a path. Falls back to "Accueil → <Last segment>". */
export function autoBreadcrumb(pathname: string, pageTitle: string) {
  const segs = pathname.replace(/^\/|\/$/g, '').split('/').filter(Boolean);
  if (segs.length === 0) return null;
  const items: BreadcrumbItem[] = [{ name: 'Accueil', url: SITE_URL + '/' }];
  let acc = '';
  for (let i = 0; i < segs.length - 1; i++) {
    acc += '/' + segs[i];
    const name = segs[i]
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
    items.push({ name, url: SITE_URL + acc + '/' });
  }
  items.push({ name: pageTitle, url: SITE_URL + pathname });
  return buildBreadcrumb(items);
}

/**
 * LocalBusiness schema for /local/{slug}/ pages. These pages target a specific
 * neighborhood. We emit a LocalBusiness variant that names the quartier + CP
 * so Google treats each page as a local service-area entity.
 */
export function buildLocalBusiness(opts: {
  pageUrl: string;
  pageTitle: string;
  slug: string;  // e.g. 'local/administrateur-de-bien-a-endoume-13007-marseille'
}) {
  // Parse the slug to extract neighborhood + postcode.
  const tail = opts.slug.replace(/^local\//, '');
  const cpMatch = tail.match(/-(1300[1-9]|1301[0-6])-/) || tail.match(/-(1300[1-9]|1301[0-6])$/);
  const postalCode = cpMatch ? cpMatch[1] : '';
  // Neighborhood = slug tokens between the service phrase and the CP.
  // Pattern examples:
  //   administrateur-de-bien-a-endoume-13007-marseille
  //   gestion-dappartement-a-carpiagne-13009-marseille
  let neighborhood = '';
  const beforeCp = postalCode ? tail.split('-' + postalCode + '-')[0] : tail;
  const parts = beforeCp.split('-a-');
  if (parts.length >= 2) {
    neighborhood = parts[1].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': opts.pageUrl + '#localbusiness',
    name: `Immobilière Pujol — ${neighborhood || 'Marseille'}${postalCode ? ' (' + postalCode + ')' : ''}`,
    description: opts.pageTitle,
    url: opts.pageUrl,
    image: LOGO_URL,
    telephone: '+33491373839',
    email: 'contact@immobiliere-pujol.fr',
    priceRange: '€-€€€',
    address: {
      '@type': 'PostalAddress',
      streetAddress: '7 rue du Dr Fiolle',
      addressLocality: 'Marseille',
      addressRegion: "Provence-Alpes-Côte d'Azur",
      postalCode: '13006',
      addressCountry: 'FR',
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: 43.2850383,
      longitude: 5.3833784,
    },
    ...(neighborhood || postalCode ? {
      areaServed: {
        '@type': 'Place',
        name: [neighborhood, postalCode ? `Marseille ${postalCode}` : 'Marseille'].filter(Boolean).join(', '),
        ...(postalCode ? {
          address: {
            '@type': 'PostalAddress',
            addressLocality: 'Marseille',
            postalCode,
            addressCountry: 'FR',
          },
        } : {}),
      },
    } : {}),
    openingHoursSpecification: OPENING_HOURS.map((h) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: `https://schema.org/${h.day}`,
      opens: `${h.opens}:00`,
      closes: `${h.closes}:00`,
    })),
    sameAs: SAME_AS,
  };
}

export interface AnnonceForSchema {
  titre: string;
  description: string;
  slug: string;
  type: 'V' | 'L' | string;
  prix?: number | null;
  loyerCC?: number | null;
  surface?: number | null;
  nbPieces?: number | null;
  adresse?: string;
  codePostal?: string;
  ville?: string;
  photos?: string[];
}

export function buildRealEstateListing(a: AnnonceForSchema, pageUrl: string) {
  const isSale = a.type === 'V';
  const price = isSale ? a.prix : (a.loyerCC ?? a.prix);
  const offer = price ? {
    '@type': 'Offer',
    price: price,
    priceCurrency: 'EUR',
    availability: 'https://schema.org/InStock',
    ...(isSale ? {} : {
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        price,
        priceCurrency: 'EUR',
        unitText: 'MON',
      },
    }),
  } : null;

  return {
    '@context': 'https://schema.org',
    '@type': isSale ? 'Product' : 'Accommodation',
    '@id': pageUrl,
    name: a.titre,
    description: (a.description || a.titre).slice(0, 500),
    url: pageUrl,
    ...(a.photos && a.photos.length ? { image: a.photos.slice(0, 6) } : {}),
    ...(a.surface ? { floorSize: { '@type': 'QuantitativeValue', value: a.surface, unitCode: 'MTK' } } : {}),
    ...(a.nbPieces ? { numberOfRooms: a.nbPieces } : {}),
    ...((a.adresse || a.codePostal || a.ville) ? {
      address: {
        '@type': 'PostalAddress',
        ...(a.adresse ? { streetAddress: a.adresse } : {}),
        ...(a.ville ? { addressLocality: a.ville } : {}),
        ...(a.codePostal ? { postalCode: a.codePostal } : {}),
        addressCountry: 'FR',
      },
    } : {}),
    ...(offer ? { offers: offer } : {}),
    brand: { '@type': 'Organization', name: PUBLISHER_NAME },
  };
}
