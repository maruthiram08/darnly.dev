// SVG optimizer page: everything runs in the visitor's browser. Nothing is uploaded.
import { optimize, jsx, dataUri, cssBackground, componentName } from './svg-lite';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const fileInput = $<HTMLInputElement>('so-file');
const drop = $<HTMLLabelElement>('so-drop');
const input = $<HTMLTextAreaElement>('so-input');
const example = $<HTMLButtonElement>('so-example');
const error = $<HTMLParagraphElement>('so-error');
const result = $<HTMLDivElement>('so-result');
const precision = $<HTMLSelectElement>('so-precision');
const responsive = $<HTMLInputElement>('so-responsive');
const current = $<HTMLInputElement>('so-current');
const stats = $<HTMLParagraphElement>('so-stats');
const before = $<HTMLImageElement>('so-before');
const after = $<HTMLImageElement>('so-after');
const beforeSize = $<HTMLSpanElement>('so-before-size');
const afterSize = $<HTMLSpanElement>('so-after-size');
const code = $<HTMLPreElement>('so-code');
const codeLabel = $<HTMLSpanElement>('so-code-label');
const copyBtn = $<HTMLButtonElement>('so-copy');
const dlBtn = $<HTMLButtonElement>('so-download');
const promptBtn = $<HTMLButtonElement>('so-prompt');
const status = $<HTMLParagraphElement>('so-status');
const clearBtn = $<HTMLButtonElement>('so-clear');
const tabs = [...document.querySelectorAll<HTMLInputElement>('input[name="so-tab"]')];

const MAX_BYTES = 5 * 1024 * 1024;
const EXAMPLE = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Generator: Adobe Illustrator 27.0.0, SVG Export Plug-In . SVG Version: 6.00 Build 0)  -->
<svg
   xmlns:dc="http://purl.org/dc/elements/1.1/"
   xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
   xmlns:svg="http://www.w3.org/2000/svg"
   xmlns="http://www.w3.org/2000/svg"
   xmlns:xlink="http://www.w3.org/1999/xlink"
   xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
   xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
   version="1.1"
   id="Layer_1"
   x="0px"
   y="0px"
   width="48px"
   height="48px"
   viewBox="0 0 48 48"
   enable-background="new 0 0 48 48"
   xml:space="preserve"
   sodipodi:docname="heart.svg"
   inkscape:version="1.3 (0e150ed6c4, 2023-07-21)">
  <metadata id="metadata8">
    <rdf:RDF>
      <cc:Work xmlns:cc="http://creativecommons.org/ns#" rdf:about="">
        <dc:format>image/svg+xml</dc:format>
        <dc:type rdf:resource="http://purl.org/dc/dcmitype/StillImage" />
      </cc:Work>
    </rdf:RDF>
  </metadata>
  <sodipodi:namedview pagecolor="#ffffff" bordercolor="#666666" borderopacity="1" inkscape:zoom="12.5" inkscape:cx="24" inkscape:cy="24" id="namedview6" />
  <defs id="defs2"></defs>
  <g id="Group_1" data-name="Group 1">
    <g>
      <path
         id="path4"
         style="fill:#FF3366;fill-opacity:1;stroke:none;stroke-width:1.00000000"
         d="M 24.000000,42.700000 L 21.100000,40.050000 C 10.800000,30.700000 4.000000,24.550000 4.000000,17.000000 C 4.000000,10.850000 8.850000,6.000000 15.000000,6.000000 C 18.480000,6.000000 21.820000,7.620000 24.000000,10.180000 C 26.180000,7.620000 29.520000,6.000000 33.000000,6.000000 C 39.150000,6.000000 44.000000,10.850000 44.000000,17.000000 C 44.000000,24.550000 37.200000,30.700000 26.900000,40.070000 L 24.000000,42.700000 Z" />
      <circle id="circle6" cx="33.000000" cy="15.000000" r="3.000000" fill="#FFFFFF" fill-opacity="0.6" />
    </g>
  </g>
