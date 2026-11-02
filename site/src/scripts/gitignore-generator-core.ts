// .gitignore generator and checker: the templates, a small gitignore matcher, and the rules that
// decide which files are secrets. No DOM here, so it can be tested on its own.

export type Stack = { id: string; name: string; group: 'stack' | 'system' | 'editor'; lines: string[] };

// Always first, and it can't be turned off: this is the part that keeps keys out of git.
export const SECRETS: string[] = [
  '# Secrets: never commit these',
  '.env*',
  '!.env.example',
  '!.env.sample',
  '!.env.template',
  '*.pem',
  '*.key',
  '*.p8',
  '*.p12',
  '*.pfx',
  '*.jks',
  '*.keystore',
  'service-account*.json',
  '*-firebase-adminsdk-*.json',
  'credentials.json',
  'client_secret*.json',
];

const NODE: string[] = [
  '# Dependencies and logs',
  'node_modules/',
  '.pnpm-store/',
  'npm-debug.log*',
  'yarn-debug.log*',
  'yarn-error.log*',
  'pnpm-debug.log*',
  '*.log',
  'coverage/',
];

export const STACKS: Stack[] = [
  { id: 'nextjs', name: 'Next.js', group: 'stack', lines: [...NODE, '# Next.js', '.next/', 'out/', 'build/', 'next-env.d.ts', '*.tsbuildinfo', '.vercel/'] },
  { id: 'vite', name: 'Vite / React', group: 'stack', lines: [...NODE, '# Vite', 'dist/', 'dist-ssr/', '*.local', '.vite/', '*.tsbuildinfo'] },
  { id: 'astro', name: 'Astro', group: 'stack', lines: [...NODE, '# Astro', 'dist/', '.astro/', '.vercel/', '.netlify/', '.wrangler/'] },
  { id: 'expo', name: 'Expo / React Native', group: 'stack', lines: [...NODE, '# Expo', '.expo/', 'dist/', 'web-build/', 'expo-env.d.ts', '*.mobileprovision', '*.orig.*', '.kotlin/'] },
  { id: 'node', name: 'Node.js', group: 'stack', lines: [...NODE, '# Build output', 'dist/', 'build/', '.cache/'] },
  { id: 'python', name: 'Python', group: 'stack', lines: ['# Python', '__pycache__/', '*.py[cod]', '.venv/', 'venv/', '*.egg-info/', 'dist/', 'build/', '.pytest_cache/', '.mypy_cache/', '.ruff_cache/', '.ipynb_checkpoints/'] },
  { id: 'supabase', name: 'Supabase', group: 'stack', lines: ['# Supabase (local)', 'supabase/.branches/', 'supabase/.temp/'] },
  { id: 'macos', name: 'macOS', group: 'system', lines: ['# macOS', '.DS_Store', '._*', '.AppleDouble', '.LSOverride', '.Spotlight-V100', '.Trashes'] },
  { id: 'windows', name: 'Windows', group: 'system', lines: ['# Windows', 'Thumbs.db', 'ehthumbs.db', 'Desktop.ini', '$RECYCLE.BIN/', '*.lnk'] },
  { id: 'vscode', name: 'VS Code', group: 'editor', lines: ['# VS Code (keep shared settings)', '.vscode/*', '!.vscode/settings.json', '!.vscode/extensions.json', '!.vscode/launch.json', '*.code-workspace', '.history/'] },
  { id: 'cursor', name: 'Cursor', group: 'editor', lines: ['# Cursor (keep .cursor/rules, hide MCP keys)', '.cursor/mcp.json'] },
  { id: 'claude', name: 'Claude Code', group: 'editor', lines: ['# Claude Code (personal settings only)', '.claude/settings.local.json', 'CLAUDE.local.md'] },
  { id: 'jetbrains', name: 'JetBrains', group: 'editor', lines: ['# JetBrains', '.idea/'] },
];

