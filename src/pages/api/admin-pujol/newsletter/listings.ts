// GET /api/admin-pujol/newsletter/listings?kind=V|L&limit=40  (guarded)
// Feeds the listings-template property picker from the LIVE Ubiflow feed (active
// biens only — you never feature a sold/closed listing). Returns a light card
// shape; the composer auto-suggests a default set that the admin can then edit.
export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-guard';
import { fetchUbiflowAnnonces, formatPrice, type UbiflowAnnonce } from '../../../../lib/ubiflow';

const SITE = 'https://www.immobiliere-pujol.fr';

// Garages/parking/box are excluded (same rule as expert pages: LBI slug prefix).
const isGarage = (s: string | undefined | null) => /^lj[vl]ga/i.test(s || '');

function cardTitle(a: UbiflowAnnonce): string {
  const bits = [
    a.libelleType || (a.type === 'V' ? 'Bien à vendre' : 'Bien à louer'),
    a.nbPieces ? `${a.nbPieces} pièce${a.nbPieces > 1 ? 's' : ''}` : '',
    a.ville ? `— ${a.ville}` : '',
  ].filter(Boolean);
  return bits.join(' ');
}

export const GET: APIRoute = async ({ request, url }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });

  const kind = (url.searchParams.get('kind') || '').toUpperCase(); // V | L | ''
  const limit = Math.min(Number(url.searchParams.get('limit')) || 40, 100);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();

  let annonces: UbiflowAnnonce[] = [];
  try {
    annonces = await fetchUbiflowAnnonces();
  } catch (e) {
    return Response.json({ error: 'Flux annonces indisponible', items: [] }, { status: 502 });
  }

  let items = annonces
    .filter((a) => !isGarage(a.slug))
    .filter((a) => (kind === 'V' || kind === 'L' ? a.type === kind : true))
    .map((a) => ({
      slug: a.slug,
      title: cardTitle(a),
      price: formatPrice(a),
      city: a.ville || '',
      postalCode: a.codePostal || '',
      surface: a.surface ?? a.surfaceHabitable ?? null,
      rooms: a.nbPieces ?? null,
      imageUrl: (a.photos && a.photos[0]) || '',
      kind: a.type,
      url: `${SITE}/annonces/${a.slug}/`,
    }));

  if (q) items = items.filter((l) => `${l.title} ${l.city} ${l.postalCode}`.toLowerCase().includes(q));
  return Response.json({ items: items.slice(0, limit) });
};
