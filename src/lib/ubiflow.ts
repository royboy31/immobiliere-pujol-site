// Ubiflow XML feed parser
// Fetches and parses the live Ubiflow XML feed into structured annonce data
// Uses fast-xml-parser (works in Cloudflare Workers, no DOMParser needed)

import { XMLParser } from 'fast-xml-parser';

const UBIFLOW_URL = 'https://sw.ubiflow.net/diffusion-annonces.php?MDP_PARTENAIRE=55a6fc447c0ac5c3840087406768fbc760671110&DIFFUSEUR=IMMOBILIERE_PUJOL&ANNONCEUR=ag132582';

export interface UbiflowAnnonce {
  id: string;
  reference: string;
  titre: string;
  description: string;
  dateSaisie: string;
  contactAAfficher: string;
  emailAAfficher: string;
  telephoneAAfficher: string;
  type: 'V' | 'L';
  prix: number | null;
  prixHorsHonoraires: number | null;
  loyer: number | null;
  loyerCC: number | null;
  charges: number | null;
  depotGarantie: number | null;
  honorairesChargeAcquereur: boolean;
  devise: string;
  libelleType: string;
  codePostal: string;
  adresse: string;
  ville: string;
  quartier: string;
  latitude: number | null;
  longitude: number | null;
  surface: number | null;
  surfaceHabitable: number | null;
  surfaceTerrain: number | null;
  surfaceTerrasse: number | null;
  nbPieces: number | null;
  nbChambres: number | null;
  nbSallesDeBain: number | null;
  nbWC: number | null;
  etage: string;
  nbEtages: string;
  exposition: string;
  cuisine: string;
  typeChauffage: string;
  chauffageEnergie: string;
  ascenseur: boolean;
  terrasse: boolean;
  balcon: boolean;
  garage: boolean;
  parking: boolean;
  cave: boolean;
  interphone: boolean;
  copropriete: boolean;
  chargesCopropriete: number | null;
  alurNbLots: number | null;
  anneeConstruction: string;
  vueSurMer: boolean;
  dpeValeurConso: string;
  dpeEtiquetteConso: string;
  dpeEtiquetteGes: string;
  dpeEstimationMin: string;
  dpeEstimationMax: string;
  dpeValeurGes: string;
  photos: string[];
  visiteVirtuelle: string;
  mandatNumero: string;
  mandatType: string;
  slug: string;
}

function str(val: unknown): string {
  if (val === undefined || val === null) return '';
  return String(val).trim();
}

function num(val: unknown): number | null {
  if (val === undefined || val === null) return null;
  const n = parseFloat(String(val));
  return isNaN(n) ? null : n;
}

function bool(val: unknown): boolean {
  if (val === undefined || val === null) return false;
  const s = String(val).toLowerCase();
  return s === 'true' || s === '1' || s === 'oui';
}

function generateSlug(annonce: Partial<UbiflowAnnonce>): string {
  const parts: string[] = [];
  if (annonce.reference) parts.push(annonce.reference.toLowerCase());
  if (annonce.adresse) parts.push(annonce.adresse);
  if (annonce.codePostal) parts.push(annonce.codePostal);
  if (annonce.ville) parts.push(annonce.ville);

  return parts
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 120);
}

