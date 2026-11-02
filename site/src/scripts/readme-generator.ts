// README generator: everything runs in the visitor's browser. Nothing is sent anywhere.
// Each README section is built twice from the same data, once as Markdown (the output)
// and once as HTML (the live preview), so the preview always matches the file.

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const nameIn = $<HTMLInputElement>('rg-name');
const taglineIn = $<HTMLInputElement>('rg-tagline');
const liveIn = $<HTMLInputElement>('rg-live');
const repoIn = $<HTMLInputElement>('rg-repo');
const shotIn = $<HTMLInputElement>('rg-shot');
const linkNote = $<HTMLParagraphElement>('rg-link-note');
const stackBox = $<HTMLDivElement>('rg-stack');
const featuresIn = $<HTMLTextAreaElement>('rg-features');
const pmIn = $<HTMLSelectElement>('rg-pm');
const licenseIn = $<HTMLSelectElement>('rg-license');
const cmdsIn = $<HTMLTextAreaElement>('rg-cmds');
const cmdReset = $<HTMLButtonElement>('rg-cmd-reset');
const envIn = $<HTMLTextAreaElement>('rg-env');
const envNote = $<HTMLParagraphElement>('rg-env-note');
const vercelIn = $<HTMLInputElement>('rg-vercel');
const netlifyIn = $<HTMLInputElement>('rg-netlify');
const deployNote = $<HTMLParagraphElement>('rg-deploy-note');
const preview = $<HTMLElement>('rg-preview');
const mdWrap = $<HTMLDivElement>('rg-md-wrap');
const mdOut = $<HTMLPreElement>('rg-md');
const tabPreview = $<HTMLButtonElement>('rg-tab-preview');
const tabMd = $<HTMLButtonElement>('rg-tab-md');
const copyBtn = $<HTMLButtonElement>('rg-copy');
const downloadBtn = $<HTMLButtonElement>('rg-download');
const promptBtn = $<HTMLButtonElement>('rg-prompt');
const clearBtn = $<HTMLButtonElement>('rg-clear');
const statusEl = $<HTMLParagraphElement>('rg-status');

type Tech = { id: string; label: string; color: string; logo: string; logoColor?: string; kind: 'web' | 'other'; port?: number };

// Badge colors and simple-icons logo names, as used by shields.io.
const STACK: Tech[] = [
  { id: 'next', label: 'Next.js', color: '000000', logo: 'nextdotjs', kind: 'web', port: 3000 },
  { id: 'react', label: 'React', color: '20232A', logo: 'react', logoColor: '61DAFB', kind: 'web' },
  { id: 'vite', label: 'Vite', color: '646CFF', logo: 'vite', kind: 'web', port: 5173 },
  { id: 'astro', label: 'Astro', color: 'BC52EE', logo: 'astro', kind: 'web', port: 4321 },
  { id: 'sveltekit', label: 'SvelteKit', color: 'FF3E00', logo: 'svelte', kind: 'web', port: 5173 },
  { id: 'nuxt', label: 'Nuxt', color: '00DC82', logo: 'nuxt', logoColor: '000000', kind: 'web', port: 3000 },
  { id: 'vue', label: 'Vue', color: '4FC08D', logo: 'vuedotjs', kind: 'web' },
  { id: 'expo', label: 'Expo', color: '000020', logo: 'expo', kind: 'web', port: 8081 },
  { id: 'ts', label: 'TypeScript', color: '3178C6', logo: 'typescript', kind: 'other' },
  { id: 'tailwind', label: 'Tailwind CSS', color: '06B6D4', logo: 'tailwindcss', kind: 'other' },
  { id: 'shadcn', label: 'shadcn/ui', color: '000000', logo: 'shadcnui', kind: 'other' },
  { id: 'supabase', label: 'Supabase', color: '3FCF8E', logo: 'supabase', kind: 'other' },
  { id: 'firebase', label: 'Firebase', color: 'FFCA28', logo: 'firebase', logoColor: '000000', kind: 'other' },
  { id: 'postgres', label: 'PostgreSQL', color: '4169E1', logo: 'postgresql', kind: 'other' },
  { id: 'prisma', label: 'Prisma', color: '2D3748', logo: 'prisma', kind: 'other' },
  { id: 'clerk', label: 'Clerk', color: '6C47FF', logo: 'clerk', kind: 'other' },
  { id: 'stripe', label: 'Stripe', color: '635BFF', logo: 'stripe', kind: 'other' },
  { id: 'openai', label: 'OpenAI', color: '412991', logo: 'openai', kind: 'other' },
  { id: 'claude', label: 'Claude', color: 'D97757', logo: 'claude', kind: 'other' },
  { id: 'vercel', label: 'Vercel', color: '000000', logo: 'vercel', kind: 'other' },
  { id: 'netlify', label: 'Netlify', color: '00C7B7', logo: 'netlify', kind: 'other' },
  { id: 'cloudflare', label: 'Cloudflare', color: 'F38020', logo: 'cloudflare', kind: 'other' },
];

