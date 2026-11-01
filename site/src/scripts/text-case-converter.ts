// Text case converter: everything runs in the visitor's browser. Nothing is uploaded.
import {
  CASES,
  ENV_PREFIXES,
  convert,
  convertLines,
  detect,
  convertKeys,
  parseJson,
  convertEnv,
  looksSecret,
  type CaseId,
} from './text-case-converter-core';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $<HTMLParagraphElement>('tc-status');
const nameOf = (id: CaseId) => CASES.find((c) => c.id === id)!.name;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let statusTimer = 0;
function say(msg: string) {
  status.textContent = msg;
  clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => (status.textContent = ''), 4000);
}

async function copy(text: string, done: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    say(done);
    return true;
  } catch {
    say('Your browser blocked copying. Select the text instead.');
    return false;
  }
}

// ---- Tabs ----

type Mode = 'text' | 'json' | 'env';
const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('#tc-modes [data-mode]'));
const panes: Record<Mode, HTMLElement> = { text: $('tc-text'), json: $('tc-json'), env: $('tc-env') };

function show(mode: Mode, push = true) {
  for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.mode === mode));
  for (const [k, p] of Object.entries(panes)) p.hidden = k !== mode;
  if (push) history.replaceState(null, '', mode === 'text' ? location.pathname + location.search : `#${mode}`);
  if (mode === 'json') renderJson();
  if (mode === 'env') renderEnv();
}
for (const t of tabs) t.addEventListener('click', () => show(t.dataset.mode as Mode));

// Radio-style chip groups.
function chips(groupId: string, onChange: () => void): () => CaseId {
  const group = $(groupId);
  const all = Array.from(group.querySelectorAll<HTMLButtonElement>('[data-case]'));
  for (const b of all) {
    b.addEventListener('click', () => {
      for (const o of all) o.setAttribute('aria-checked', String(o === b));
      onChange();
    });
  }
  return () => (all.find((b) => b.getAttribute('aria-checked') === 'true')?.dataset.case || all[0].dataset.case) as CaseId;
}

// ---- Text or names ----

const input = $<HTMLTextAreaElement>('tc-in');
const detected = $<HTMLElement>('tc-detected');
const count = $<HTMLElement>('tc-count');
const empty = $<HTMLElement>('tc-empty');
const rowsList = $<HTMLUListElement>('tc-rows');
const rows = Array.from(document.querySelectorAll<HTMLButtonElement>('#tc-rows .row'));
const values = new Map<CaseId, string>();

