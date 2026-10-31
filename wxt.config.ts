import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import { PRODUCT } from './src/config/product';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: PRODUCT.NAME,
    description: 'Turn a bug you see on screen into a ready-to-fix note for your AI coding agent.',
    permissions: ['sidePanel', 'storage', 'activeTab', 'scripting'],
    action: { default_title: `Open ${PRODUCT.NAME}` },
    commands: {
      'start-capture': {
        suggested_key: { default: 'Alt+Shift+B', mac: 'Alt+Shift+B' },
        description: 'Capture a bug',
      },
    },
  },
});
