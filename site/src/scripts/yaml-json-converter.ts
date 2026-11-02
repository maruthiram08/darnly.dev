// YAML ⇄ JSON converter: everything runs in the visitor's browser. Nothing is uploaded.
import { parseYaml, parseJson, toJson, toYaml, describe, type Format, type Parsed } from './yaml-json-converter-core';

type Side = 'yaml' | 'json';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const PRESETS: Record<string, { side: Side; text: string }> = {
  actions: {
    side: 'yaml',
    text: `# .github/workflows/test.yml
name: Test
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: 3.10
      - run: pip install -r requirements.txt
      - run: pytest
`,
  },
  compose: {
    side: 'yaml',
    text: `# docker-compose.yml
services:
  web:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgres://app:secret@db:5432/app
    depends_on:
      - db
  db:
    image: postgres:16
    volumes:
      - db-data:/var/lib/postgresql/data

volumes:
  db-data:
`,
  },
  vercel: {
    side: 'json',
    text: `{
  "cleanUrls": true,
  "trailingSlash": false,
  "redirects": [
    { "source": "/blog/:slug", "destination": "/posts/:slug", "permanent": true }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Frame-Options", "value": "DENY" }
      ]
    }
  ]
}
`,
  },
  openapi: {
    side: 'yaml',
    text: `openapi: 3.1.0
info:
  title: Todo API
  version: 1.0.0
paths:
  /todos:
    get:
      summary: List todos
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/Todo"
components:
  schemas:
    Todo:
      type: object
      required: [id, title]
      properties:
        id: { type: integer }
        title: { type: string }
        done: { type: boolean, default: false }
`,
  },
  broken: {
    side: 'yaml',
    text: `name: Deploy
on: push
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      name: Install
        run: npm ci
`,
  },
};

const status = $<HTMLParagraphElement>('yj-status');
const badge = $<HTMLDivElement>('yj-badge');
const badgeText = $<HTMLSpanElement>('yj-badge-text');
const why = $<HTMLButtonElement>('yj-why');
const chips = $<HTMLUListElement>('yj-chips');
const warns = $<HTMLUListElement>('yj-warns');
const arrow = $<HTMLSpanElement>('yj-arrow');
const promptBtn = $<HTMLButtonElement>('yj-prompt');
const indent4 = $<HTMLInputElement>('yj-indent4');
const minify = $<HTMLInputElement>('yj-minify');
const sortKeys = $<HTMLInputElement>('yj-sort');

class Editor {
  ta: HTMLTextAreaElement;
  gutter: HTMLPreElement;
  hl: HTMLDivElement;
  pane: HTMLElement;
  line = 0;
  constructor(public side: Side) {
    this.pane = $(`yj-${side}-pane`);
    this.ta = $(`yj-${side}`);
    this.gutter = $(`yj-${side}-gutter`);
    this.hl = $(`yj-${side}-hl`);
    this.ta.addEventListener('scroll', () => this.sync());
    this.ta.addEventListener('input', () => {
      this.numbers();
      edited(this.side);
    });
    this.ta.addEventListener('keydown', (e) => {
      // Tab inserts two spaces: YAML can't use tabs, and leaving the box by accident is annoying.
      if (e.key === 'Tab' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        document.execCommand('insertText', false, '  ');
      }
    });
    this.ta.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.ta.classList.add('drop');
    });
    this.ta.addEventListener('dragleave', () => this.ta.classList.remove('drop'));
    this.ta.addEventListener('drop', async (e) => {
      this.ta.classList.remove('drop');
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      e.preventDefault();
      if (file.size > 5_000_000) return say('That file is over 5 MB. Try a smaller one.');
      const text = await file.text();
      const side: Side = /\.json$/i.test(file.name) ? 'json' : /\.ya?ml$/i.test(file.name) ? 'yaml' : this.side;
      load(side, text);
    });
  }
  get value() {
    return this.ta.value;
  }
  set(text: string) {
    this.ta.value = text;
    this.numbers();
  }
  numbers() {
    const n = this.ta.value.split('\n').length;
    let s = '';
    for (let i = 1; i <= n; i++) s += `${i}\n`;
    this.gutter.textContent = s;
    this.sync();
  }
  mark(line: number) {
    this.line = line;
    this.pane.classList.toggle('bad', line > 0);
    this.sync();
  }
  sync() {
    this.gutter.scrollTop = this.ta.scrollTop;
    this.hl.hidden = !this.line;
    if (this.line) this.hl.style.transform = `translateY(${(this.line - 1) * 20 - this.ta.scrollTop}px)`;
  }
  goTo(line: number) {
    const lines = this.ta.value.split('\n');
    let pos = 0;
    for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
    const end = pos + (lines[line - 1]?.length ?? 0);
    this.ta.focus();
    this.ta.setSelectionRange(end, end);
    this.ta.scrollTop = Math.max(0, (line - 4) * 20);
    this.sync();
  }
  stale(on: boolean) {
    this.pane.classList.toggle('stale', on);
  }
}

