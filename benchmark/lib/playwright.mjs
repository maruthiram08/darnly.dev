// Loads Playwright from benchmark/node_modules, or from a global install as a fallback.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';

export function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require('playwright');
  } catch {
    const globalRoot = execSync('npm root -g').toString().trim();
    return require(path.join(globalRoot, 'playwright'));
  }
}