const EXAMPLE = {
  name: 'Tiny Invoice',
  tagline: 'Send a clean invoice in 30 seconds and get paid by card.',
  live: 'https://tinyinvoice.app',
  repo: 'https://github.com/you/tiny-invoice',
  shot: '',
  stack: ['next', 'ts', 'tailwind', 'supabase', 'stripe'],
  features: 'Create an invoice from a template in 30 seconds\nClients pay by card with Stripe Checkout\nSee who has paid and who is late on one page',
  pm: 'npm',
  license: 'MIT',
  env: 'NEXT_PUBLIC_SUPABASE_URL\nNEXT_PUBLIC_SUPABASE_ANON_KEY\nSTRIPE_SECRET_KEY\nSTRIPE_WEBHOOK_SECRET',
  vercel: true,
  netlify: false,
};

// Plain-English notes for common environment variable names.
const ENV_HINTS: [RegExp, string][] = [
  [/SERVICE_ROLE/, 'Supabase service role key. Server only, never in the browser'],
  [/SUPABASE.*URL/, 'Your Supabase project URL'],
  [/SUPABASE.*(ANON|PUBLISHABLE)/, 'Supabase public (anon) key'],
  [/STRIPE.*WEBHOOK/, 'Stripe webhook signing secret'],
  [/STRIPE.*(SECRET|_SK)/, 'Stripe secret key. Server only'],
  [/STRIPE.*(PUBLISHABLE|_PK)/, 'Stripe publishable key'],
  [/OPENAI/, 'OpenAI API key. Server only'],
  [/ANTHROPIC/, 'Anthropic API key. Server only'],
  [/GEMINI|GOOGLE_AI|GOOGLE_GENERATIVE/, 'Google AI API key. Server only'],
  [/CLERK.*SECRET/, 'Clerk secret key. Server only'],
  [/CLERK.*PUBLISHABLE/, 'Clerk publishable key'],
  [/RESEND/, 'Resend API key for sending email'],
  [/SENDGRID/, 'SendGrid API key for sending email'],
  [/^(DATABASE|POSTGRES|DB)_URL|DIRECT_URL/, 'Database connection string'],
  [/(NEXTAUTH|AUTH|JWT|SESSION)_SECRET/, 'A long random string for signing sessions'],
  [/NEXTAUTH_URL|(SITE|APP|BASE|PUBLIC)_URL$/, 'The public link of your app'],
  [/FIREBASE/, 'Firebase project setting'],
  [/POSTHOG/, 'PostHog analytics key'],
  [/SENTRY/, 'Sentry error tracking setting'],
  [/UPSTASH|REDIS/, 'Redis connection setting'],
  [/GITHUB.*(ID|SECRET)|GOOGLE.*(ID|SECRET)/, 'Sign-in (OAuth) app setting'],
];

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// ---------- small helpers ----------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Markdown text from the visitor stays as typed, except characters that would start HTML.
const mdText = (s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Very small inline Markdown for the preview of what visitors type: `code` and **bold**.
function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

// Adds https:// when someone types just "mysite.com". Only http(s) links are used.
function link(raw: string): URL | null {
  const v = raw.trim();
  if (!v) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null;
    return u;
  } catch {
    return null;
  }
}

