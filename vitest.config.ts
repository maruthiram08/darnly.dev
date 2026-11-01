import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  // cloud/ has its own tests that run inside the Workers runtime (cd cloud && npm test).
  test: { exclude: ['**/node_modules/**', 'cloud/**', 'mac/**'] },
});
