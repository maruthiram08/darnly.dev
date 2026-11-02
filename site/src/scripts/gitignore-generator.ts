// .gitignore generator and checker: everything runs in the visitor's browser. Nothing is uploaded.
import { STACKS, DEFAULT_STACKS, build, toText, check, missingLines, type Finding } from './gitignore-generator-core';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string | null) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

async function copyText(text: string, btn: HTMLButtonElement) {
  const label = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = 'Couldn’t copy';
  }
  setTimeout(() => (btn.textContent = label), 1500);
}

// ---- Tabs: "Make a .gitignore" and "Check mine" ----

const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('#gi-modes [data-mode]'));
const panes: Record<string, HTMLElement> = { make: $('gi-make'), check: $('gi-check') };

function show(mode: 'make' | 'check', push = true) {
  for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.mode === mode));
  for (const [k, p] of Object.entries(panes)) p.hidden = k !== mode;
  if (push) history.replaceState(null, '', mode === 'check' ? '#check' : location.pathname + location.search);
}
for (const t of tabs) t.addEventListener('click', () => show(t.dataset.mode as 'make' | 'check'));
for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href="#check"]')) {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    show('check');
    $('gi-modes').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
if (location.hash === '#check') show('check', false);

// ---- Make a .gitignore ----

const stacksBox = $<HTMLDivElement>('gi-stacks');
const code = $<HTMLOListElement>('gi-code');
const count = $<HTMLElement>('gi-count');
const secretCount = $<HTMLElement>('gi-secret-count');
const status = $<HTMLParagraphElement>('gi-status');
const picked = new Set(DEFAULT_STACKS);

const GROUPS: Record<string, string> = { stack: 'Your stack', system: 'Your computer', editor: 'Your editor' };
for (const g of Object.keys(GROUPS)) {
  const row = el('div', 'group');
  row.append(el('span', 'glabel', GROUPS[g]));
  for (const s of STACKS.filter((x) => x.group === g)) {
    const label = el('label', 'pill');
    const box = el('input');
    box.type = 'checkbox';
    box.value = s.id;
    box.checked = picked.has(s.id);
    box.addEventListener('change', () => {
      if (box.checked) picked.add(s.id);
      else picked.delete(s.id);
      render();
    });
    label.append(box, el('span', '', s.name));
    row.append(label);
  }
  stacksBox.append(row);
}

let text = '';
function render() {
  const lines = build(STACKS.map((s) => s.id).filter((id) => picked.has(id)));
  text = toText(lines);
  code.replaceChildren(
    ...lines.map((l) => {
      const li = el('li', l.kind);
      li.append(el('span', 'txt', l.text || ' '));
      if (l.kind === 'secret') li.append(el('span', 'badge', 'secret'));
      if (l.kind === 'keep') li.append(el('span', 'badge', 'kept in git'));
      return li;
    }),
  );
  const rules = lines.filter((l) => l.kind !== 'comment' && l.kind !== 'blank').length;
  count.textContent = `${rules} rules`;
  secretCount.textContent = String(lines.filter((l) => l.kind === 'secret').length);
  status.textContent = '';
}
render();

$<HTMLButtonElement>('gi-copy').addEventListener('click', (e) => copyText(text, e.currentTarget as HTMLButtonElement));