// GitHub link → { url, slug, folder }. Accepts "you/repo" too.
function repoInfo(raw: string): { url: string; folder: string; slug: string } | null {
  let v = raw.trim().replace(/\.git$/, '').replace(/\/+$/, '');
  if (!v) return null;
  if (/^[\w.-]+\/[\w.-]+$/.test(v)) v = `https://github.com/${v}`;
  const u = link(v);
  if (!u) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const slug = `${parts[0]}/${parts[1]}`;
  const url = `${u.origin}/${slug}`;
  return { url, folder: parts[1], slug };
}

function badgeUrl(label: string, message: string, color: string, logo?: string, logoColor = 'white'): string {
  const part = (s: string) => encodeURIComponent(s.replace(/-/g, '--').replace(/_/g, '__'));
  const path = message ? `${part(label)}-${part(message)}-${color}` : `${part(label)}-${color}`;
  const q = new URLSearchParams({ style: 'for-the-badge' });
  if (logo) {
    q.set('logo', logo);
    q.set('logoColor', logoColor);
  }
  return `https://img.shields.io/badge/${path}?${q}`;
}

function envNames(): { names: string[]; hadValues: boolean; bad: string[] } {
  const names: string[] = [];
  const bad: string[] = [];
  let hadValues = false;
  for (let line of envIn.value.split(/[\n,]+/)) {
    line = line.trim().replace(/^export\s+/, '');
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq >= 0) {
      if (line.slice(eq + 1).trim()) hadValues = true;
      line = line.slice(0, eq).trim();
    }
    if (ENV_NAME.test(line)) {
      if (!names.includes(line)) names.push(line);
    } else if (line) bad.push(line);
  }
  return { names, hadValues, bad };
}

function envHint(name: string): string {
  const n = name.toUpperCase();
  for (const [re, hint] of ENV_HINTS) if (re.test(n)) return hint;
  return '';
}

function picked(): Tech[] {
  return STACK.filter((t) => (document.getElementById(`rg-t-${t.id}`) as HTMLInputElement | null)?.checked);
}

const RUN: Record<string, { install: string; dev: string; tool: string }> = {
  npm: { install: 'npm install', dev: 'npm run dev', tool: 'Node.js 20 or newer' },
  pnpm: { install: 'pnpm install', dev: 'pnpm dev', tool: 'Node.js 20 or newer and pnpm' },
  yarn: { install: 'yarn', dev: 'yarn dev', tool: 'Node.js 20 or newer and Yarn' },
  bun: { install: 'bun install', dev: 'bun dev', tool: 'Bun 1.1 or newer' },
};

function envFile(stack: Tech[]): string {
  return stack.some((t) => t.id === 'next') ? '.env.local' : '.env';
}

function defaultCmds(): string {
  const stack = picked();
  const repo = repoInfo(repoIn.value);
  const run = RUN[pmIn.value] ?? RUN.npm;
  const lines: string[] = [];
  if (repo) lines.push(`git clone ${repo.url}.git`, `cd ${repo.folder}`);
  lines.push(run.install);
  if (envNames().names.length) lines.push(`cp .env.example ${envFile(stack)}`);
  lines.push(run.dev);
  return lines.join('\n');
}

let cmdsEdited = false;
function syncCmds() {
  if (!cmdsEdited) cmdsIn.value = defaultCmds();
  cmdReset.hidden = !cmdsEdited;
}

// ---------- building the README ----------

type Block = { md: string; html: string };

