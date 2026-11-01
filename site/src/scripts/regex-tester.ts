// Regex tester: everything runs in the visitor's browser. Nothing is uploaded.
import { explain, checkPattern, splitLiteral, toJs, toPython, toZod, FLAGS, LIBRARY, type Line } from './regex-tester-core';
import { run, MAX_MATCHES, type Result } from './regex-tester-match';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const patIn = $<HTMLInputElement>('rx-pattern');
const flagBox = $<HTMLDivElement>('rx-flags');
const flagText = $<HTMLElement>('rx-flag-text');
const lib = $<HTMLDivElement>('rx-lib');
const about = $<HTMLParagraphElement>('rx-about');
const verdict = $<HTMLElement>('rx-verdict');
const errBox = $<HTMLParagraphElement>('rx-error');
const textIn = $<HTMLTextAreaElement>('rx-text');
const paint = $<HTMLDivElement>('rx-paint');
const list = $<HTMLOListElement>('rx-list');
const more = $<HTMLParagraphElement>('rx-more');
const parts = $<HTMLOListElement>('rx-parts');
const flagNotes = $<HTMLUListElement>('rx-flag-notes');
const tabs = document.querySelectorAll<HTMLButtonElement>('[data-lang]');
const code = $<HTMLPreElement>('rx-code');
const copyCode = $<HTMLButtonElement>('rx-copy-code');
const promptBtn = $<HTMLButtonElement>('rx-prompt');
const linkBtn = $<HTMLButtonElement>('rx-link');
const status = $<HTMLParagraphElement>('rx-status');

const SHOW_ROWS = 100;
let flags = 'gm';
let lang: 'js' | 'py' | 'zod' = 'js';
let lastResult: Result | null = null;
let lastLines: Line[] = [];

function say(msg: string) {
  status.textContent = msg;
}

async function copy(textToCopy: string, done: string) {
  try {
    await navigator.clipboard.writeText(textToCopy);
    say(done);
  } catch {
    say('Your browser blocked copying. Select the text instead.');
  }
}

// --- Flag toggles -----------------------------------------------------------
const flagButtons = FLAGS.map(({ f, name, text }) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'flag';
  b.title = text;
  b.dataset.flag = f;
  const letter = document.createElement('b');
  letter.textContent = f;
  b.append(letter, ` ${name}`);
  b.addEventListener('click', () => {
    flags = flags.includes(f) ? flags.replace(f, '') : sortFlags(flags + f);
    about.hidden = true;
    update();
  });
  flagBox.append(b);
  return b;
});

function sortFlags(f: string) {
  return 'dgimsuvy'.split('').filter((c) => f.includes(c)).join('');
}

// --- Library of common patterns ------------------------------------------------
for (const item of LIBRARY) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'lib';
  b.textContent = item.name;
  b.title = item.about;
  b.addEventListener('click', () => {
    patIn.value = item.pattern;
    flags = item.flags;
    textIn.value = item.text;
    about.textContent = item.about;
    about.hidden = false;
    lib.querySelectorAll('.lib').forEach((x) => x.classList.toggle('on', x === b));
    update();
  });
  lib.append(b);
}

// --- Matching, in a worker so a runaway pattern can be stopped ----------------------
let worker: Worker | null = null;
let job = 0;
let timer = 0;