export const DEFAULT_STACKS = ['nextjs', 'supabase', 'macos', 'vscode', 'cursor'];

export type Line = { text: string; kind: 'comment' | 'blank' | 'secret' | 'keep' | 'rule' };

// A line that keeps a key or password out of git.
export const SECRET_LINE = /\.env|\.pem|\.key\b|\.p8|\.p12|\.pfx|\.jks|keystore|service-account|adminsdk|credentials|client_secret|mcp\.json/;

// The .gitignore for the picked stacks, with repeated lines removed and each line tagged for the preview.
export function build(ids: string[]): Line[] {
  const out: Line[] = [];
  const seen = new Set<string>();
  // Drops a header (and the blank line before it) that ended up with no rules under it.
  const trim = () => {
    while (out.length && (out[out.length - 1].kind === 'comment' || out[out.length - 1].kind === 'blank')) out.pop();
  };
  const add = (block: string[]) => {
    for (const l of block) {
      if (l.startsWith('#')) {
        // A shared header (like "Dependencies") only once.
        if (seen.has(l)) continue;
        seen.add(l);
        if (out.length && out[out.length - 1].kind === 'comment') trim();
        if (out.length) out.push({ text: '', kind: 'blank' });
        out.push({ text: l, kind: 'comment' });
        continue;
      }
      if (seen.has(l)) continue;
      seen.add(l);
      const kind = l.startsWith('!') ? 'keep' : SECRET_LINE.test(l) ? 'secret' : 'rule';
      out.push({ text: l, kind });
    }
    if (out[out.length - 1]?.kind === 'comment') trim();
  };
  add(SECRETS);
  for (const s of STACKS) if (ids.includes(s.id)) add(s.lines);
  return out;
}

export const toText = (lines: Line[]) => lines.map((l) => l.text).join('\n') + '\n';

// ---- A small gitignore matcher (same rules as git for the common cases) ----

export type Rule = { neg: boolean; dirOnly: boolean; re: RegExp; line: number; text: string };

function glob(p: string): string {
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        const atStart = i === 0 || p[i - 1] === '/';
        const atEnd = i + 2 === p.length;
        if (atStart && p[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
          continue;
        }
        if (atStart && atEnd) {
          re += '.*';
          i += 1;
          continue;
        }
        re += '[^/]*';
        i += 1;
        continue;
      }
      re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const end = p.indexOf(']', i + 2);
      if (end === -1) re += '\\[';
      else {
        let body = p.slice(i + 1, end);
        if (body[0] === '!') body = '^' + body.slice(1);
        re += '[' + body.replace(/\\/g, '\\\\') + ']';
        i = end;
      }
    } else if (c === '\\' && i + 1 < p.length) {
      re += p[i + 1].replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      i++;
    } else re += c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  }
  return re;
}

export function parseIgnore(src: string): Rule[] {
  const rules: Rule[] = [];
  src.split('\n').forEach((raw, i) => {
    let p = raw.replace(/\r$/, '');
    if (!p.trim() || p.startsWith('#')) return;
    p = p.replace(/(?<!\\)\s+$/, '').replace(/^\s+/, '');
    let neg = false;
    if (p.startsWith('!')) {
      neg = true;
      p = p.slice(1);
    } else if (p.startsWith('\\!') || p.startsWith('\\#')) p = p.slice(1);
    const dirOnly = p.endsWith('/');
    p = p.replace(/\/+$/, '');
    if (!p) return;
    const anchored = p.includes('/');
    p = p.replace(/^\//, '');
    try {
      rules.push({ neg, dirOnly, re: new RegExp('^' + (anchored ? '' : '(?:.*/)?') + glob(p) + '$'), line: i + 1, text: raw.trim() });
    } catch {
      /* a broken pattern is skipped, like git does */
    }
  });
  return rules;
}

function last(rules: Rule[], path: string, isDir: boolean): Rule | null {
  let hit: Rule | null = null;
  for (const r of rules) if ((!r.dirOnly || isDir) && r.re.test(path)) hit = r;
  return hit;
}

// The rule that decides this path, or null. Ignored when the rule isn't a "!" rule.
// Like git, once a folder is ignored nothing inside it can be brought back.
export function decide(rules: Rule[], path: string, isDir = false): Rule | null {
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) {
    const r = last(rules, parts.slice(0, i).join('/'), true);
    if (r && !r.neg) return r;
  }
  return last(rules, path, isDir);
}