</svg>
`;

let source = '';
let fileName = 'icon.svg';
let out = '';
let urls: string[] = [];

function bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

function size(n: number): string {
  if (n < 1024) return `${n} B`;
  return n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function showError(msg: string) {
  error.textContent = msg;
  error.hidden = false;
  result.hidden = true;
}

function say(msg: string) {
  status.textContent = msg;
}

const tab = () => tabs.find((t) => t.checked)?.value ?? 'svg';
const name = () => componentName(fileName);

function output(): { text: string; label: string; file: string; type: string } {
  switch (tab()) {
    case 'jsx':
      return { text: jsx(out, name(), false), label: `${name()}.jsx`, file: `${name()}.jsx`, type: 'text/javascript' };
    case 'tsx':
      return { text: jsx(out, name(), true), label: `${name()}.tsx`, file: `${name()}.tsx`, type: 'text/plain' };
    case 'uri':
      return { text: dataUri(out), label: 'Data URI (for src="…" or url(…))', file: '', type: '' };
    case 'css':
      return { text: cssBackground(out), label: 'CSS background', file: '', type: '' };
    default:
      return { text: out, label: fileName.replace(/\.svg$/i, '') + '.min.svg', file: fileName.replace(/\.svg$/i, '') + '.min.svg', type: 'image/svg+xml' };
  }
}

function setPreview(img: HTMLImageElement, svg: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  urls.push(url);
  img.src = url;
}

function renderCode() {
  const o = output();
  code.textContent = o.text;
  codeLabel.textContent = o.label;
  dlBtn.hidden = !o.file;
}

function run() {
  error.hidden = true;
  if (!source.trim()) {
    result.hidden = true;
    return;
  }
  try {
    out = optimize(source, {
      precision: Number(precision.value),
      responsive: responsive.checked,
      currentColor: current.checked,
    }).svg;
  } catch (e) {
    showError(e instanceof Error ? e.message : 'Couldn’t read that SVG.');
    return;
  }
  for (const u of urls) URL.revokeObjectURL(u);
  urls = [];
  const a = bytes(source);
  const b = bytes(out);
  const pct = Math.round((1 - b / a) * 100);
  beforeSize.textContent = size(a);
  afterSize.textContent = size(b);
  stats.innerHTML = '';
  const strong = document.createElement('strong');
  strong.textContent = pct > 0 ? `${pct}% smaller` : 'Already lean';
  stats.append(strong, ` · ${size(a)} → ${size(b)}`);
  setPreview(before, source);
  setPreview(after, out);
  renderCode();
  result.hidden = false;
  say('');
}

function load(text: string, name?: string) {
  if (bytes(text) > MAX_BYTES) {
    showError('That SVG is over 5 MB. Try a smaller file.');
    return;
  }
  source = text;
  if (name) fileName = name;
  if (input.value !== text) input.value = text;
  run();
}

async function loadFile(file: File | undefined) {
  if (!file) return;
  if (!/svg/i.test(file.type) && !/\.svg$/i.test(file.name)) {
    showError('That isn’t an SVG file. Drop a file that ends in .svg.');
    return;
  }
  if (file.size > MAX_BYTES) {
    showError('That SVG is over 5 MB. Try a smaller file.');
    return;
  }
  load(await file.text(), file.name);
}

async function copy(text: string, ok: string) {
  try {
    await navigator.clipboard.writeText(text);
    say(ok);
  } catch {
    say('Your browser blocked copying. Select the text and copy it instead.');
  }
}

function agentPrompt(): string {
  const n = name();
  const color = current.checked
    ? 'It uses currentColor, so it takes the color of the text around it.'
    : 'Keep its colors as they are.';
  return `Add this SVG to my project as a reusable icon component named ${n}.
- If the project uses React (or Next.js), make it a component that accepts and spreads SVG props, so I can pass className, width and height. Use the same folder and style as my other components or icons.
- Otherwise, add it the way this project already handles icons (an inline SVG or a file in the public/assets folder).
- Keep the viewBox. Size it with CSS or props, not by editing the paths. ${color}
- Don't change the path data. It is already optimized.
- Show me where you put it and one example of using it.

\`\`\`svg
${out}
\`\`\``;
}

fileInput.addEventListener('change', () => loadFile(fileInput.files?.[0]));
for (const ev of ['dragenter', 'dragover'] as const)
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
for (const ev of ['dragleave', 'drop'] as const) drop.addEventListener(ev, () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f) loadFile(f);
  else {
    const t = e.dataTransfer?.getData('text/plain');
    if (t) load(t, 'icon.svg');
  }
});

let typing = 0;
input.addEventListener('input', () => {
  clearTimeout(typing);
  typing = window.setTimeout(() => load(input.value, fileName === 'icon.svg' ? 'icon.svg' : fileName), 250);
});

// Paste anywhere on the page (outside the text box) also works, for SVG code or a copied .svg file.
document.addEventListener('paste', (e) => {
  const t = e.target as HTMLElement | null;
  if (t && (t === input || t.closest('input, textarea'))) return;
  const f = [...(e.clipboardData?.files ?? [])].find((x) => /svg/i.test(x.type) || /\.svg$/i.test(x.name));
  if (f) {
    e.preventDefault();
    loadFile(f);
    return;
  }
  const text = e.clipboardData?.getData('text/plain') ?? '';
  if (/<svg[\s>]/i.test(text)) {
    e.preventDefault();
    load(text, 'icon.svg');
  }
});

example.addEventListener('click', () => load(EXAMPLE, 'heart.svg'));
for (const el of [precision, responsive, current]) el.addEventListener('change', run);
for (const t of tabs) t.addEventListener('change', renderCode);

copyBtn.addEventListener('click', () => copy(code.textContent ?? '', 'Copied'));
promptBtn.addEventListener('click', () => copy(agentPrompt(), 'Copied. Paste it into Claude Code, Cursor or Codex.'));
dlBtn.addEventListener('click', () => {
  const o = output();
  const a = document.createElement('a');
  const url = URL.createObjectURL(new Blob([o.text], { type: o.type }));
  a.href = url;
  a.download = o.file;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
clearBtn.addEventListener('click', () => {
  source = '';
  out = '';
  fileName = 'icon.svg';
  input.value = '';
  fileInput.value = '';
  result.hidden = true;
  error.hidden = true;
  input.focus();
});