function makeWorker() {
  try {
    worker = new Worker(new URL('./regex-tester-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; result?: Result; error?: string }>) => {
      if (e.data.id !== job) return;
      clearTimeout(timer);
      if (e.data.result) show(e.data.result);
      else showError(e.data.error || 'Something went wrong.');
    };
  } catch {
    worker = null;
  }
}
makeWorker();

function match(pattern: string, f: string, text: string) {
  job++;
  if (!worker) {
    try {
      show(run(pattern, f, text));
    } catch (e) {
      showError(String((e as Error).message));
    }
    return;
  }
  clearTimeout(timer);
  worker.postMessage({ id: job, pattern, flags: f, text });
  timer = window.setTimeout(() => {
    // Too slow: this pattern backtracks a lot. Stop it and start a fresh worker.
    worker?.terminate();
    makeWorker();
    lastResult = null;
    setVerdict('slow', 'Too slow');
    errBox.textContent =
      'This pattern takes too long on this text. On a real site it could freeze the page or the server. It usually means a repeat inside a repeat, like (a+)+.';
    errBox.hidden = false;
    paintText(null);
    list.replaceChildren();
    more.hidden = true;
  }, 1500);
}

// --- Painting matches into the text --------------------------------------------
type Iv = { s: number; e: number; cls: string; title?: string };

function paintText(r: Result | null) {
  const text = textIn.value;
  const ivs: Iv[] = [];
  if (r) {
    r.matches.forEach((m, k) => {
      ivs.push({ s: m.start, e: m.end, cls: m.start === m.end ? 'hit zero' : `hit${k % 2 ? ' alt' : ''}` });
      m.groups.forEach((g, n) => {
        if (!g) return;
        const s = Math.max(g[0], m.start);
        const e = Math.min(g[1], m.end);
        if (e > s) ivs.push({ s, e, cls: `grp g${n % 6}` });
      });
    });
  }
  ivs.sort((a, b) => a.s - b.s || b.e - a.e);

  const root = document.createDocumentFragment();
  const stack: { el: HTMLElement; end: number }[] = [];
  let pos = 0;
  const parent = () => (stack.length ? stack[stack.length - 1].el : root);
  const add = (to: number) => {
    if (to > pos) parent().append(text.slice(pos, to));
    pos = Math.max(pos, to);
  };
  for (const iv of ivs) {
    while (stack.length && stack[stack.length - 1].end <= iv.s) {
      add(stack[stack.length - 1].end);
      stack.pop();
    }
    if (stack.length && iv.e > stack[stack.length - 1].end) continue; // overlaps oddly (lookarounds): skip
    if (iv.s < pos) continue;
    add(iv.s);
    const el = document.createElement('mark');
    el.className = iv.cls;
    parent().append(el);
    stack.push({ el, end: iv.e });
  }
  while (stack.length) {
    add(stack[stack.length - 1].end);
    stack.pop();
  }
  add(text.length);
  // A trailing line break needs something after it, or the painted copy ends one line short.
  root.append('​');
  paint.replaceChildren(root);
}

function fitText() {
  textIn.style.height = 'auto';
  textIn.style.height = `${Math.max(200, textIn.scrollHeight + 2)}px`;
}

function setVerdict(kind: 'yes' | 'no' | 'bad' | 'slow', label: string) {
  verdict.className = `verdict ${kind}`;
  verdict.textContent = label;
}

function lineOf(text: string, at: number) {
  let n = 1;
  for (let i = 0; i < at; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

function visible(s: string) {
  return s.replace(/\n/g, '⏎').replace(/\t/g, '⇥');
}

function show(r: Result) {
  lastResult = r;
  errBox.hidden = true;
  const n = r.total;
  if (n === 0) setVerdict('no', 'No match');
  else setVerdict('yes', `${n.toLocaleString()} ${n === 1 ? 'match' : 'matches'}`);
  if (n > 0 && !flags.includes('g') && !flags.includes('y')) {
    verdict.textContent += ' (first only)';
    verdict.title = 'Turn on “g all” to find every match.';
  } else verdict.title = '';
  paintText(r);

  const text = textIn.value;
  list.replaceChildren(
    ...r.matches.slice(0, SHOW_ROWS).map((m, k) => {
      const li = document.createElement('li');
      li.tabIndex = 0;
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = String(k + 1);
      const val = document.createElement('code');
      val.className = 'val';
      val.textContent = m.text === '' ? '(empty)' : visible(m.text);
      const where = document.createElement('span');
      where.className = 'where';
      where.textContent = `line ${lineOf(text, m.start)}`;
      li.append(num, val, where);
      m.values.forEach((v, gi) => {
        const g = document.createElement('span');
        g.className = `gchip g${gi % 6}`;
        const name = r.names[gi];
        g.textContent = `${name ?? gi + 1}: ${v === undefined ? '—' : visible(v) || '(empty)'}`;
        g.title = name ? `Group ${gi + 1}, “${name}”` : `Group ${gi + 1}`;
        li.append(g);
      });
      const pick = () => {
        textIn.focus();
        textIn.setSelectionRange(m.start, m.end);
      };
      li.addEventListener('click', pick);
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pick();
        }
      });
      return li;
    }),
  );
  const shown = Math.min(SHOW_ROWS, r.matches.length);
  more.hidden = n <= shown;
  more.textContent =
    n > MAX_MATCHES
      ? `Showing ${shown} of ${n.toLocaleString()} matches. Only the first ${MAX_MATCHES.toLocaleString()} are coloured.`
      : `Showing the first ${shown} of ${n.toLocaleString()} matches. All of them are coloured in the text.`;
}

function showError(msg: string) {
  lastResult = null;
  setVerdict('bad', 'Pattern has a mistake');
  errBox.textContent = `${msg.charAt(0).toUpperCase()}${msg.slice(1)}.`.replace(/\.\.$/, '.');
  errBox.hidden = false;
  paintText(null);
  list.replaceChildren();
  more.hidden = true;
}

