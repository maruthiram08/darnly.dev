// px to rem converter: everything runs in the visitor's browser. Nothing is uploaded.
import { fmt, toRem, toPx, spacing, text, convertCss, readNumber } from './px-to-rem-core';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const pxIn = $<HTMLInputElement>('pr-px');
const remIn = $<HTMLInputElement>('pr-rem');
const baseIn = $<HTMLInputElement>('pr-base');
const err = $<HTMLParagraphElement>('pr-error');
const bigPx = $<HTMLElement>('pr-big-px');
const bigRem = $<HTMLElement>('pr-big-rem');
const twSpace = $<HTMLButtonElement>('pr-tw-space');
const twText = $<HTMLButtonElement>('pr-tw-text');
const twNote = $<HTMLElement>('pr-tw-note');
const bar = $<HTMLDivElement>('pr-bar');
const barLabel = $<HTMLElement>('pr-bar-label');
const box = $<HTMLDivElement>('pr-box');
const sample = $<HTMLElement>('pr-sample');
const scaleNote = $<HTMLElement>('pr-scale');
const tableBody = $<HTMLTableSectionElement>('pr-table');
const baseNotes = document.querySelectorAll<HTMLElement>('.pr-base-note');
const cssIn = $<HTMLTextAreaElement>('pr-css-in');
const cssOut = $<HTMLPreElement>('pr-css-out');
const cssCount = $<HTMLElement>('pr-css-count');
const keep1 = $<HTMLInputElement>('pr-keep1');
const skipMedia = $<HTMLInputElement>('pr-media');
const copyCss = $<HTMLButtonElement>('pr-copy-css');
const copyPrompt = $<HTMLButtonElement>('pr-prompt');
const linkBtn = $<HTMLButtonElement>('pr-link');
const status = $<HTMLParagraphElement>('pr-status');

const COMMON = [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 30, 32, 36, 40, 48, 56, 60, 64, 72, 80, 96, 128];

let px = 24;
let base = 16;

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

// The live preview: big numbers, Tailwind classes, and the size drawn on screen.
function render() {
  const rem = toRem(px, base);
  bigPx.textContent = `${fmt(px)}px`;
  bigRem.textContent = `${fmt(rem)}rem`;

  const sp = spacing(rem, px);
  const tx = text(rem);
  twSpace.textContent = sp.cls;
  twText.textContent = tx.cls;
  twSpace.classList.toggle('exact', sp.exact);
  twText.classList.toggle('exact', tx.exact);
  twNote.textContent = sp.note
    ? `${sp.cls} needs Tailwind v4. In v3, use p-[${fmt(rem)}rem].`
    : !sp.exact
      ? 'No ready-made spacing class, so this uses an exact value.'
      : '';

  // Drawn at real size, so 24px on the ruler is 24px on your screen. Very large values are shrunk to fit.
  const size = Math.abs(px);
  const room = Math.max(120, bar.parentElement!.clientWidth - 8);
  const fit = size > room ? room / size : 1;
  bar.style.width = `${size * fit}px`;
  barLabel.textContent = `${fmt(px)}px`;
  const boxSize = Math.min(size, 200);
  box.style.width = box.style.height = `${boxSize}px`;
  box.title = `${fmt(px)} × ${fmt(px)}px`;
  sample.style.fontSize = `${Math.min(size, 160)}px`;
  scaleNote.hidden = fit === 1 && size <= 160;

  baseNotes.forEach((el) => (el.textContent = `${fmt(base)}px`));
}

function syncInputs(from: 'px' | 'rem' | 'base' | 'none') {
  if (from !== 'px') pxIn.value = fmt(px);
  if (from !== 'rem') remIn.value = fmt(toRem(px, base));
  if (from !== 'base') baseIn.value = fmt(base);
}

function bad(show: boolean) {
  err.hidden = !show;
}

