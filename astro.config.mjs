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
