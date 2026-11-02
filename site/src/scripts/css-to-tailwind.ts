// CSS to Tailwind page: everything runs in the visitor's browser. Nothing is uploaded.
import { convert, classString, type Result, type RuleOut, type Variant, type Version } from './css-to-tailwind-core';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('ct-input');
const exampleBtn = $<HTMLButtonElement>('ct-example');
const clearBtn = $<HTMLButtonElement>('ct-clear');
const errorBox = $<HTMLParagraphElement>('ct-error');
const pick = $<HTMLDivElement>('ct-pick');
const paneA = $<HTMLDivElement>('ct-a');
const paneB = $<HTMLDivElement>('ct-b');
const verdict = $<HTMLParagraphElement>('ct-verdict');
const diffs = $<HTMLUListElement>('ct-diffs');
const out = $<HTMLOListElement>('ct-out');
const empty = $<HTMLParagraphElement>('ct-empty');
const snap = $<HTMLInputElement>('ct-snap');
const allBtn = $<HTMLButtonElement>('ct-all');
const promptBtn = $<HTMLButtonElement>('ct-prompt');
const status = $<HTMLParagraphElement>('ct-status');
const table = $<HTMLTableSectionElement>('ct-table');
const versionBtns = [...document.querySelectorAll<HTMLButtonElement>('[data-version]')];

const EXAMPLE = `.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  background: #2563eb;
  color: white;
  font-size: 16px;
  font-weight: 600;
  border: none;
  border-radius: 8px;
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  cursor: pointer;
  transition: background 0.2s ease;
}
.btn:hover { background: #1d4ed8; }
.btn:focus-visible { outline: 2px solid #93c5fd; outline-offset: 2px; }

.card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 448px;
  padding: 24px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1);
}
.card:hover .title { color: #2563eb; }

@media (min-width: 768px) {
  .card { flex-direction: row; padding: 32px; }
}

.title {
  font-size: 20px;
  font-weight: 700;
  color: #111827;
  letter-spacing: -0.025em;
  margin: 0 0 6px;
}`;

let version: Version = 'v4';
let result: Result = { rules: [], counts: { exact: 0, near: 0, arbitrary: 0 } };
let selected = 0;

