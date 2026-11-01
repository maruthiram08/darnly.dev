// Downloads Excalidraw at the pinned commit into .cache/excalidraw and installs it (about 1 GB, 1 to 3 minutes).
// Usage: node setup.mjs
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { BASE, REPO, COMMIT } from './app/excalidraw.mjs';

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });
if (!fs.existsSync(BASE)) {
  fs.mkdirSync(BASE, { recursive: true });
  run('git', ['init', '-q'], BASE);
  run('git', ['remote', 'add', 'origin', REPO], BASE);
  run('git', ['fetch', '-q', '--depth', '1', 'origin', COMMIT], BASE);
  run('git', ['checkout', '-q', 'FETCH_HEAD'], BASE);
}
if (!fs.existsSync(`${BASE}/node_modules`)) {
  run('npx', ['--yes', 'yarn@1.22.22', 'install', '--frozen-lockfile', '--ignore-scripts', '--network-timeout', '600000'], BASE);
}
console.log(`Excalidraw ${COMMIT.slice(0, 7)} is ready in ${BASE}. Next: node verify.mjs`);
