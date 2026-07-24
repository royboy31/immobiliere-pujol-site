// Newsletter email templates — the custom deliverable of the newsletter system.
//
// Renders full, email-client-safe HTML documents (tables + inline CSS, 600px,
// no flex/grid) that MATCH the site's existing transactional emails
// (workers/email/index.ts): navy #0f1a2b header/footer, olive #B2C54F accent,
// #eef3ef background, white logo, RGPD notice, address/hours/social footer.
//
// Three templates share one branded shell and vary only the content region:
//   • blog      — 1–3 blog-article cards (posts, latest updates)
//   • listings  — property cards from the live feed (sales, rentals, offers)
//   • broadcast — hero + headline + rich text + one CTA (announcements, offers)
//
// The main app builds the HTML (it has the content + image helpers) and hands it
// to the pujol-email worker, which owns all Brevo calls. The footer carries the
// Brevo {{ unsubscribe }} tag so campaigns get a working one-click unsubscribe.

export type NewsletterTemplate = 'blog' | 'listings' | 'broadcast' | 'mixed';

// ── Brand constants (kept in sync with workers/email/index.ts) ────────────────
const SITE = 'https://www.immobiliere-pujol.fr';
const LOGO = `${SITE}/images/home/pujol-logo-white.png`;
const RGPD_URL = 'https://www.declarations-juridiques.fr/processing-policy/immobiliere-pujol_056808868';
const NAVY = '#0f1a2b';
const OLIVE = '#B2C54F';
const BG = '#eef3ef';
const INK = '#3a3a3a';

