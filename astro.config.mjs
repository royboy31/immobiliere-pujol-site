// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  site: 'https://www.immobiliere-pujol.fr',
  integrations: [react()],
  adapter: cloudflare(),
  output: 'static',
  vite: {
    css: {
      preprocessorOptions: {
        scss: {
          additionalData: `@use "src/styles/base/variables" as *;`,
        },
      },
    },
  },
});