// Named colors and anything else the browser understands go through a 1px canvas.
const canvas = document.createElement('canvas');
canvas.width = canvas.height = 1;
const cx = canvas.getContext('2d', { willReadFrequently: true });
function parseColor(s: string): [number, number, number, number] | null {
  if (!cx || !CSS.supports('color', s) || /^var\(/i.test(s)) return null;
  cx.clearRect(0, 0, 1, 1);
  cx.fillStyle = '#000';
  cx.fillStyle = s;
  cx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = cx.getImageData(0, 0, 1, 1).data;
  return [r, g, b, a / 255];
}

// ---------------- Preview ----------------

let styleEl = document.createElement('style');
document.head.append(styleEl);

type PreviewRule = { variants: Variant[]; decls: [string, string, boolean][] };

function mediaText(vs: Variant[]): string {
  const parts: string[] = [];
  for (const v of vs) {
    if (v.minPx !== undefined) parts.push(`(min-width: ${v.minPx}px)`);
    if (v.maxPx !== undefined) parts.push(`(max-width: ${v.maxPx}px)`);
    if (v.dark) parts.push('(prefers-color-scheme: dark)');
    if (v.motion) parts.push('(prefers-reduced-motion: reduce)');
    if (v.prefix === 'print:') parts.push('print');
  }
  return parts.join(' and ');
}

// Rules go in through the CSSOM one property at a time, so pasted CSS can never style anything outside the preview.
function addRules(sheet: CSSStyleSheet, scope: string, rules: PreviewRule[]) {
  const ordered = [...rules].sort((a, b) => Number(!!mediaText(a.variants)) - Number(!!mediaText(b.variants)));
  for (const r of ordered) {
    const pseudo = r.variants.map((v) => v.pseudo ?? '').join('');
    const media = mediaText(r.variants);
    try {
      let target: CSSStyleRule;
      if (media) {
        const i = sheet.insertRule(`@media ${media} { ${scope}${pseudo} {} }`, sheet.cssRules.length);
        target = (sheet.cssRules[i] as CSSMediaRule).cssRules[0] as CSSStyleRule;
      } else {
        const i = sheet.insertRule(`${scope}${pseudo} {}`, sheet.cssRules.length);
        target = sheet.cssRules[i] as CSSStyleRule;
      }
      for (const [p, v, imp] of r.decls) target.style.setProperty(p, v, imp ? 'important' : '');
    } catch {
      // a pseudo-class this browser doesn't know: skip it
    }
  }
}

function sampleContent(rule: RuleOut): Node[] {
  const base = rule.original.filter((o) => !o.variants.length).flatMap((o) => o.decls);
  const display = base.filter((d) => d.prop === 'display').pop()?.value ?? '';
  const sel = rule.selector.toLowerCase();
  if (/btn|button|cta/.test(sel)) {
    return ['Click me', '→'].map((t) => {
      const s = document.createElement('span');
      s.textContent = t;
      return s;
    });
  }
  if (/flex|grid/.test(display)) {
    return ['One', 'Two', 'Three'].map((t) => {
      const s = document.createElement('span');
      s.className = 'ct-item';
      s.textContent = t;
      return s;
    });
  }
  const text = /h[1-6]|title|heading|headline/.test(sel)
      ? 'A heading'
      : /link|\ba\b/.test(sel)
        ? 'A link'
        : 'The quick brown fox jumps over the lazy dog.';
  return [document.createTextNode(text)];
}

function drawPreview() {
  // a fresh <style> each time: emptying the old one doesn't drop rules added through the CSSOM
  const fresh = document.createElement('style');
  styleEl.replaceWith(fresh);
  styleEl = fresh;
  const sheet = styleEl.sheet!;
  paneA.replaceChildren();
  paneB.replaceChildren();
  const rule = result.rules[selected];
  if (!rule) {
    verdict.textContent = '';
    verdict.className = 'verdict';
    diffs.hidden = true;
    return;
  }
  const a = document.createElement('div');
  const b = document.createElement('div');
  a.className = b.className = 'ct-sample';
  a.append(...sampleContent(rule));
  b.append(...sampleContent(rule));
  paneA.append(a);
  paneB.append(b);

  addRules(sheet, '#ct-a > .ct-sample', rule.original.map((o) => ({ variants: o.variants, decls: o.decls.map((d) => [d.prop, d.value, d.important] as [string, string, boolean]) })));
  addRules(sheet, '#ct-b > .ct-sample', rule.tokens.map((t) => ({ variants: t.variants, decls: t.css.map(([p, v]) => [p, v, t.from.endsWith('!important')] as [string, string, boolean]) })));
  compare(a, b, rule);
}

const CHECK: [string, string][] = [
  ['display', 'display'], ['width', 'width'], ['height', 'height'],
  ['padding-top', 'top padding'], ['padding-right', 'right padding'], ['padding-bottom', 'bottom padding'], ['padding-left', 'left padding'],
  ['margin-top', 'top margin'], ['margin-bottom', 'bottom margin'],
  ['color', 'text color'], ['background-color', 'background color'], ['background-image', 'background image'],
  ['font-size', 'text size'], ['font-weight', 'font weight'], ['line-height', 'line height'], ['letter-spacing', 'letter spacing'],
  ['text-align', 'text alignment'], ['text-transform', 'text case'],
  ['border-top-width', 'border width'], ['border-top-style', 'border style'], ['border-top-color', 'border color'],
  ['border-top-left-radius', 'corner rounding'], ['border-bottom-right-radius', 'corner rounding'],
  ['box-shadow', 'shadow'], ['opacity', 'opacity'],
  ['flex-direction', 'flex direction'], ['justify-content', 'justify'], ['align-items', 'align items'], ['row-gap', 'gap'], ['column-gap', 'gap'],
  ['grid-template-columns', 'grid columns'], ['max-width', 'max width'], ['position', 'position'], ['z-index', 'z-index'],
];

function nums(s: string) {
  return (s.match(/-?\d*\.?\d+/g) ?? []).map(Number);
}

function same(p: string, x: string, y: string): boolean {
  if (x === y) return true;
  const a = nums(x);
  const b = nums(y);
  if (a.length !== b.length || !a.length) return false;
  if (x.replace(/-?\d*\.?\d+/g, '#') !== y.replace(/-?\d*\.?\d+/g, '#')) return false;
  // colors within a few steps per channel look the same; lengths within half a pixel
  const tol = /color|shadow/.test(p) ? 10 : 0.6;
  return a.every((v, i) => Math.abs(v - b[i]) <= tol);
}

function compare(a: HTMLElement, b: HTMLElement, rule: RuleOut) {
  const ca = getComputedStyle(a);
  const cb = getComputedStyle(b);
  const found: string[] = [];
  const seen = new Set<string>();
  for (const [p, label] of CHECK) {
    const x = ca.getPropertyValue(p);
    const y = cb.getPropertyValue(p);
    if (same(p, x, y) || seen.has(label)) continue;
    // with no border, its style and color don't show
    if (/^border-top-(style|color)$/.test(p) && parseFloat(ca.borderTopWidth) === 0 && parseFloat(cb.borderTopWidth) === 0) continue;
    seen.add(label);
    const why = p === 'line-height' && rule.tokens.some((t) => /(^|:)text-(xs|sm|base|lg|\d?xl)$/.test(t.cls)) ? ' (Tailwind text sizes bring their own line height; add a leading-* class to change it)' : '';
    found.push(`<strong>${label}</strong>: <code>${esc(short(x))}</code> → <code>${esc(short(y))}</code>${why}`);
  }
  // a different width or height is usually just the result of another difference, so only show it on its own
  if (found.length > 1) {
    const rest = found.filter((f) => !/^<strong>(width|height)<\/strong>/.test(f));
    if (rest.length) found.splice(0, found.length, ...rest);
  }
  const total = rule.tokens.length;
  const arb = rule.tokens.filter((t) => t.kind === 'arbitrary').length;
  const hover = rule.tokens.some((t) => t.variants.some((v) => v.pseudo && /hover/.test(v.pseudo)));
  const tail = arb ? ` ${total - arb} of ${total} classes are standard Tailwind, ${arb} ${arb === 1 ? 'is an exact value' : 'are exact values'} in square brackets.` : ` All ${total} classes are standard Tailwind.`;
  const hint = hover ? ' Hover both to compare hover styles.' : '';
  if (!found.length) {
    verdict.className = 'verdict ok';
    verdict.textContent = `✓ They look the same.${tail}${hint}`;
    diffs.hidden = true;
  } else {
    verdict.className = 'verdict warn';
    verdict.textContent = `Almost the same: ${found.length} small ${found.length === 1 ? 'difference' : 'differences'}.${tail}${hint}`;
    diffs.innerHTML = found.map((f) => `<li>${f}</li>`).join('');
    diffs.hidden = false;
  }
}

const short = (s: string) => (s.length > 60 ? s.slice(0, 57) + '…' : s);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// ---------------- Output ----------------

function render() {
  result = convert(input.value, { version, snapColors: snap.checked, parseColor });
  if (selected >= result.rules.length) selected = 0;

  errorBox.hidden = !result.error;
  errorBox.textContent = result.error ?? '';

  pick.replaceChildren();
  if (result.rules.length > 1) {
    result.rules.forEach((r, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', String(i === selected));
      btn.textContent = r.selector;
      btn.addEventListener('click', () => {
        selected = i;
        pick.querySelectorAll('button').forEach((x, j) => x.setAttribute('aria-selected', String(j === i)));
        drawPreview();
      });
      pick.append(btn);
    });
  }

  out.replaceChildren();
  table.replaceChildren();
  empty.hidden = result.rules.length > 0;
  for (const r of result.rules) {
    const li = document.createElement('li');
    const row = document.createElement('div');
    row.className = 'row';
    const sel = document.createElement('span');
    sel.className = 'sel';
    sel.textContent = r.selector === 'element' ? 'Your element' : r.selector;
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'copy';
    copy.textContent = 'Copy';
    copy.addEventListener('click', () => copyText(classString(r), copy, 'Copy'));
    row.append(sel, copy);
    const p = document.createElement('p');
    p.className = 'cls';
    r.tokens.forEach((t, i) => {
      const span = document.createElement('span');
      span.className = `t ${t.kind}`;
      span.textContent = t.cls;
      span.title = t.note ? `${t.from}\n${t.note}` : t.from;
      p.append(span);
      if (i < r.tokens.length - 1) p.append(' ');
    });
    if (!r.tokens.length) p.textContent = '(nothing to convert)';
    li.append(row, p);
    for (const n of r.notes) {
      const note = document.createElement('p');
      note.className = 'note';
      note.textContent = n;
      li.append(note);
    }
    out.append(li);

    for (const t of r.tokens) {
      const tr = document.createElement('tr');
      const cells = [r.selector, t.from, t.cls, t.note ?? ''];
      cells.forEach((c, i) => {
        const td = document.createElement('td');
        td.textContent = c;
        if (i === 2 && t.kind === 'arbitrary') td.className = 'arbitrary';
        if (i === 3) td.className = 'n';
        tr.append(td);
      });
      table.append(tr);
    }
  }
  drawPreview();
}

// ---------------- Copy ----------------

async function copyText(text: string, btn: HTMLButtonElement, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = 'Couldn’t copy';
  }
  setTimeout(() => (btn.textContent = label), 1600);
}

