// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

const isPages = process.env.DEPLOY_TARGET === 'pages';

// https://astro.build/config
export default defineConfig({
  site: isPages ? 'https://panappuom.github.io' : 'https://example.com',
  base: isPages ? '/omochiforts/' : '/',
  vite: {
    plugins: [tailwindcss()]
  }
});