const SOCIALS: { href: string; icon: string; alt: string }[] = [
  { href: 'https://www.youtube.com/channel/UCqKIrOqKql-5A7sUsGuIphA', icon: 'youtube-play', alt: 'YouTube' },
  { href: 'https://www.instagram.com/immobiliere_pujol/', icon: 'instagram-new', alt: 'Instagram' },
  { href: 'https://www.facebook.com/immobilierepujol/', icon: 'facebook-new', alt: 'Facebook' },
  { href: 'https://www.linkedin.com/company/immobiliere-pujol/', icon: 'linkedin', alt: 'LinkedIn' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
export function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Absolute image URL for email clients. The site currently serves native raster
// (cfImg passthrough is OFF), so an absolute original URL is safe. Once "Transform
// Images" is live on the zone, flip USE_CDN to route through /cdn-cgi/image with
// format=jpeg for resizing (email clients don't render AVIF).
const USE_CDN = false;
export function emailImg(src: string | undefined | null, width = 600): string {
  const s = (src || '').trim();
  if (!s) return '';
  const abs = s.startsWith('http') ? s : SITE + (s.startsWith('/') ? s : '/' + s);
  if (!USE_CDN) return abs;
  return `${SITE}/cdn-cgi/image/width=${width},quality=80,format=jpeg,onerror=redirect/${abs}`;
}

// A pill CTA button (bulletproof-ish: padded anchor on a rounded cell).
function button(label: string, url: string, opts: { block?: boolean } = {}): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="${opts.block ? '' : 'display:inline-block;'}">
    <tr><td align="center" style="background-color:${NAVY};border-radius:6px">
      <a href="${esc(url)}" style="display:inline-block;padding:12px 26px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:.3px">${esc(label)}</a>
    </td></tr></table>`;
}

// ── Branded shell ─────────────────────────────────────────────────────────────
function renderShell(input: { subject: string; preheader?: string; contentHtml: string }): string {
  const preheader = input.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(input.preheader)}</div>` +
      '​ '.repeat(60)
    : '';
  const social = SOCIALS.map((s) =>
    `<a href="${s.href}" target="_blank" rel="noopener" style="display:inline-block;margin:0 6px;text-decoration:none"><img src="https://img.icons8.com/ios-filled/28/${OLIVE.replace('#', '')}/${s.icon}.png" alt="${s.alt}" width="28" height="28" style="display:block;border:0"></a>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${esc(input.subject)}</title></head>
<body style="margin:0;padding:0;background-color:${BG};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">
  ${preheader}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BG};padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

        <!-- Header -->
        <tr><td style="background-color:${NAVY};padding:20px 32px;border-radius:8px 8px 0 0" align="center">
          <img src="${LOGO}" alt="Immobilière Pujol" width="180" style="display:block;max-width:180px;height:auto">
        </td></tr>
        <!-- Olive accent bar -->
        <tr><td style="background-color:${OLIVE};height:4px;font-size:0;line-height:0">&nbsp;</td></tr>

        <!-- Content -->
        <tr><td style="background-color:#ffffff;padding:32px 32px 8px">
          ${input.contentHtml}
        </td></tr>

        <!-- RGPD + unsubscribe -->
        <tr><td style="background-color:#ffffff;padding:8px 32px 16px">
          <hr style="border:none;border-top:1px solid ${BG};margin:0 0 10px">
          <p style="margin:0 0 8px;font-size:11px;color:#8a8a8a;line-height:1.5">
            Vous recevez cet email car vous êtes inscrit(e) à la newsletter de l'Immobilière Pujol.
            <a href="{{ unsubscribe }}" style="color:#8a8a8a;text-decoration:underline">Se désinscrire</a>.
          </p>
          <p style="margin:0;font-size:9px;color:#aaa;line-height:1.3">
            Dans le cadre de nos activités, nous traitons vos données à caractère personnel dans le respect du RGPD et de la loi n°78-17 du 6 janvier 1978. Voir notre <a href="${RGPD_URL}" style="color:#aaa;text-decoration:underline">politique de traitement des données</a>. Pour toute question&nbsp;: <a href="mailto:rgpd@immobiliere-pujol.fr" style="color:#aaa;text-decoration:underline">rgpd@immobiliere-pujol.fr</a>.
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background-color:${NAVY};padding:28px 32px;border-radius:0 0 8px 8px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="vertical-align:top;padding-right:16px" width="50%">
                <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#ffffff">Immobilière Pujol</p>
                <p style="margin:0;font-size:13px;color:#ffffff;line-height:1.7">7 rue du Docteur Fiolle<br>13006 Marseille</p>
                <p style="margin:12px 0 0;font-size:13px;color:#ffffff;line-height:1.7">
                  <strong>Site</strong> <a href="${SITE}" style="color:#ffffff!important;text-decoration:none!important"><span style="color:#ffffff!important">www.immobiliere-pujol.fr</span></a><br>
                  <a href="${SITE}/contact-immobiliere-pujol/" style="color:#ffffff!important;text-decoration:underline!important"><span style="color:#ffffff!important">Contactez-nous</span></a>
                </p>
              </td>
              <td style="vertical-align:top" width="50%">
                <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#ffffff">Horaires</p>
                <p style="margin:0;font-size:13px;color:#ffffff;line-height:1.7">Lundi – Jeudi<br>9h – 12h / 14h – 18h<br><br>Vendredi<br>9h – 12h / 14h – 17h</p>
              </td>
            </tr>
          </table>
          <hr style="border:none;border-top:1px solid #2a3a4b;margin:20px 0">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center" style="padding-bottom:16px">${social}</td></tr>
            <tr><td align="center"><p style="margin:0;font-size:12px;color:#ffffff;opacity:0.7;line-height:1.5">Vente, location, gestion locative et syndic de copropriété.</p></td></tr>
          </table>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// A light rich-text block (intro/outro/body). The composer sanitizes input to a
// small tag allowlist; here we just wrap it in the email body typography.
function richText(html: string | undefined): string {
  const h = (html || '').trim();
  if (!h) return '';
  return `<div style="font-size:14px;color:${INK};line-height:1.7">${h}</div>`;
}

function sectionTitle(text: string): string {
  return `<p style="margin:0 0 4px;font-size:15px;font-weight:700;color:${NAVY};text-transform:uppercase;letter-spacing:.8px"><span style="border-bottom:2px solid ${OLIVE};padding-bottom:4px">${esc(text)}</span></p>`;
}

// ── Template A: blog / actualités ────────────────────────────────────────────
export interface NewsletterArticle {
  title: string;
  url: string;
  excerpt?: string;
  imageUrl?: string;
}
export interface BlogInput {
  subject: string;
  preheader?: string;
  heading?: string;
  intro?: string;
  outro?: string;
  articles: NewsletterArticle[]; // 1..3
}
// A single blog-article card — shared by the blog and mixed templates.
function articleCard(a: NewsletterArticle): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border:1px solid ${BG};border-radius:8px;overflow:hidden">
      ${a.imageUrl ? `<tr><td><a href="${esc(a.url)}"><img src="${esc(emailImg(a.imageUrl, 600))}" alt="${esc(a.title)}" width="600" style="display:block;width:100%;max-width:600px;height:auto"></a></td></tr>` : ''}
      <tr><td style="padding:18px 20px 20px">
        <h2 style="margin:0 0 8px;font-size:18px;line-height:1.35;color:${NAVY};font-weight:700"><a href="${esc(a.url)}" style="color:${NAVY};text-decoration:none">${esc(a.title)}</a></h2>
        ${a.excerpt ? `<p style="margin:0 0 16px;font-size:14px;color:${INK};line-height:1.6">${esc(a.excerpt)}</p>` : ''}
        ${button("Lire l'article", a.url)}
      </td></tr>
    </table>`;
}
export function renderBlog(input: BlogInput): string {
  const cards = input.articles.map(articleCard).join('');

  const content = `
    ${input.heading ? `<h1 style="margin:0 0 6px;font-size:22px;line-height:1.3;color:${NAVY};font-weight:700">${esc(input.heading)}</h1>` : ''}
    ${richText(input.intro)}
    <div style="height:20px;font-size:0;line-height:0">&nbsp;</div>
    ${cards}
    ${input.outro ? `<div style="height:4px;font-size:0;line-height:0">&nbsp;</div>${richText(input.outro)}` : ''}`;

  return renderShell({ subject: input.subject, preheader: input.preheader, contentHtml: content });
}

// ── Template B: listings / sélection de biens ─────────────────────────────────
export interface NewsletterListing {
  title: string;
  url: string;
  price: string;        // preformatted, e.g. "320 000 €" or "980 €/mois"
  city?: string;
  postalCode?: string;
  surface?: number | null;
  rooms?: number | null;
  imageUrl?: string;
  kind?: 'V' | 'L';     // vente / location — drives the badge
}
export interface ListingsInput {
  subject: string;
  preheader?: string;
  heading?: string;
  intro?: string;
  outro?: string;
  kind?: 'V' | 'L' | 'mixte';
  listings: NewsletterListing[]; // 1..6
}
function listingBadge(kind: 'V' | 'L' | undefined): string {
  const label = kind === 'V' ? 'À vendre' : kind === 'L' ? 'À louer' : '';
  if (!label) return '';
  return `<span style="display:inline-block;background-color:${OLIVE};color:${NAVY};font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;padding:3px 8px;border-radius:3px">${label}</span>`;
}
// A single property-listing card — shared by the listings and mixed templates.
function listingCard(l: NewsletterListing): string {
  const facts = [
    l.surface ? `${l.surface} m²` : '',
    l.rooms ? `${l.rooms} pièce${l.rooms > 1 ? 's' : ''}` : '',
    [l.postalCode, l.city].filter(Boolean).join(' '),
  ].filter(Boolean).join(' · ');
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border:1px solid ${BG};border-radius:8px;overflow:hidden">
      ${l.imageUrl ? `<tr><td><a href="${esc(l.url)}"><img src="${esc(emailImg(l.imageUrl, 600))}" alt="${esc(l.title)}" width="600" style="display:block;width:100%;max-width:600px;height:auto"></a></td></tr>` : ''}
      <tr><td style="padding:16px 20px 18px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:middle">${listingBadge(l.kind)}</td>
          <td style="vertical-align:middle;text-align:right"><span style="font-size:18px;font-weight:700;color:${NAVY}">${esc(l.price)}</span></td>
        </tr></table>
        <h2 style="margin:10px 0 4px;font-size:16px;line-height:1.35;color:${NAVY};font-weight:700"><a href="${esc(l.url)}" style="color:${NAVY};text-decoration:none">${esc(l.title)}</a></h2>
        ${facts ? `<p style="margin:0 0 14px;font-size:13px;color:#6a747c">${esc(facts)}</p>` : ''}
        ${button('Voir le bien', l.url)}
      </td></tr>
    </table>`;
}

// The "see all listings" CTA that closes any listing section.
function allListingsCta(): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 4px">
      ${button('Voir toutes nos annonces', `${SITE}/annonces/`, { block: true })}
    </td></tr></table>`;
}

export function renderListings(input: ListingsInput): string {
  const cards = input.listings.map(listingCard).join('');

  const content = `
    ${input.heading ? `<h1 style="margin:0 0 6px;font-size:22px;line-height:1.3;color:${NAVY};font-weight:700">${esc(input.heading)}</h1>` : ''}
    ${richText(input.intro)}
    <div style="height:20px;font-size:0;line-height:0">&nbsp;</div>
    ${cards}
    <div style="height:6px;font-size:0;line-height:0">&nbsp;</div>
    ${allListingsCta()}
    ${input.outro ? richText(input.outro) : ''}`;

  return renderShell({ subject: input.subject, preheader: input.preheader, contentHtml: content });
}

// ── Template C: broadcast / message & offre ───────────────────────────────────
export interface BroadcastInput {
  subject: string;
  preheader?: string;
  heroImage?: string;
  heading: string;
  body?: string;         // rich text
  ctaLabel?: string;
  ctaUrl?: string;
  expert?: { name: string; role?: string; photo?: string; phone?: string; email?: string }; // optional contact card
}
export function renderBroadcast(input: BroadcastInput): string {
  const cta = input.ctaLabel && input.ctaUrl
    ? `<div style="height:22px;font-size:0;line-height:0">&nbsp;</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">${button(input.ctaLabel, input.ctaUrl, { block: true })}</td></tr></table>`
    : '';
  const expert = input.expert
    ? `<div style="height:24px;font-size:0;line-height:0">&nbsp;</div>
       <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BG};border-radius:8px"><tr>
         ${input.expert.photo ? `<td width="90" style="padding:14px 0 14px 16px;vertical-align:middle"><img src="${esc(emailImg(input.expert.photo, 160))}" alt="${esc(input.expert.name)}" width="72" style="display:block;width:72px;height:auto;border-radius:6px"></td>` : ''}
         <td style="padding:14px 16px;vertical-align:middle">
           <p style="margin:0;font-size:15px;font-weight:700;color:${NAVY}">${esc(input.expert.name)}</p>
           ${input.expert.role ? `<p style="margin:2px 0 0;font-size:13px;color:#6a747c">${esc(input.expert.role)}</p>` : ''}
           <p style="margin:8px 0 0;font-size:13px;color:${INK}">
             ${input.expert.phone ? `<a href="tel:${esc(input.expert.phone.replace(/\s/g, ''))}" style="color:${NAVY};text-decoration:none">${esc(input.expert.phone)}</a>` : ''}
             ${input.expert.phone && input.expert.email ? ' · ' : ''}
             ${input.expert.email ? `<a href="mailto:${esc(input.expert.email)}" style="color:${NAVY};text-decoration:none">${esc(input.expert.email)}</a>` : ''}
           </p>
         </td>
       </tr></table>`
    : '';

  const content = `
    ${input.heroImage ? `<img src="${esc(emailImg(input.heroImage, 600))}" alt="${esc(input.heading)}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border-radius:8px;margin:0 0 24px"><div style="font-size:0;line-height:0">&nbsp;</div>` : ''}
    <h1 style="margin:0 0 12px;font-size:24px;line-height:1.3;color:${NAVY};font-weight:700">${esc(input.heading)}</h1>
    ${richText(input.body)}
    ${cta}
    ${expert}`;

  return renderShell({ subject: input.subject, preheader: input.preheader, contentHtml: content });
}

// ── Template D: mixed / sélection mixte ───────────────────────────────────────
// A single email that can carry blog articles AND/OR property listings — either
// section is optional (empty articles = a listings-only email, the old template B
// behaviour). Replaces "Sélection de biens" in the composer; renderListings is
// kept for campaigns already stored with template 'listings'.
export interface MixedInput {
  subject: string;
  preheader?: string;
  heading?: string;
  intro?: string;
  outro?: string;
  kind?: 'V' | 'L' | 'mixte'; // kept for parity with the listings picker
  articles: NewsletterArticle[]; // 0..3
  listings: NewsletterListing[]; // 0..4
  listingsTitle?: string;    // section heading for the biens block (defaults to "Nos biens à la une")
  listingsSubtitle?: string; // optional line under the section heading
}
export function renderMixed(input: MixedInput): string {
  const articles = input.articles || [];
  const listings = input.listings || [];
  const articleCards = articles.map(articleCard).join('');
  const listingCards = listings.map(listingCard).join('');

  const articleSection = articles.length
    ? `${sectionTitle('Actualités')}
       <div style="height:14px;font-size:0;line-height:0">&nbsp;</div>
       ${articleCards}`
    : '';
  const listingSection = listings.length
    ? `${articles.length ? '<div style="height:8px;font-size:0;line-height:0">&nbsp;</div>' : ''}
       ${sectionTitle(input.listingsTitle || 'Nos biens à la une')}
       ${input.listingsSubtitle ? `<p style="margin:6px 0 0;font-size:14px;color:${INK};line-height:1.5">${esc(input.listingsSubtitle)}</p>` : ''}
       <div style="height:14px;font-size:0;line-height:0">&nbsp;</div>
       ${listingCards}
       <div style="height:6px;font-size:0;line-height:0">&nbsp;</div>
       ${allListingsCta()}`
    : '';

  const content = `
    ${input.heading ? `<h1 style="margin:0 0 6px;font-size:22px;line-height:1.3;color:${NAVY};font-weight:700">${esc(input.heading)}</h1>` : ''}
    ${richText(input.intro)}
    <div style="height:20px;font-size:0;line-height:0">&nbsp;</div>
    ${articleSection}
    ${listingSection}
    ${input.outro ? `<div style="height:8px;font-size:0;line-height:0">&nbsp;</div>${richText(input.outro)}` : ''}`;

  return renderShell({ subject: input.subject, preheader: input.preheader, contentHtml: content });
}

// ── Dispatcher ────────────────────────────────────────────────────────────────
export function renderNewsletter(template: NewsletterTemplate, data: any): string {
  switch (template) {
    case 'listings':  return renderListings(data as ListingsInput);
    case 'broadcast': return renderBroadcast(data as BroadcastInput);
    case 'mixed':     return renderMixed(data as MixedInput);
    case 'blog':
    default:          return renderBlog(data as BlogInput);
  }
}
