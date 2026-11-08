import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import { PRODUCT } from './src/config/product';

const GOOGLE_CLIENT_ID = '707818170740-n9bp4nmkrt8avl5p29452d59cve587as.apps.googleusercontent.com';

export default defineConfig({
  srcDir: 'src',
  outDir: process.env.DARNLY_E2E ? '.output-e2e' : '.output',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    // Store title and summary: the search words people type ("bug report", "AI coding agents") come first.
    // short_name keeps the toolbar and menus to just "Darnly". PRODUCT.NAME stays "Darnly" inside the app.
    name: `${PRODUCT.NAME}: Bug reports for AI coding agents`,
    short_name: PRODUCT.NAME,
    // The store shows this under the title in search results: lead with the outcome, then the two facts that remove doubt.
    description: 'Point at a bug, say what you expected, and your AI coding agent fixes it. Free, no account. For Claude Code, Codex and Cursor.',
    // identity: "Sign in with Google" for the cloud inbox (projects whose code isn't on this computer).
    permissions: ['sidePanel', 'storage', 'activeTab', 'scripting', 'offscreen', 'webRequest', 'identity'],
    // Google sign-in only works for the store's extension id. An unpacked build gets a random id unless it is
    // given the store item's public key (Developer Dashboard → Package → Public key) as DARNLY_MANIFEST_KEY.
    ...(process.env.DARNLY_MANIFEST_KEY ? { key: process.env.DARNLY_MANIFEST_KEY } : {}),
    // Google sign-in for the cloud inbox (public id of the "Chrome extension" OAuth client). Override with DARNLY_GOOGLE_CLIENT_ID.
    oauth2: { client_id: process.env.DARNLY_GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID, scopes: ['openid', 'email'] },
    // Production sites are switched on one at a time from the side panel; Chrome asks to confirm each.
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    // Localhost works without asking; other sites work through the hotkey (activeTab) or once switched on (above).
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
