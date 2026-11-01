// Starts the sample app's Vite dev server in a folder and waits until it answers.
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

export async function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

export async function startApp(dir, port) {
  port ??= await freePort();
  const vite = path.join(dir, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [vite, '--port', String(port), '--strictPort'], {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode != null) throw new Error('dev server exited:\n' + log);
    try {
      const res = await fetch(`${base}/`);
      if (res.ok) return { base, stop: () => child.kill(), log: () => log };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill();
  throw new Error('dev server did not start:\n' + log);
}