function allText(): string {
  return result.rules.map((r) => `${r.selector === 'element' ? 'Your element' : r.selector}\n  ${classString(r)}`).join('\n\n');
}

allBtn.addEventListener('click', () => {
  if (!result.rules.length) return;
  copyText(allText(), allBtn, 'Copy all');
});

promptBtn.addEventListener('click', () => {
  if (!result.rules.length) {
    status.textContent = 'Paste some CSS first.';
    return;
  }
  const notes = result.rules.flatMap((r) => r.notes);
  const text = [
    `Convert this component's CSS to Tailwind (${version}).`,
    '',
    'Here are the Tailwind classes for each selector, worked out with darnly.dev/tools/css-to-tailwind:',
    '',
    allText(),
    '',
    ...(notes.length ? ['Notes:', ...notes.map((n) => `- ${n}`), ''] : []),
    'Put these classes on the elements that use each selector (class or className). Keep any class names JavaScript or tests still rely on, and delete the old CSS rules once nothing else uses them. Classes in square brackets are exact values: if my Tailwind theme already has a matching token, use that instead. The page must look exactly the same afterwards, so check it in the browser, including hover states and at phone and desktop widths.',
    '',
    'Original CSS:',
    '```css',
    input.value.trim(),
    '```',
  ].join('\n');
  copyText(text, promptBtn, 'Copy prompt for your AI agent');
  status.textContent = 'Paste it into Claude Code, Cursor or Codex.';
});

// ---------------- Wiring ----------------

let timer = 0;
input.addEventListener('input', () => {
  clearTimeout(timer);
  timer = window.setTimeout(render, 150);
});
exampleBtn.addEventListener('click', () => {
  input.value = EXAMPLE;
  selected = 0;
  render();
});
clearBtn.addEventListener('click', () => {
  input.value = '';
  render();
  input.focus();
});
snap.addEventListener('change', render);
for (const btn of versionBtns) {
  btn.addEventListener('click', () => {
    version = btn.dataset.version as Version;
    versionBtns.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    render();
  });
}

input.value = EXAMPLE;
render();