// --- Plain-English breakdown ---------------------------------------------------
function renderParts(lines: Line[]) {
  parts.replaceChildren(
    ...lines.map((l) => {
      const li = document.createElement('li');
      li.className = `part k-${l.kind}`;
      li.style.setProperty('--d', String(l.depth));
      const src = document.createElement('code');
      src.textContent = l.src;
      const t = document.createElement('span');
      t.textContent = l.text;
      li.append(src, t);
      return li;
    }),
  );
  if (!lines.length) {
    const li = document.createElement('li');
    li.className = 'part empty';
    li.textContent = 'Type a pattern above and each part of it is explained here.';
    parts.append(li);
  }
  flagNotes.replaceChildren(
    ...FLAGS.filter(({ f }) => flags.includes(f)).map(({ f, text }) => {
      const li = document.createElement('li');
      const b = document.createElement('code');
      b.textContent = f;
      li.append(b, ` ${text}`);
      return li;
    }),
  );
}

// --- Copy as code -------------------------------------------------------------
function renderCode() {
  const p = patIn.value;
  if (!p || checkPattern(p, flags)) {
    code.textContent = 'Fix the pattern first.';
    return;
  }
  code.textContent = lang === 'js' ? toJs(p, flags) : lang === 'py' ? toPython(p, flags).code : toZod(p, flags);
}

tabs.forEach((t) =>
  t.addEventListener('click', () => {
    lang = t.dataset.lang as typeof lang;
    tabs.forEach((x) => x.setAttribute('aria-selected', String(x === t)));
    renderCode();
  }),
);
copyCode.addEventListener('click', () => copy(code.textContent || '', 'Copied the code.'));

promptBtn.addEventListener('click', () => {
  const p = patIn.value;
  if (!p || checkPattern(p, flags)) {
    say('Type a working pattern first.');
    return;
  }
  const lines = [
    'Here is a regular expression from my code:',
    '',
    `/${new RegExp(p, flags).source}/${flags}`,
    '',
    'What each part means:',
    ...lastLines.map((l) => `${'  '.repeat(l.depth)}- ${l.src}  →  ${l.text}`),
  ];
  if (lastResult && textIn.value.trim()) {
    const found = lastResult.matches.slice(0, 10).map((m) => `  - ${JSON.stringify(m.text)}`);
    lines.push('', found.length ? 'When I tested it, these matched:' : 'When I tested it on my sample text, nothing matched.', ...found);
  }
  lines.push(
    '',
    'Please:',
    '1. Find where this pattern is used in my project and tell me in plain words what it is meant to check or find.',
    '2. List real inputs it would wrongly reject and inputs it would wrongly accept, with examples.',
    '3. Do not change any code yet. If it needs a fix, show me the new pattern and a few test cases first.',
  );
  copy(lines.join('\n'), 'Copied. Paste it into Claude Code, Cursor or Codex.');
});

// --- Share link ----------------------------------------------------------------
function saveUrl() {
  const url = new URL(location.href);
  url.searchParams.set('p', patIn.value);
  url.searchParams.set('f', flags);
  if (textIn.value.length <= 1500) url.searchParams.set('t', textIn.value);
  else url.searchParams.delete('t');
  history.replaceState(null, '', url);
}
linkBtn.addEventListener('click', () => {
  saveUrl();
  copy(location.href, textIn.value.length > 1500 ? 'Link copied (your text is too long to fit, so only the pattern is in it).' : 'Link copied.');
});

// --- Main update ------------------------------------------------------------------
function update(save = true) {
  // Someone pasted /abc/gi: split it into pattern and flags.
  const lit = splitLiteral(patIn.value);
  if (lit && !checkPattern(lit.pattern, lit.flags)) {
    patIn.value = lit.pattern;
    flags = sortFlags(lit.flags);
  }
  flagButtons.forEach((b) => b.setAttribute('aria-pressed', String(flags.includes(b.dataset.flag!))));
  flagText.textContent = flags;
  fitText();

  const p = patIn.value;
  const bad = p ? checkPattern(p, flags) : null;
  lastLines = p && !bad ? explain(p, flags) : [];
  renderParts(lastLines);
  renderCode();
  if (save) saveUrl();

  if (!p) {
    lastResult = null;
    setVerdict('no', 'Type a pattern');
    errBox.hidden = true;
    paintText(null);
    list.replaceChildren();
    more.hidden = true;
    return;
  }
  if (bad) {
    showError(bad);
    return;
  }
  match(p, flags, textIn.value);
}

patIn.addEventListener('input', () => {
  about.hidden = true;
  lib.querySelectorAll('.lib').forEach((x) => x.classList.remove('on'));
  update();
});
textIn.addEventListener('input', () => update());
window.addEventListener('resize', fitText);

// Start from a shared link, or from the email example.
const q = new URLSearchParams(location.search);
const first = LIBRARY[0];
if (q.has('p')) {
  patIn.value = q.get('p') || '';
  flags = sortFlags((q.get('f') || '').replace(/[^dgimsuvy]/g, ''));
  textIn.value = q.get('t') ?? '';
} else {
  patIn.value = first.pattern;
  flags = first.flags;
  textIn.value = first.text;
  about.textContent = first.about;
  about.hidden = false;
  lib.querySelector('.lib')?.classList.add('on');
}
update(false);