function build(): { md: string; html: string } {
  const name = nameIn.value.trim() || 'My project';
  const tagline = taglineIn.value.trim();
  const liveUrl = link(liveIn.value);
  // "https://myapp.com/" reads better without the trailing slash.
  const live = liveUrl ? (liveUrl.pathname === '/' && !liveUrl.search && !liveUrl.hash ? liveUrl.origin : liveUrl.toString()) : '';
  const liveHost = liveUrl?.host ?? '';
  const repo = repoInfo(repoIn.value);
  const shot = link(shotIn.value);
  const stack = picked();
  const features = featuresIn.value.split('\n').map((s) => s.trim().replace(/^[-*•]\s*/, '')).filter(Boolean);
  const env = envNames().names;
  const run = RUN[pmIn.value] ?? RUN.npm;
  const license = licenseIn.value;
  const blocks: Block[] = [];

  // Title and one-liner
  blocks.push({ md: `# ${mdText(name)}`, html: `<h1>${esc(name)}</h1>` });
  if (tagline) blocks.push({ md: mdText(tagline), html: `<p>${inline(tagline)}</p>` });

  // Badges
  const badges: { alt: string; src: string; href?: string }[] = [];
  if (live) badges.push({ alt: 'Live demo', src: badgeUrl('Live demo', liveHost, '0593C6'), href: live });
  for (const t of stack) badges.push({ alt: t.label, src: badgeUrl(t.label, '', t.color, t.logo, t.logoColor) });
  if (license) badges.push({ alt: `License: ${license}`, src: badgeUrl('License', license, '22863A') });
  if (badges.length) {
    blocks.push({
      md: badges.map((b) => (b.href ? `[![${b.alt}](${b.src})](${b.href})` : `![${b.alt}](${b.src})`)).join('\n'),
      html: `<p class="badges">${badges
        .map((b) => {
          const img = `<img src="${esc(b.src)}" alt="${esc(b.alt)}" loading="lazy">`;
          return b.href ? `<a href="${esc(b.href)}" target="_blank" rel="noopener">${img}</a>` : img;
        })
        .join(' ')}</p>`,
    });
  }

  // Screenshot
  if (shot) {
    const src = shot.toString();
    const img = `![${mdText(name)} screenshot](${src})`;
    blocks.push({
      md: live ? `[${img}](${live})` : img,
      html: `<p><img src="${esc(src)}" alt="${esc(name)} screenshot" referrerpolicy="no-referrer"></p>`,
    });
  } else {
    blocks.push({ md: '', html: '<div class="shot-empty">Add a screenshot link to show your app here.<br>(This box isn’t in your README.)</div>' });
  }

  if (live) {
    blocks.push({ md: `**Try it:** ${live}`, html: `<p><strong>Try it:</strong> <a href="${esc(live)}" target="_blank" rel="noopener">${esc(live)}</a></p>` });
  }

  // Features
  if (features.length) {
    blocks.push({
      md: `## Features\n\n${features.map((f) => `- ${mdText(f)}`).join('\n')}`,
      html: `<h2>Features</h2><ul>${features.map((f) => `<li>${inline(f)}</li>`).join('')}</ul>`,
    });
  } else {
    blocks.push({
      md: '## Features\n\n<!-- Ask your AI agent to write this section from your code. -->\n- _Describe your first feature here_\n- _And your second_',
      html: '<h2>Features</h2><ul><li class="todo"><em>Describe your first feature here</em></li><li class="todo"><em>And your second</em></li></ul>',
    });
  }

  // Tech stack
  if (stack.length) {
    blocks.push({
      md: `## Tech stack\n\n${stack.map((t) => `- ${t.label}`).join('\n')}`,
      html: `<h2>Tech stack</h2><ul>${stack.map((t) => `<li>${esc(t.label)}</li>`).join('')}</ul>`,
    });
  }

  // Getting started
  const cmds = cmdsIn.value.replace(/\s+$/, '');
  const port = stack.find((t) => t.port)?.port ?? 3000;
  const parts: Block[] = [
    { md: '## Getting started', html: '<h2>Getting started</h2>' },
    { md: `You need ${run.tool}.`, html: `<p>You need ${esc(run.tool)}.</p>` },
  ];
  if (cmds) parts.push({ md: '```bash\n' + cmds + '\n```', html: `<pre><code>${esc(cmds)}</code></pre>` });
  parts.push({
    md: `Then open [http://localhost:${port}](http://localhost:${port}) in your browser.`,
    html: `<p>Then open <a href="http://localhost:${port}" target="_blank" rel="noopener">http://localhost:${port}</a> in your browser.</p>`,
  });
  blocks.push(...parts);

  // Environment variables (names only, never values)
  if (env.length) {
    const file = envFile(stack);
    const rows = env.map((n) => [n, envHint(n)]);
    blocks.push({
      md: [
        '## Environment variables',
        '',
        `Copy \`.env.example\` to \`${file}\` and fill in your own values. Never commit real keys.`,
        '',
        '| Variable | What it is |',
        '| --- | --- |',
        ...rows.map(([n, h]) => `| \`${n}\` | ${h} |`),
      ].join('\n'),
      html:
        '<h2>Environment variables</h2>' +
        `<p>Copy <code>.env.example</code> to <code>${file}</code> and fill in your own values. Never commit real keys.</p>` +
        `<table><thead><tr><th>Variable</th><th>What it is</th></tr></thead><tbody>${rows
          .map(([n, h]) => `<tr><td><code>${esc(n)}</code></td><td>${esc(h)}</td></tr>`)
          .join('')}</tbody></table>`,
    });
  }

  // Deploy buttons
  const deploy: { alt: string; src: string; href: string }[] = [];
  if (repo && vercelIn.checked) {
    const q = new URLSearchParams({ 'repository-url': repo.url });
    if (env.length) q.set('env', env.join(','));
    deploy.push({ alt: 'Deploy with Vercel', src: 'https://vercel.com/button', href: `https://vercel.com/new/clone?${q}` });
  }
  if (repo && netlifyIn.checked) {
    deploy.push({
      alt: 'Deploy to Netlify',
      src: 'https://www.netlify.com/img/deploy/button.svg',
      href: `https://app.netlify.com/start/deploy?${new URLSearchParams({ repository: repo.url })}`,
    });
  }
  if (deploy.length) {
    blocks.push({
      md: `## Deploy\n\n${deploy.map((d) => `[![${d.alt}](${d.src})](${d.href})`).join('\n')}`,
      html: `<h2>Deploy</h2><p class="deploy">${deploy
        .map((d) => `<a href="${esc(d.href)}" target="_blank" rel="noopener"><img src="${esc(d.src)}" alt="${esc(d.alt)}"></a>`)
        .join('')}</p>`,
    });
  }

  // License
  if (license) {
    blocks.push({
      md: `## License\n\n${license === 'MIT' ? 'MIT' : 'Apache 2.0'}. See [LICENSE](LICENSE).`,
      html: `<h2>License</h2><p>${license === 'MIT' ? 'MIT' : 'Apache 2.0'}. See <a href="#" tabindex="-1">LICENSE</a>.</p>`,
    });
  }

  return {
    md: blocks.map((b) => b.md).filter(Boolean).join('\n\n') + '\n',
    html: blocks.map((b) => b.html).join(''),
  };
}