function parseAnnonce(raw: any): UbiflowAnnonce {
  const bien = raw.bien || {};
  const prestation = raw.prestation || {};
  // The Ubiflow feed nests the diagnostics block inside <bien> as
  // <bien><diagnostiques>… (French spelling). Older fixtures used a flat
  // <diagnostics> on the annonce root — accept both for back-compat.
  const diagnostics =
    bien.diagnostiques ||
    raw.diagnostiques ||
    raw.diagnostics ||
    {};

  // Photos can be a single string or an array
  const photosRaw = raw.photos?.photo;
  let photos: string[] = [];
  if (Array.isArray(photosRaw)) {
    photos = photosRaw.map((p: any) => str(p)).filter(Boolean);
  } else if (photosRaw) {
    photos = [str(photosRaw)].filter(Boolean);
  }

  const type = (str(prestation.type) || 'L') as 'V' | 'L';

  const annonce: UbiflowAnnonce = {
    id: str(raw['@_id']),
    reference: str(raw.reference),
    titre: str(raw.titre),
    description: str(raw.texte),
    dateSaisie: str(raw.date_saisie),
    contactAAfficher: str(raw.contact_a_afficher),
    emailAAfficher: str(raw.email_a_afficher),
    telephoneAAfficher: str(raw.telephone_a_afficher),
    type,
    prix: num(prestation.prix),
    prixHorsHonoraires: num(prestation.prix_hors_honoraires),
    loyer: num(prestation.loyer),
    loyerCC: num(prestation.loyer_mensuel_cc) ?? num(prestation.loyer_cc),
    charges: num(prestation.charges),
    depotGarantie: num(prestation.depot_garantie),
    honorairesChargeAcquereur: bool(prestation.honoraires_charge_acquereur),
    devise: str(prestation.devise) || 'EUR',
    libelleType: str(bien.libelle_type),
    codePostal: str(bien.code_postal),
    adresse: str(bien.adresse),
    ville: str(bien.ville),
    quartier: str(bien.quartier),
    latitude: num(bien.latitude),
    longitude: num(bien.longitude),
    surface: num(bien.surface),
    surfaceHabitable: num(bien.surface_habitable),
    surfaceTerrain: num(bien.surface_terrain),
    surfaceTerrasse: num(bien.surface_terrasse),
    nbPieces: num(bien.nb_pieces),
    nbChambres: num(bien.nb_chambres),
    nbSallesDeBain: num(bien.nb_salles_de_bain),
    nbWC: num(bien.nb_wc),
    etage: str(bien.etage),
    nbEtages: str(bien.nb_etages),
    exposition: str(bien.exposition),
    cuisine: str(bien.cuisine) || str(bien.type_cuisine),
    typeChauffage: str(bien.type_chauffage),
    chauffageEnergie: str(bien.chauffage_energie),
    ascenseur: bool(bien.ascenseur),
    terrasse: bool(bien.terrasse),
    balcon: bool(bien.balcon),
    garage: bool(bien.garage),
    parking: bool(bien.parking) || bool(bien.places_parking),
    cave: bool(bien.cave),
    interphone: bool(bien.interphone),
    copropriete: bool(bien.copropriete),
    chargesCopropriete: num(bien.charges_copropriete),
    alurNbLots: num(bien.alur_nb_lots),
    anneeConstruction: str(bien.annee_construction),
    vueSurMer: bool(bien.vue_sur_mer),
    dpeValeurConso: str(diagnostics.dpe_valeur_conso),
    dpeEtiquetteConso: str(diagnostics.dpe_etiquette_conso),
    dpeEtiquetteGes: str(diagnostics.dpe_etiquette_ges),
    dpeEstimationMin: str(diagnostics.dpe_estimation_min),
    dpeEstimationMax: str(diagnostics.dpe_estimation_max),
    dpeValeurGes: str(diagnostics.dpe_valeur_ges),
    photos,
    visiteVirtuelle: str(raw.visite_virtuelle),
    mandatNumero: str(prestation.mandat_numero),
    mandatType: str(prestation.mandat_type),
    slug: '',
  };

  annonce.slug = generateSlug(annonce);
  return annonce;
}

export async function fetchUbiflowAnnonces(): Promise<UbiflowAnnonce[]> {
  const response = await fetch(UBIFLOW_URL);
  if (!response.ok) {
    throw new Error(`Ubiflow fetch failed: ${response.status}`);
  }
  const xml = await response.text();
  return parseUbiflowXml(xml);
}

export function parseUbiflowXml(xml: string): UbiflowAnnonce[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });
  const doc = parser.parse(xml);

  const rawAnnonces = doc?.client?.annonce;
  if (!rawAnnonces) return [];

  const list = Array.isArray(rawAnnonces) ? rawAnnonces : [rawAnnonces];
  return list.map(parseAnnonce);
}

export function formatPrice(annonce: UbiflowAnnonce): string {
  if (annonce.type === 'V' && annonce.prix) {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(annonce.prix);
  }
  if (annonce.type === 'L') {
    const loyer = annonce.loyerCC ?? annonce.loyer;
    if (loyer) {
      return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(loyer) + '/mois';
    }
  }
  return 'Prix sur demande';
}