const editors: Record<Side, Editor> = { yaml: new Editor('yaml'), json: new Editor('json') };
const other = (s: Side): Side => (s === 'yaml' ? 'json' : 'yaml');
const NAME: Record<Side, string> = { yaml: 'YAML', json: 'JSON' };

let source: Side = 'yaml';
let last: Parsed | null = null;
let timer = 0;

function say(msg: string) {
  status.textContent = msg;
}

function format(): Format {
  return { indent: indent4.checked ? 4 : 2, minify: minify.checked, sortKeys: sortKeys.checked };
}

function edited(side: Side) {
  source = side;
  clearTimeout(timer);
  timer = window.setTimeout(run, 120);
}

function load(side: Side, text: string) {
  editors[side].set(text);
  editors[other(side)].set(''); // a new file: don't leave the old one showing if this one is broken
  editors[side].ta.scrollTop = 0;
  editors[other(side)].ta.scrollTop = 0;
  source = side;
  run();
}

function run() {
  const from = editors[source];
  const to = editors[other(source)];
  const text = from.value;
  arrow.dataset.dir = source === 'yaml' ? 'right' : 'left';
  arrow.setAttribute('aria-label', source === 'yaml' ? 'Converting YAML to JSON' : 'Converting JSON to YAML');
  editors.yaml.mark(0);
  editors.json.mark(0);
  to.stale(false);
  warns.replaceChildren();
  chips.replaceChildren();
  say('');

  if (!text.trim()) {
    last = null;
    to.set('');
    badge.className = 'badge empty';
    badgeText.textContent = `Paste YAML or JSON`;
    why.hidden = true;
    promptBtn.hidden = true;
    return;
  }

  const r = source === 'yaml' ? parseYaml(text) : parseJson(text);
  last = r;
  if (!r.ok) {
    badge.className = 'badge bad';
    badgeText.textContent = `Not valid ${NAME[source]}`;
    why.textContent = r.problem.text;
    why.hidden = false;
    from.mark(r.problem.line);
    to.stale(!!to.value.trim());
    promptBtn.hidden = false;
    return;
  }

  why.hidden = true;
  promptBtn.hidden = true;
  badge.className = 'badge ok';
  badgeText.textContent = `Valid ${NAME[source]}`;
  const f = format();
  to.set(source === 'yaml' ? toJson(r.value, f) : toYaml(r.value, f));

  const parts = describe(r.stats);
  if (r.docs > 1) parts.unshift(`${r.docs} documents, shown as a list in JSON`);
  for (const p of parts) chips.append(Object.assign(document.createElement('li'), { textContent: p }));

  for (const w of r.warnings) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = w.text;
    b.addEventListener('click', () => editors.yaml.goTo(w.line));
    li.append(b);
    warns.append(li);
  }
}

why.addEventListener('click', () => {
  if (last && !last.ok) editors[source].goTo(last.problem.line);
});

for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-preset]')) {
  btn.addEventListener('click', () => {
    const p = PRESETS[btn.dataset.preset!];
    document.querySelectorAll('[data-preset]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    load(p.side, p.text);
  });
}

for (const input of [indent4, minify, sortKeys]) {
  input.addEventListener('change', () => {
    // Re-render the output side only; the visitor's own text is never rewritten.
    run();
  });
}
$<HTMLInputElement>('yj-indent2').addEventListener('change', run);

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    say(done);
  } catch {
    say('Your browser blocked copying. Select the text instead.');
  }
}

for (const side of ['yaml', 'json'] as Side[]) {
  $<HTMLButtonElement>(`yj-${side}-copy`).addEventListener('click', () => {
    const t = editors[side].value;
    if (!t.trim()) return say(`There’s no ${NAME[side]} to copy yet.`);
    copy(t, `Copied the ${NAME[side]}.`);
  });
  $<HTMLButtonElement>(`yj-${side}-download`).addEventListener('click', () => {
    const t = editors[side].value;
    if (!t.trim()) return say(`There’s no ${NAME[side]} to download yet.`);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([t], { type: side === 'json' ? 'application/json' : 'text/yaml' }));
    a.download = side === 'json' ? 'data.json' : 'data.yaml';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}

promptBtn.addEventListener('click', () => {
  if (!last || last.ok) return;
  const lang = source === 'yaml' ? 'yaml' : 'json';
  const prompt = `This ${NAME[source]} file has an error. A checker says: "${last.problem.text}"

Fix only that problem and keep everything else exactly as it is. Then show me the fixed file.

\`\`\`${lang}
${editors[source].value.trimEnd()}
\`\`\``;
  copy(prompt, 'Copied. Paste it into Claude Code, Cursor or Codex.');
});

$<HTMLButtonElement>('yj-clear').addEventListener('click', () => {
  editors.yaml.set('');
  editors.json.set('');
  document.querySelectorAll('[data-preset]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
  source = 'yaml';
  run();
  editors.yaml.ta.focus();
});

load('yaml', PRESETS.actions.text);