// ---------- notes under the form ----------

function notes() {
  const msgs: string[] = [];
  if (liveIn.value.trim() && !link(liveIn.value)) msgs.push('The live link doesn’t look right. Try https://myapp.com');
  if (repoIn.value.trim() && !repoInfo(repoIn.value)) msgs.push('The GitHub link should look like https://github.com/you/my-app');
  if (shotIn.value.trim() && !link(shotIn.value)) msgs.push('The screenshot link must start with https:// and point to a picture online.');
  linkNote.textContent = msgs.join(' ');
  linkNote.hidden = msgs.length === 0;

  const { hadValues, bad } = envNames();
  const env: string[] = [];
  if (!envIn.value.trim()) scrubbed = false;
  if (hadValues || scrubbed) env.push('We removed the values. Only the names go in your README.');
  if (bad.length) env.push(`Skipped ${bad.slice(0, 3).map((b) => `“${b.slice(0, 30)}”`).join(', ')}: names can use only letters, numbers and _.`);
  envNote.textContent = env.join(' ');
  envNote.hidden = env.length === 0;

  deployNote.hidden = !((vercelIn.checked || netlifyIn.checked) && !repoInfo(repoIn.value));
}

// ---------- render ----------

let current = { md: '', html: '' };
let scrubbed = false;
function render() {
  syncCmds();
  notes();
  current = build();
  preview.innerHTML = current.html;
  mdOut.textContent = current.md;
}

