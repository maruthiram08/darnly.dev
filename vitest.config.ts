import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  // cloud/ has its own tests that run inside the Workers runtime (cd cloud && npm test).
  // benchmark/ is a separate sample app and harness (see benchmark/README.md).
  test: { exclude: ['**/node_modules/**', 'cloud/**', 'mac/**', 'benchmark/**'] },
});
