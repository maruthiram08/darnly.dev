import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations, INBOX_KEY: 'test-key', ANTHROPIC_API_KEY: 'sk-test', REDDIT_USERNAME: 'maruthi' } },
      }),
    ],
    test: { setupFiles: ['./test/apply-migrations.ts'] },
  };
});