pxIn.addEventListener('input', () => {
  const v = readNumber(pxIn.value);
  bad(v === null && pxIn.value.trim() !== '');
  if (v === null) return;
  px = v;
  syncInputs('px');
  render();
  saveUrl();
});

remIn.addEventListener('input', () => {
  const v = readNumber(remIn.value);
  bad(v === null && remIn.value.trim() !== '');
  if (v === null) return;
  px = toPx(v, base);
  syncInputs('rem');
  render();
  saveUrl();
});

baseIn.addEventListener('input', () => {
  const v = readNumber(baseIn.value);
  if (v === null || v <= 0) return;
  base = v;
  syncInputs('base');
  render();
  table();
  css();
  saveUrl();
});

// Two-way table of common sizes. Clicking a row loads it into the preview.
function table() {
  tableBody.replaceChildren(
    ...COMMON.map((v) => {
      const rem = toRem(v, base);
      const tr = document.createElement('tr');
      tr.tabIndex = 0;
      const cells = [`${v}px`, `${fmt(rem)}rem`, spacing(rem, v).cls, text(rem).cls];
      for (const c of cells) {
        const td = document.createElement('td');
        td.textContent = c;
        tr.append(td);
      }
      const pick = () => {
        px = v;
        syncInputs('none');
        render();
        saveUrl();
        $('pr-stage').scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
      tr.addEventListener('click', pick);
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pick();
        }
      });
      return tr;
    }),
  );
}

// Paste a block of CSS and get it back in rem.
let converted = '';
function css() {
  const r = convertCss(cssIn.value, { base, keep1px: keep1.checked, skipMedia: skipMedia.checked });
  converted = r.out;
  cssOut.textContent = r.out || ' ';
  cssCount.textContent =
    r.count === 0 ? 'No px values found yet.' : `Changed ${r.count} ${r.count === 1 ? 'value' : 'values'} to rem.`;
}

cssIn.addEventListener('input', css);
keep1.addEventListener('change', css);
skipMedia.addEventListener('change', css);
copyCss.addEventListener('click', () => copy(converted, 'Copied the CSS in rem.'));

copyPrompt.addEventListener('click', () => {
  const rules = [
    `Convert every px value in my CSS (and inline styles / Tailwind arbitrary values like p-[24px]) to rem, using a ${fmt(base)}px base: rem = px ÷ ${fmt(base)}.`,
    keep1.checked ? 'Keep 1px values (hairline borders) in px.' : 'Convert 1px values too.',
    skipMedia.checked ? 'Leave the numbers inside @media queries as they are.' : 'Convert @media query breakpoints too.',
    'Where a Tailwind class matches exactly, use it instead of an arbitrary value (16px → p-4, 14px text → text-sm).',
    'Round to at most 4 decimals. Do not change anything else, and show me the list of files you changed.',
  ];
  copy(rules.join('\n'), 'Copied. Paste it into Claude Code, Cursor or Codex.');
});

twSpace.addEventListener('click', () => copy(twSpace.textContent || '', `Copied ${twSpace.textContent}.`));
twText.addEventListener('click', () => copy(twText.textContent || '', `Copied ${twText.textContent}.`));
bigRem.addEventListener('click', () => copy(bigRem.textContent || '', `Copied ${bigRem.textContent}.`));

// The address keeps the value and base, so a result can be shared.
function saveUrl() {
  const url = new URL(location.href);
  url.searchParams.set('px', fmt(px));
  if (base !== 16) url.searchParams.set('base', fmt(base));
  else url.searchParams.delete('base');
  history.replaceState(null, '', url);
}

linkBtn.addEventListener('click', () => copy(location.href, 'Link copied.'));

window.addEventListener('resize', render);

const q = new URLSearchParams(location.search);
const qPx = readNumber(q.get('px') || '');
const qBase = readNumber(q.get('base') || '');
if (qPx !== null) px = qPx;
if (qBase !== null && qBase > 0) base = qBase;

syncInputs('none');
render();
table();
css();