$<HTMLButtonElement>('gi-download').addEventListener('click', () => {
  const a = el('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = '.gitignore';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  status.textContent = 'Saved. If your browser named it gitignore.txt or _gitignore, rename it to .gitignore and put it in the top folder of your project.';
});

$<HTMLButtonElement>('gi-prompt').addEventListener('click', (e) => {
  const prompt =
    'Create (or update) the .gitignore in the top folder of my project with the lines below. Keep any lines already in it that these don’t cover.\n' +
    'Then run `git ls-files -ci --exclude-standard` to find files that are already committed but should be ignored. Untrack each one with `git rm --cached` (keep it on my disk) and commit.\n' +
    'If a .env, key or service account file shows up in that list, stop and tell me: those keys are in the git history and need rotating.\n\n' +
    '```gitignore\n' + text + '```\n';
  copyText(prompt, e.currentTarget as HTMLButtonElement);
});

// ---- Check mine ----

const ignoreIn = $<HTMLTextAreaElement>('gi-ignore');
const filesIn = $<HTMLTextAreaElement>('gi-files');
const card = $<HTMLDivElement>('gi-card');
const verdict = $<HTMLParagraphElement>('gi-verdict');
const sub = $<HTMLParagraphElement>('gi-sub');
const cover = $<HTMLUListElement>('gi-cover');
const coverCopy = $<HTMLButtonElement>('gi-cover-copy');
const list = $<HTMLUListElement>('gi-list');
const fineNote = $<HTMLParagraphElement>('gi-fine');
const fixAll = $<HTMLButtonElement>('gi-fixall');

const TAG: Record<string, string> = {
  'secret in-git': 'Already in git',
  'secret will-commit': 'Will be committed',
  'secret safe': 'Ignored',
  'junk in-git': 'Shouldn’t be in git',
  'junk will-commit': 'Add to .gitignore',
  'junk safe': 'Ignored',
};

const q = (p: string) => `"${p}"`;

function promptFor(f: Finding): string {
  const p = f.path;
  const pat = f.kind.pattern;
  if (f.kind.level === 'secret' && f.status === 'in-git')
    return (
      `My file ${p} was committed to git, so the keys in it can be read by anyone who can see this repo or its history. Please:\n` +
      `1. Add \`${pat}\` to .gitignore and run \`git rm --cached ${q(p)}\` (keep the file on my disk).\n` +
      `2. Remove ${p} from the whole git history with git filter-repo (or BFG). Show me the force-push command and wait for my OK before you push.\n` +
      `3. List every key and password in ${p} and tell me where to rotate each one (make a new key, then delete the old one).\n` +
      `4. Run git status to confirm ${p} is no longer tracked.`
    );
  if (f.kind.level === 'secret')
    return (
      `Add \`${pat}\` to my .gitignore so ${p} is never committed, and check it with \`git check-ignore -v ${q(p)}\`.\n` +
      `Then run \`git log --all -- ${q(p)}\` to see if it was ever committed before. If it was, remove it from the git history, and tell me which keys in it to rotate.`
    );
  return `${p} is in git but shouldn’t be. Add \`${pat}\` to .gitignore, run \`git rm -r --cached ${q(p)}\` (keep it on my disk) and commit.`;
}

function why(f: Finding): string {
  if (f.status === 'safe') return f.rule ? `Your .gitignore line ${f.rule.line} (${f.rule.text}) keeps it out of git.` : 'Your .gitignore keeps it out of git.';
  if (f.status === 'in-git')
    return f.kind.level === 'secret'
      ? 'It’s already committed, so adding it to .gitignore now won’t remove it. Anyone with the repo can read it in the history. Remove it and rotate the keys.'
      : 'It’s already committed. Adding it to .gitignore alone won’t take it out.';
  return f.kind.level === 'secret'
    ? 'Your .gitignore doesn’t cover it, so your next “git add .” will commit it.'
    : 'Your .gitignore doesn’t cover it, so it will be committed with your code.';
}

function item(f: Finding): HTMLLIElement {
  const risk = f.status !== 'safe';
  const li = el('li', `f ${f.kind.level} ${f.status}`);
  const head = el('div', 'head');
  head.append(el('span', 'tag', TAG[`${f.kind.level} ${f.status}`]), el('code', 'path', f.path + (f.isDir ? '/' : '')));
  li.append(head, el('p', 'what', f.kind.what), el('p', 'why', why(f)));
  if (risk) {
    const acts = el('div', 'acts');
    if (f.kind.level === 'secret' || f.status === 'in-git') {
      const b = el('button', 'act primary', 'Copy prompt for your AI agent') as HTMLButtonElement;
      b.type = 'button';
      b.addEventListener('click', () => copyText(promptFor(f), b));
      acts.append(b);
    }
    const line = el('button', 'act', `Copy line: ${f.kind.pattern}`) as HTMLButtonElement;
    line.type = 'button';
    line.addEventListener('click', () => copyText(f.kind.pattern, line));
    acts.append(line);
    li.append(acts);
  }
  return li;
}

let fixAllText = '';
let missing: string[] = [];
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

function runCheck() {
  const r = check(ignoreIn.value, filesIn.value);
  const secrets = r.findings.filter((f) => f.kind.level === 'secret' && f.status !== 'safe');
  const junk = r.findings.filter((f) => f.kind.level === 'junk' && f.status !== 'safe');
  const inGit = secrets.filter((f) => f.status === 'in-git').length;
  missing = missingLines(r.coverage);

  let level: 'leak' | 'warn' | 'ok';
  if (secrets.length) {
    level = 'leak';
    verdict.textContent = `${plural(secrets.length, 'secret file')} would leak`;
    const parts = [];
    if (inGit) parts.push(`${inGit} ${inGit === 1 ? 'is' : 'are'} already in git`);
    if (secrets.length - inGit) parts.push(`${secrets.length - inGit} will be committed by your next “git add .”`);
    sub.textContent = parts.join(', and ') + '.';
  } else if (junk.length || (r.files === 0 && missing.length)) {
    level = 'warn';
    if (junk.length) {
      verdict.textContent = `No secrets at risk, but ${plural(junk.length, 'file')} ${junk.length === 1 ? 'doesn’t' : 'don’t'} belong in git`;
      sub.textContent = 'They make your repo big and messy. Each one has the line to add.';
    } else {
      verdict.textContent = 'Your .gitignore misses some secret files';
      sub.textContent = 'Paste your file list or git status below to see what would actually leak.';
    }
  } else {
    level = 'ok';
    verdict.textContent = r.files ? 'No secrets at risk' : r.rules ? 'Your .gitignore covers the usual secrets' : 'Paste your .gitignore below';
    sub.textContent = r.files ? `Checked ${plural(r.files, 'file')}. Your keys stay out of git.` : 'Paste your file list or git status below to check your actual files.';
  }
  card.className = `card ${level}`;

  cover.replaceChildren(
    ...r.coverage.map((c) => {
      const li = el('li', c.ok ? 'yes' : 'no');
      li.append(el('span', 'mark', c.ok ? '✓' : '✗'), el('code', '', c.path));
      li.title = c.ok ? 'Ignored by your .gitignore' : 'Not covered by your .gitignore';
      return li;
    }),
  );
  coverCopy.hidden = !missing.length;
  coverCopy.textContent = `Copy the ${plural(missing.length, 'missing line')}`;

  list.replaceChildren(...r.findings.map(item));
  const safe = r.findings.filter((f) => f.status === 'safe').length;
  fineNote.hidden = !r.files;
  fineNote.textContent = r.fine || safe ? `${plural(r.fine, 'other file')} ${r.fine === 1 ? 'looks' : 'look'} fine.` : '';
  if (!fineNote.textContent) fineNote.hidden = true;

  const risky = [...secrets, ...junk.filter((f) => f.status === 'in-git')];
  const lines = [...new Set([...secrets, ...junk].map((f) => f.kind.pattern))];
  fixAllText = risky.length
    ? 'Please fix these problems in my git repo:\n\n' + risky.map((f, i) => `${i + 1}. ${promptFor(f)}`).join('\n\n') + (lines.length ? `\n\nMake sure .gitignore has these lines: ${lines.join(', ')}.` : '')
    : '';
  fixAll.hidden = !risky.length;
}

let timer = 0;
for (const t of [ignoreIn, filesIn]) t.addEventListener('input', () => {
  clearTimeout(timer);
  timer = window.setTimeout(runCheck, 150);
});
coverCopy.addEventListener('click', () => copyText(missing.join('\n') + '\n', coverCopy));
fixAll.addEventListener('click', () => copyText(fixAllText, fixAll));
$<HTMLButtonElement>('gi-clear').addEventListener('click', () => {
  ignoreIn.value = '';
  filesIn.value = '';
  runCheck();
  ignoreIn.focus();
});
runCheck();
