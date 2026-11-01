// JSON to TypeScript: everything runs in the visitor's browser. Nothing is sent anywhere.
import { parse, format, toTypeScript, toZod, pascal, JsonError, type Json, type Options } from './json-to-typescript-core';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('jt-input');
const example = $<HTMLButtonElement>('jt-example');
const clear = $<HTMLButtonElement>('jt-clear');
const rootName = $<HTMLInputElement>('jt-root');
const optional = $<HTMLInputElement>('jt-optional');
const readonly = $<HTMLInputElement>('jt-readonly');
const status = $<HTMLParagraphElement>('jt-status');
const error = $<HTMLDivElement>('jt-error');
const errorMsg = $<HTMLParagraphElement>('jt-error-msg');
const errorSnippet = $<HTMLPreElement>('jt-error-snippet');
const result = $<HTMLDivElement>('jt-result');
const code = $<HTMLElement>('jt-code');
const copy = $<HTMLButtonElement>('jt-copy');
const prompt = $<HTMLButtonElement>('jt-prompt');
const tabs = [...document.querySelectorAll<HTMLButtonElement>('#jt-tabs [role="tab"]')];

type Tab = 'ts' | 'zod' | 'json';
let tab: Tab = 'ts';
let parsed: Json | undefined;
let outputs: Record<Tab, string> = { ts: '', zod: '', json: '' };

const EXAMPLE = `{
  "id": 4821,
  "email": "ada@example.com",
  "name": "Ada Lovelace",
  "avatarUrl": "https://example.com/ada.png",
  "isAdmin": false,
  "createdAt": "2026-10-31T09:12:00Z",
  "plan": { "name": "Pro", "seats": 5, "renewsAt": "2026-12-01" },
  "projects": [
    { "id": "p_1", "title": "Landing page", "tags": ["astro", "seo"], "dueDate": null, "stars": 12 },
    { "id": "p_2", "title": "Invoice app", "tags": [], "dueDate": "2026-11-15", "archived": true }
  ]
}`;

function style(): Options['style'] {
  return (document.querySelector<HTMLInputElement>('input[name="jt-style"]:checked')?.value as Options['style']) ?? 'interface';
}

function options(): Options {
  return { rootName: rootName.value.trim() || 'Root', style: style(), optional: optional.checked, readonly: readonly.checked };
}

function showError(e: JsonError) {
  const lines = input.value.split('\n');
  const line = lines[e.line - 1] ?? '';
  // Show the bad line with a marker under the spot, trimmed so long lines stay readable.
  const start = Math.max(0, e.column - 40);
  const shown = (start > 0 ? '…' : '') + line.slice(start, start + 80);
  const caret = ' '.repeat(e.column - 1 - start + (start > 0 ? 1 : 0)) + '^';
  errorMsg.textContent = `Line ${e.line}, column ${e.column}: ${e.message}`;
  errorSnippet.textContent = `${shown}\n${caret}`;
  error.hidden = false;
}

function render() {
  const text = input.value;
  error.hidden = true;
  if (!text.trim()) {
    parsed = undefined;
    result.hidden = true;
    status.textContent = '';
    return;
  }
  try {
    parsed = parse(text);
  } catch (e) {
    parsed = undefined;
    result.hidden = true;
    status.textContent = '';
    if (e instanceof JsonError) showError(e);
    else throw e;
    return;
  }
  const o = options();
  outputs = { ts: toTypeScript(parsed, o), zod: toZod(parsed, o), json: format(parsed) + '\n' };
  status.textContent = 'Valid JSON.';
  result.hidden = false;
  show();
}

function show() {
  for (const t of tabs) {
    const on = t.dataset.tab === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
  }
  code.textContent = outputs[tab];
  copy.textContent = 'Copy';
}

async function copyText(text: string, btn: HTMLButtonElement, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = 'Press Ctrl+C';
    const range = document.createRange();
    range.selectNodeContents(code);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
  }
  setTimeout(() => (btn.textContent = label), 1600);
}

let timer = 0;
input.addEventListener('input', () => {
  clearTimeout(timer);
  timer = window.setTimeout(render, input.value.length > 200_000 ? 400 : 120);
});
for (const el of [rootName, optional, readonly, ...document.querySelectorAll<HTMLInputElement>('input[name="jt-style"]')])
  el.addEventListener('input', render);

example.addEventListener('click', () => {
  input.value = EXAMPLE;
  if (!rootName.value.trim()) rootName.value = 'User';
  render();
});
clear.addEventListener('click', () => {
  input.value = '';
  render();
  input.focus();
});

tabs.forEach((t, k) => {
  t.addEventListener('click', () => {
    tab = t.dataset.tab as Tab;
    show();
  });
  t.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = tabs[(k + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    next.click();
    next.focus();
  });
});

copy.addEventListener('click', () => copyText(outputs[tab], copy, 'Copy'));

prompt.addEventListener('click', () => {
  if (!parsed) return;
  const name = pascal(options().rootName);
  const zod = tab === 'zod';
  const text = zod
    ? `Add this Zod schema to my project in a file like src/types/${name}.ts (install zod if it isn't there yet). Use ${name}Schema.parse() where my app receives this data, and use the ${name} type in place of any "any" or loose types for it.\n\n${outputs.zod}`
    : `Add these TypeScript types to my project in a file like src/types/${name}.ts. Use the ${name} type where my app receives this data (for example the API call that returns it) and in place of any "any" or loose types for it. Don't change how the app behaves.\n\n${outputs.ts}`;
  copyText(text, prompt, 'Copy prompt for your AI agent');
});

render();