function grow() {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight + 2, 320)}px`;
}

function renderText() {
  const text = input.value;
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).length;
  const has = lines > 0;
  empty.hidden = has;
  rowsList.hidden = !has;
  count.textContent = lines > 1 ? `${lines} names, one per line` : '';

  const found = detect(text);
  detected.hidden = !found;
  if (found) detected.textContent = `Looks like ${nameOf(found)}`;

  for (const row of rows) {
    const id = row.dataset.case as CaseId;
    const out = lines > 1 ? convertLines(text.replace(/^\s*\n|\n\s*$/g, ''), id) : convert(text, id);
    values.set(id, out);
    const val = row.querySelector<HTMLElement>('[data-val]')!;
    val.textContent = out || ' ';
    val.classList.toggle('many', lines > 1);
    // Mark the row that matches what was pasted (single names only).
    const you = found === id;
    row.classList.toggle('you', you);
    row.querySelector<HTMLElement>('.row-you')!.hidden = !you;
  }
}

for (const row of rows) {
  row.addEventListener('click', async () => {
    const id = row.dataset.case as CaseId;
    const out = values.get(id) || '';
    if (!out.trim()) return;
    const lines = out.split('\n').filter(Boolean).length;
    if (await copy(out, lines > 1 ? `Copied ${lines} names as ${nameOf(id)}.` : `Copied ${out}`)) {
      for (const r of rows) r.classList.remove('done');
      row.classList.add('done');
      const label = row.querySelector<HTMLElement>('.row-copy')!;
      label.textContent = 'Copied';
      setTimeout(() => {
        row.classList.remove('done');
        label.textContent = 'Copy';
      }, 1500);
    }
  });
}

input.addEventListener('input', () => {
  grow();
  renderText();
});
$('tc-clear').addEventListener('click', () => {
  input.value = '';
  grow();
  renderText();
  input.focus();
});

// ---- JSON keys ----

const jsonIn = $<HTMLTextAreaElement>('tc-json-in');
const jsonOut = $<HTMLPreElement>('tc-json-out');
const jsonErr = $<HTMLElement>('tc-json-error');
const jsonClash = $<HTMLElement>('tc-json-clash');
const jsonCount = $<HTMLElement>('tc-json-count');
const jsonDeep = $<HTMLInputElement>('tc-json-deep');
const jsonTarget = chips('tc-json-target', () => renderJson());
let jsonText = '';

// Pretty-print like JSON.stringify(v, null, 2), with renamed keys highlighted.
function highlight(orig: unknown, id: CaseId, deep: boolean, depth = 0, pad = ''): string {
  const inner = pad + '  ';
  if (Array.isArray(orig)) {
    if (!orig.length) return '[]';
    return `[\n${orig.map((x) => inner + highlight(x, id, deep, depth, inner)).join(',\n')}\n${pad}]`;
  }
  if (orig && typeof orig === 'object') {
    const entries = Object.entries(orig as Record<string, unknown>);
    if (!entries.length) return '{}';
    const convertHere = deep || depth === 0;
    const parts = entries.map(([k, v]) => {
      const nk = convertHere ? convert(k, id) || k : k;
      const key = esc(JSON.stringify(nk));
      const shown = nk !== k ? `<mark>${key}</mark>` : `<span class="k">${key}</span>`;
      return `${inner}${shown}: ${highlight(v, id, deep, depth + 1, inner)}`;
    });
    return `{\n${parts.join(',\n')}\n${pad}}`;
  }
  const s = esc(JSON.stringify(orig));
  if (typeof orig === 'string') return `<span class="s">${s}</span>`;
  return `<span class="n">${s}</span>`;
}

function renderJson() {
  const id = jsonTarget();
  const src = jsonIn.value.trim();
  jsonClash.hidden = true;
  if (!src) {
    jsonErr.hidden = true;
    jsonOut.textContent = '';
    jsonCount.textContent = '';
    jsonText = '';
    return;
  }
  const parsed = parseJson(src);
  if (!parsed.ok) {
    jsonErr.hidden = false;
    jsonErr.textContent = `That isn’t valid JSON yet: ${parsed.error}`;
    return;
  }
  jsonErr.hidden = true;
  const res = convertKeys(parsed.value, id, jsonDeep.checked);
  jsonText = JSON.stringify(res.value, null, 2);
  jsonOut.innerHTML = highlight(parsed.value, id, jsonDeep.checked);
  jsonCount.textContent = res.total
    ? `${res.changed} of ${res.total} keys renamed to ${nameOf(id)}`
    : 'No object keys to rename.';
  if (res.clashes.length) {
    jsonClash.hidden = false;
    jsonClash.innerHTML = `Two keys now have the same name, so one value is lost: ${res.clashes
      .slice(0, 3)
      .map((c) => `<code>${esc(c)}</code>`)
      .join(', ')}. Rename one of them first.`;
  }
}

jsonIn.addEventListener('input', renderJson);
jsonDeep.addEventListener('change', renderJson);
$('tc-json-copy').addEventListener('click', () => {
  if (jsonText) copy(jsonText, `Copied the JSON with ${nameOf(jsonTarget())} keys.`);
});
$('tc-json-prompt').addEventListener('click', () => {
  const id = jsonTarget();
  const from = id === 'camel' ? 'snake_case' : 'camelCase';
  copy(
    [
      `The API returns keys in ${from}, but our code uses ${nameOf(id)}.`,
      `Convert the keys of API responses to ${nameOf(id)} in one place (a small helper used where the data is fetched), including nested objects and arrays.`,
      'Do not rename values, only keys. Update the TypeScript types to match, and convert keys back when sending data to the API.',
      'Show me the helper and every file you changed.',
    ].join('\n'),
    'Copied. Paste it into Claude Code, Cursor or Codex.'
  );
});

// ---- .env names ----

const envIn = $<HTMLTextAreaElement>('tc-env-in');
const envOut = $<HTMLPreElement>('tc-env-out');
const envSecret = $<HTMLElement>('tc-env-secret');
const envCount = $<HTMLElement>('tc-env-count');
const envPrefix = $<HTMLSelectElement>('tc-env-prefix');
const envTarget = chips('tc-env-target', () => renderEnv());
let envText = '';
const PUBLIC = ENV_PREFIXES.filter(Boolean);

function renderEnv() {
  const id = envTarget();
  const res = convertEnv(envIn.value, id, envPrefix.value);
  envText = res.text;
  envOut.innerHTML = res.lines
    .map((l) => {
      if (l.kind === 'other') return /^\s*#/.test(l.text) ? `<span class="c">${esc(l.text)}</span>` : esc(l.text);
      const i = l.text.indexOf(l.after);
      const name = l.after !== l.before ? `<mark>${esc(l.after)}</mark>` : `<span class="k">${esc(l.after)}</span>`;
      return esc(l.text.slice(0, i)) + name + `<span class="s">${esc(l.text.slice(i + l.after.length))}</span>`;
    })
    .join('\n');
  const names = res.lines.filter((l) => l.kind === 'name').length;
  envCount.textContent = names ? `${res.changed} of ${names} names renamed` : '';

  // Public prefixes ship to the browser. Warn when a secret-looking name gets one.
  const leaks = res.lines.filter(
    (l): l is Extract<typeof l, { kind: 'name' }> =>
      l.kind === 'name' && PUBLIC.some((p) => convert(l.after, 'screaming').startsWith(convert(p, 'screaming') + '_')) && looksSecret(l.after)
  );
  envSecret.hidden = !leaks.length;
  if (leaks.length) {
    envSecret.innerHTML = `Careful: ${leaks
      .slice(0, 3)
      .map((l) => `<code>${esc(l.after)}</code>`)
      .join(', ')} ${leaks.length === 1 ? 'looks like a secret. With a public prefix it is' : 'look like secrets. With a public prefix they are'} sent to every visitor’s browser. Keep secrets without the prefix and use them on the server only.`;
  }
}

envIn.addEventListener('input', renderEnv);
envPrefix.addEventListener('change', renderEnv);
$('tc-env-copy').addEventListener('click', () => {
  if (envText.trim()) copy(envText, 'Copied the renamed names.');
});

// ---- Start ----

grow();
renderText();
const start = location.hash.slice(1);
show(start === 'json' || start === 'env' ? start : 'text', false);
if (start !== 'json') renderJson();
if (start !== 'env') renderEnv();
