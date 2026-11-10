// Builds a copy of the sample app with exactly one planted bug (or none).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { BUGS, ORIGINAL_IDS } from './bugs.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
export const APP = path.resolve(here, '../app');

function swap(dir, { file, from, to }, label) {
  const p = path.join(dir, file);
  const text = fs.readFileSync(p, 'utf8');
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`${label}: expected the text once in ${file}, found it ${n} times:\n${from}`);
  fs.writeFileSync(p, text.replace(from, () => to));
}

/** Copies ../app into dir (node_modules linked, not copied), un-plants the 10 original bugs, then plants bugId. */
export function makeWorkspace(dir, bugId, { git = true } = {}) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(APP)) {
    if (name === 'node_modules' || name === 'dist') continue;
    fs.cpSync(path.join(APP, name), path.join(dir, name), { recursive: true });
  }
  fs.symlinkSync(path.join(APP, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  for (const id of ORIGINAL_IDS) {
    for (const p of BUGS.find((b) => b.id === id).plant) swap(dir, { file: p.file, from: p.buggy, to: p.clean }, `clean ${id}`);
  }
  if (bugId) {
    const bug = BUGS.find((b) => b.id === bugId);
    if (!bug) throw new Error(`no bug ${bugId}`);
    for (const p of bug.plant) swap(dir, { file: p.file, from: p.clean, to: p.buggy }, `plant ${bugId}`);
  }
  if (git) {
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\ndist\n');
    const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
    g('init', '-q');
    g('-c', 'user.email=eval@darnly.dev', '-c', 'user.name=eval', 'add', '-A');
    g('-c', 'user.email=eval@darnly.dev', '-c', 'user.name=eval', 'commit', '-qm', 'start');
  }
  return dir;
}

/** Files the agent changed since makeWorkspace, ignoring .darnly/. */
export function changedFiles(dir) {
  const out = execFileSync('git', ['status', '--porcelain'], { cwd: dir }).toString();
  return out
    .split('\n')
    .map((l) => l.slice(3).trim())
    .filter((f) => f && !f.startsWith('.darnly'));
}

export function diff(dir) {
  execFileSync('git', ['add', '-A', '--', '.', ':!.darnly'], { cwd: dir });
  return execFileSync('git', ['diff', '--cached'], { cwd: dir }).toString();
}
