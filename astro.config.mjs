// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  site: 'https://www.immobiliere-pujol.fr',
  integrations: [react()],
  adapter: cloudflare({
    imageService: 'passthrough',
  }),
  // Astro 6: output defaults to 'static'. SSR pages opt-in with `export const prerender = false`
  // Annonce pages will use SSR (prerender = false), everything else is static.
  trailingSlash: 'always',
  server: { host: true },
  // Legacy 301 redirects preserved from live WP (checked against live host).
  redirects: {
    '/blog/': '/blog-immobilier-marseille/',
    '/contact/': '/contact-immobiliere-pujol/',
    '/a-propos/': '/services/a-propos-de-limmobiliere-pujol/',
    '/location/': '/location-courte-duree-quelle-sont-les-regles-a-respecter/',
    '/syndic/': '/syndic-de-copro-ecologie/',
    '/gestion/': '/local/gestion-dappartement-a-carpiagne-13009-marseille/',
    // Singular `/service/...` was used in some legacy WP links — forward
    // each known slug to the canonical plural `/services/...`. The dynamic
    // form (`/service/[slug]`) makes Astro pull the whole content layer into
    // the worker bundle, blowing past the Cloudflare 3 MiB Worker-size limit,
    // so the URLs are listed explicitly instead.
    '/service/a-propos-de-limmobiliere-pujol/': '/services/a-propos-de-limmobiliere-pujol/',
    '/service/agence-location-appartement-marseille/': '/services/agence-location-appartement-marseille/',
    '/service/ce-que-nous-ferons-pour-louer-rapidement-votre-appartement/': '/services/ce-que-nous-ferons-pour-louer-rapidement-votre-appartement/',
    '/service/choisir-son-agence-immobiliere/': '/services/choisir-son-agence-immobiliere/',
    '/service/combien-coute-syndic-copropriete/': '/services/combien-coute-syndic-copropriete/',
    '/service/comment-calculer-le-cout-de-gestion-de-copropriete/': '/services/comment-calculer-le-cout-de-gestion-de-copropriete/',
    '/service/comment-changer-de-syndic-a-marseille/': '/services/comment-changer-de-syndic-a-marseille/',
    '/service/comment-choisir-son-locataire-pour-une-gestion-immobiliere-sans-risque/': '/services/comment-choisir-son-locataire-pour-une-gestion-immobiliere-sans-risque/',
    '/service/comment-faire-baisser-le-cout-un-syndic-a-marseillle/': '/services/comment-faire-baisser-le-cout-un-syndic-a-marseillle/',
    '/service/comment-nous-estimons-le-prix-de-votre-loyer-sur-marseille/': '/services/comment-nous-estimons-le-prix-de-votre-loyer-sur-marseille/',
    '/service/comment-verifier-la-solvabilite-lors-dune-location-a-marseille/': '/services/comment-verifier-la-solvabilite-lors-dune-location-a-marseille/',
    '/service/connaitres-les-qualites-requises-pour-le-metier-de-gestionnaire-syndic/': '/services/connaitres-les-qualites-requises-pour-le-metier-de-gestionnaire-syndic/',
    '/service/contrat-de-syndic-de-limmobiliere-pujol/': '/services/contrat-de-syndic-de-limmobiliere-pujol/',
    '/service/definition-de-syndic-professionnel-le-gestionnaire-de-copropriete-a-marseille/': '/services/definition-de-syndic-professionnel-le-gestionnaire-de-copropriete-a-marseille/',
    '/service/definition-dun-bon-service-de-syndic-a-marseille/': '/services/definition-dun-bon-service-de-syndic-a-marseille/',
    '/service/demander-une-estimation-de-prix-de-vente/': '/services/demander-une-estimation-de-prix-de-vente/',
    '/service/demander-une-estimation-du-loyer-de-votre-appartement-sur-marseille/': '/services/demander-une-estimation-du-loyer-de-votre-appartement-sur-marseille/',
    '/service/devis-gestion-locative-marseille/': '/services/devis-gestion-locative-marseille/',
    '/service/estimer-votre-loyer/': '/services/estimer-votre-loyer/',
    '/service/la-securite-dans-le-choix-des-locataires-des-contrats-et-des-actes/': '/services/la-securite-dans-le-choix-des-locataires-des-contrats-et-des-actes/',
    '/service/le-cout-de-la-gestion-locative/': '/services/le-cout-de-la-gestion-locative/',
    '/service/le-cout-des-travaux-la-mise-en-concurrence-et-levaluation-de-nos-prestataires-dans-nos-coproprietes/': '/services/le-cout-des-travaux-la-mise-en-concurrence-et-levaluation-de-nos-prestataires-dans-nos-coproprietes/',
    '/service/les-contrats-a-renegocier-des-economies-toujours-possibles-faites-baisser-vos-charges/': '/services/les-contrats-a-renegocier-des-economies-toujours-possibles-faites-baisser-vos-charges/',
    '/service/nos-resultats-en-termes-de-location-dappartements-a-marseille-et-de-prix/': '/services/nos-resultats-en-termes-de-location-dappartements-a-marseille-et-de-prix/',
    '/service/nos-resultats-en-vente/': '/services/nos-resultats-en-vente/',
    '/service/notre-garantie-de-loyers-impayes/': '/services/notre-garantie-de-loyers-impayes/',
    '/service/notre-offre-dassurance-loyers-impayes-pno-vacances-locatives/': '/services/notre-offre-dassurance-loyers-impayes-pno-vacances-locatives/',
    '/service/pourquoi-nous-faisons-ce-metier/': '/services/pourquoi-nous-faisons-ce-metier/',
    '/service/quelles-charges-de-copropriete-sont-a-payer-sur-marseille/': '/services/quelles-charges-de-copropriete-sont-a-payer-sur-marseille/',
    '/service/si-vous-souhaitez-nous-confier-uniquement-la-location-de-votre-appartement/': '/services/si-vous-souhaitez-nous-confier-uniquement-la-location-de-votre-appartement/',
    '/service/un-audit-des-charges-de-votre-copropriete-et-de-ses-contrats/': '/services/un-audit-des-charges-de-votre-copropriete-et-de-ses-contrats/',
  },
  vite: {
    css: {
      preprocessorOptions: {
        scss: {
          // Auto-import variables into every SCSS file (except theme.scss which imports them itself)
          additionalData: (source, filename) => {
            if (filename.endsWith('theme.scss')) return source;
            return `@use "src/styles/base/variables" as *;\n${source}`;
          },
        },
      },
    },
  },
});
