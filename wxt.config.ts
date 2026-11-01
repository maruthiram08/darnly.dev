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
    // identity: "Sign in with Google" for the cloud inbox (projects whose code isn't on this computer).
    permissions: ['sidePanel', 'storage', 'activeTab', 'scripting', 'offscreen', 'webRequest', 'identity'],
    // The Google OAuth client (type "Chrome extension") is created once the store gives the extension its id.
    // An unpacked build gets a random id, and Google sign-in only works for the store id. Setting the store
    // item's public key (Developer Dashboard → Package → Public key) gives an unpacked build the same id.
    ...(process.env.DARNLY_MANIFEST_KEY ? { key: process.env.DARNLY_MANIFEST_KEY } : {}),
    ...(process.env.DARNLY_GOOGLE_CLIENT_ID
      ? { oauth2: { client_id: process.env.DARNLY_GOOGLE_CLIENT_ID, scopes: ['openid', 'email'] } }
      : {}),
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