export const ignored = (rules: Rule[], path: string, isDir = false) => {
  const r = decide(rules, path, isDir);
  return !!r && !r.neg;
};

// ---- Reading a pasted file list or git status ----

export type Entry = { path: string; isDir: boolean; tracked: boolean | null };

export function parseFiles(src: string): Entry[] {
  const out: Entry[] = [];
  const seen = new Set<string>();
  let section: 'tracked' | 'untracked' | 'ignored' | null = null;
  for (const raw of src.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const t = line.trim();
    if (!t) continue;
    if (/^Changes (to be committed|not staged for commit):/.test(t) || /^Unmerged paths:/.test(t)) {
      section = 'tracked';
      continue;
    }
    if (/^Untracked files:/.test(t)) {
      section = 'untracked';
      continue;
    }
    if (/^Ignored files:/.test(t)) {
      section = 'ignored';
      continue;
    }
    if (/^(\(use |On branch|HEAD detached|Your branch|nothing |no changes|and have \d|\$ |#|total \d)/.test(t)) continue;
    let path = t;
    let tracked: boolean | null = section === 'tracked' ? true : section === 'untracked' ? false : null;
    if (section === 'ignored') continue;
    const st = t.match(/^(?:modified|new file|deleted|renamed|copied|typechange|both modified|both added):\s+(.+)$/);
    const porcelain = line.match(/^([ MADRCUT?!]{2}) (.+)$/);
    const ls = t.match(/^[-dlcbps][rwxsStT-]{9}[@+.]?\s+\d+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(.+)$/);
    if (st) {
      path = st[1];
      tracked = section === 'untracked' ? false : true;
    } else if (porcelain && section === null) {
      if (porcelain[1] === '!!') continue;
      path = porcelain[2];
      tracked = porcelain[1] !== '??';
    } else if (ls) {
      path = ls[1] + (t.startsWith('d') ? '/' : '');
    }
    path = path.replace(/^.* -> /, '').replace(/^"(.*)"$/, '$1').replace(/^\.\//, '').trim();
    if (!path || path === '.' || path === '..' || path === './' || path === '../') continue;
    const isDir = path.endsWith('/');
    path = path.replace(/\/+$/, '');
    if (seen.has(path)) continue;
    seen.add(path);
    out.push({ path, isDir, tracked });
  }
  return out;
}

// ---- What counts as a secret, and what is just junk ----

export type Kind = { what: string; pattern: string; level: 'secret' | 'junk' | 'template' } | null;

export function classify(path: string, isDir = false): Kind {
  const base = path.split('/').pop() ?? path;
  const segs = path.split('/');
  if (/^\.env(\..+)?$/.test(base) || base === '.envrc') {
    if (/\.(example|sample|template|dist|defaults?)$/.test(base)) return { what: 'Example env file with no real keys. Fine to commit.', pattern: '', level: 'template' };
    return { what: 'Environment file. It usually holds API keys and database passwords.', pattern: '.env*', level: 'secret' };
  }
  if (!isDir && /\.(pem|key|p8|p12|pfx|jks|keystore)$/i.test(base)) return { what: 'Private key or signing certificate.', pattern: '*.' + base.split('.').pop()!.toLowerCase(), level: 'secret' };
  if (/^id_(rsa|dsa|ecdsa|ed25519)$/.test(base)) return { what: 'SSH private key.', pattern: base, level: 'secret' };
  if (/service[-_]?account.*\.json$/i.test(base) || /firebase-adminsdk.*\.json$/i.test(base)) return { what: 'Google or Firebase service account. Full admin access to your project.', pattern: /firebase-adminsdk/i.test(base) ? '*-firebase-adminsdk-*.json' : 'service-account*.json', level: 'secret' };
  if (base === 'credentials.json' || /^client_secret.*\.json$/.test(base) || (base === 'credentials' && segs.includes('.aws'))) return { what: 'Login credentials file.', pattern: base.startsWith('client_secret') ? 'client_secret*.json' : base, level: 'secret' };
  if (/^secrets?\.(json|ya?ml|toml)$/i.test(base)) return { what: 'Secrets file.', pattern: base, level: 'secret' };
  if (/^terraform\.tfstate/.test(base)) return { what: 'Terraform state. It stores passwords in plain text.', pattern: '*.tfstate*', level: 'secret' };
  if (path.endsWith('.cursor/mcp.json') || path === 'mcp.json') return { what: 'MCP settings. These often hold API keys for your tools.', pattern: '.cursor/mcp.json', level: 'secret' };
  if (base === '.npmrc') return { what: 'npm settings. Check that it holds no auth token.', pattern: '.npmrc', level: 'secret' };
  const junkDir = segs.find((s) => ['node_modules', '.next', '__pycache__', '.venv', 'venv', '.expo', '.astro', '.vercel', '.turbo', '.cache'].includes(s));
  if (junkDir) return { what: junkDir === 'node_modules' ? 'Installed packages. Huge, and rebuilt by npm install.' : 'Generated files that get rebuilt.', pattern: junkDir + '/', level: 'junk' };
  if (base === '.DS_Store' || base === 'Thumbs.db' || base === 'Desktop.ini') return { what: 'A hidden file your computer makes. Not part of your code.', pattern: base, level: 'junk' };
  if (isDir && ['dist', 'build', 'out', 'coverage'].includes(base)) return { what: 'Build output that gets rebuilt.', pattern: base + '/', level: 'junk' };
  if (/\.log$/.test(base)) return { what: 'Log file.', pattern: '*.log', level: 'junk' };
  return null;
}

// Files every project should keep out of git, checked against a pasted .gitignore.
export const PROBES = ['.env', '.env.local', '.env.production', 'server.pem', 'service-account.json'];

export type Status = 'in-git' | 'will-commit' | 'safe';
export type Finding = { path: string; isDir: boolean; kind: NonNullable<Kind>; status: Status; rule: Rule | null };

export function check(ignoreSrc: string, filesSrc: string) {
  const rules = parseIgnore(ignoreSrc);
  const files = parseFiles(filesSrc);
  const findings: Finding[] = [];
  let fine = 0;
  for (const f of files) {
    const kind = classify(f.path, f.isDir);
    if (!kind || kind.level === 'template') {
      fine++;
      continue;
    }
    const rule = decide(rules, f.path, f.isDir);
    const isIgnored = !!rule && !rule.neg;
    const status: Status = f.tracked ? 'in-git' : isIgnored ? 'safe' : 'will-commit';
    findings.push({ path: f.path, isDir: f.isDir, kind, status, rule });
  }
  const rank = (x: Finding) => (x.kind.level === 'secret' ? 0 : 3) + (x.status === 'in-git' ? 0 : x.status === 'will-commit' ? 1 : 6);
  findings.sort((a, b) => rank(a) - rank(b));
  const coverage = PROBES.map((p) => ({ path: p, ok: ignored(rules, p) }));
  return { files: files.length, fine, findings, coverage, rules: rules.length };
}

// Lines to add so every probe is covered.
export function missingLines(coverage: { path: string; ok: boolean }[]): string[] {
  const out: string[] = [];
  for (const c of coverage) {
    if (c.ok) continue;
    const p = classify(c.path)!.pattern;
    if (!out.includes(p)) out.push(p);
  }
  if (out.includes('.env*')) out.push('!.env.example');
  return out;
}
