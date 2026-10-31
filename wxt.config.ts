import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import { PRODUCT } from './src/config/product';

export default defineConfig({
  srcDir: 'src',
  outDir: process.env.DARNLY_E2E ? '.output-e2e' : '.output',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: PRODUCT.NAME,
    description: 'Turn a bug you see on screen into a ready-to-fix note for your AI coding agent.',
    permissions: ['sidePanel', 'storage', 'activeTab', 'scripting', 'offscreen', 'webRequest'],
    // Production sites are switched on one at a time from the side panel; Chrome asks to confirm each.
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    // Localhost works without asking; other sites work through the hotkey (activeTab). Per-site opt-in comes in Sprint 2.
    host_permissions: [
      'http://localhost/*',
      'http://127.0.0.1/*',
      // The end-to-end test can't press the real hotkey, which is what normally allows the screenshot.
      ...(process.env.DARNLY_E2E ? ['<all_urls>'] : []),
    ],
    action: { default_title: `Open ${PRODUCT.NAME}` },
    commands: {
      'start-capture': {
        suggested_key: { default: 'Alt+Shift+B', mac: 'Alt+Shift+B' },
        description: 'Capture a bug',
      },
    },
  },
});