// Strip any secret values out of the box itself as soon as the visitor leaves it or pastes.
function scrubEnv() {
  const { names, hadValues } = envNames();
  if (hadValues) {
    envIn.value = names.join('\n');
    scrubbed = true;
  }
}

// ---------- copy, download, prompt ----------

function say(msg: string) {
  statusEl.textContent = msg;
}

function copyText(text: string, done: (ok: boolean) => void) {
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => done(true), () => done(fallback()));
  else done(fallback());
}

function promptText(): string {
  return [
    'Please set up the README for this project.',
    '',
    '1. Put the README below in README.md in the top folder of the project. If README.md already exists, replace it, but keep any extra sections it has that are not below (like Contributing or Credits).',
    '2. Write the Features section from this codebase. Read the pages, routes, components and API handlers, then list 4 to 8 things a user can actually do, one line each, starting with a short **bold** name. Use plain English and only list features that are really in the code. Replace any placeholder lines there.',
    '3. Check that the Getting started commands match package.json scripts and that the environment variable table lists the variables the code really reads. Fix them if they do not. Never write real secret values anywhere.',
    '4. If the README mentions .env.example and the file does not exist, create it with the variable names and empty values.',
    '5. If the README links to a LICENSE file and there is none, create it with the standard text for that license.',
    '',
    'README:',
    '',
    current.md,
  ].join('\n');
}

copyBtn.addEventListener('click', () => copyText(current.md, (ok) => say(ok ? 'Copied the README. Paste it into README.md.' : 'Your browser blocked copying. Use Download instead.')));

downloadBtn.addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([current.md], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'README.md';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  say('Downloaded README.md. Put it in the top folder of your project.');
});

promptBtn.addEventListener('click', () =>
  copyText(promptText(), (ok) => say(ok ? 'Copied. Paste it into Claude Code, Cursor or Codex.' : 'Your browser blocked copying.')),
);

function showTab(md: boolean) {
  tabPreview.setAttribute('aria-selected', String(!md));
  tabMd.setAttribute('aria-selected', String(md));
  preview.hidden = md;
  mdWrap.hidden = !md;
}
tabPreview.addEventListener('click', () => showTab(false));
tabMd.addEventListener('click', () => showTab(true));

// ---------- form setup ----------

for (const t of STACK) {
  const label = document.createElement('label');
  label.className = 'chip';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.id = `rg-t-${t.id}`;
  label.append(box, ` ${t.label}`);
  stackBox.append(label);
}

function fill(d: typeof EXAMPLE) {
  nameIn.value = d.name;
  taglineIn.value = d.tagline;
  liveIn.value = d.live;
  repoIn.value = d.repo;
  shotIn.value = d.shot;
  for (const t of STACK) ($(`rg-t-${t.id}`) as HTMLInputElement).checked = d.stack.includes(t.id);
  featuresIn.value = d.features;
  pmIn.value = d.pm;
  licenseIn.value = d.license;
  envIn.value = d.env;
  vercelIn.checked = d.vercel;
  netlifyIn.checked = d.netlify;
  cmdsEdited = false;
  render();
}

clearBtn.addEventListener('click', () => {
  fill({ name: '', tagline: '', live: '', repo: '', shot: '', stack: [], features: '', pm: 'npm', license: 'MIT', env: '', vercel: false, netlify: false });
  nameIn.focus();
  say('Cleared. Start typing and the README fills in.');
});

cmdsIn.addEventListener('input', () => {
  cmdsEdited = true;
  render();
});
cmdReset.addEventListener('click', () => {
  cmdsEdited = false;
  render();
});
pmIn.addEventListener('change', () => {
  cmdsEdited = false;
  render();
});
envIn.addEventListener('change', () => {
  scrubEnv();
  render();
});
envIn.addEventListener('paste', () => setTimeout(() => {
  scrubEnv();
  render();
}));
document.getElementById('rg-form')!.addEventListener('input', (e) => {
  if (e.target !== cmdsIn) render();
});
document.getElementById('rg-form')!.addEventListener('change', (e) => {
  if (e.target !== envIn && e.target !== pmIn) render();
});

fill(EXAMPLE);
