// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  site: 'https://www.immobiliere-pujol.fr',
  integrations: [react()],
  adapter: cloudflare(),
  // Astro 6: output defaults to 'static'. SSR pages opt-in with `export const prerender = false`
  // Annonce pages will use SSR (prerender = false), everything else is static.
  trailingSlash: 'always',
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
