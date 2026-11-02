// Base64 encoder and decoder: everything runs in the visitor's browser. Nothing is uploaded.
import {
  bytesToBase64,
  bytesToText,
  formatBytes,
  looksLikeBase64,
  parseBase64,
  sniffType,
  snippets,
  textToBase64,
} from './base64-encoder-core';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const WARN_AT = 10 * 1024;

// ---------- Tabs ----------
const tabs = [$<HTMLButtonElement>('b64-tab-text'), $<HTMLButtonElement>('b64-tab-file')];
function selectTab(i: number, focus = false) {
  tabs.forEach((t, j) => {
    const on = i === j;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute('aria-controls')!).hidden = !on;
    if (on && focus) t.focus();
  });
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => selectTab(i));
  t.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') selectTab((i + 1) % 2, true);
  });
});
if (location.hash === '#file' || location.hash === '#image') selectTab(1);

// ---------- Copy helper ----------
async function copy(text: string, btn: HTMLButtonElement, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied ✓';
  } catch {
    btn.textContent = 'Couldn’t copy';
  }
  setTimeout(() => (btn.textContent = label), 1500);
}

// ---------- Text tab ----------
const input = $<HTMLTextAreaElement>('b64-in');
const inLabel = $<HTMLElement>('b64-in-label');
const outLabel = $<HTMLElement>('b64-out-label');
const out = $<HTMLDivElement>('b64-out');
const stage = $<HTMLDivElement>('b64-stage');
const errorBox = $<HTMLDivElement>('b64-error');
const sizes = $<HTMLElement>('b64-sizes');
const urlSafe = $<HTMLInputElement>('b64-urlsafe');
const urlSafeRow = $<HTMLElement>('b64-urlsafe-row');
const suggest = $<HTMLDivElement>('b64-suggest');
const detailsBody = $<HTMLElement>('b64-details');
const copyBtn = $<HTMLButtonElement>('b64-copy');
const fileOut = $<HTMLDivElement>('b64-file-out');
const fileImg = $<HTMLImageElement>('b64-file-img');
const fileIcon = $<HTMLElement>('b64-file-icon');
const fileName = $<HTMLElement>('b64-file-name');
const fileSize = $<HTMLElement>('b64-file-size');
const download = $<HTMLAnchorElement>('b64-download');
const modeBtns = [...document.querySelectorAll<HTMLButtonElement>('.seg [data-mode]')];

let mode: 'encode' | 'decode' = 'encode';
let result = '';
let blobUrl = '';

function setMode(m: typeof mode) {
  mode = m;
  modeBtns.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === m)));
  inLabel.textContent = m === 'encode' ? 'Your text' : 'Base64 or data URI';
  outLabel.textContent = m === 'encode' ? 'Base64' : 'Decoded';
  input.placeholder = m === 'encode' ? 'Type or paste any text…' : 'SGVsbG8sIHdvcmxkIQ==';
  urlSafeRow.classList.toggle('off', m === 'decode');
  urlSafe.disabled = m === 'decode';
  urlSafeRow.title = m === 'decode' ? 'Both kinds are read automatically when decoding.' : '';
  renderText();
}

function rows(list: [string, string][]) {
  detailsBody.replaceChildren(
    ...list.map(([k, v]) => {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      const td = document.createElement('td');
      th.textContent = k;
      td.textContent = v;
      tr.append(th, td);
      return tr;
    }),
  );
}

function hex(bytes: Uint8Array, max = 48) {
  const s = Array.from(bytes.subarray(0, max), (b) => b.toString(16).padStart(2, '0')).join(' ');
  return bytes.length > max ? `${s} …` : s;
}

function showError(html: string) {
  errorBox.innerHTML = html;
  errorBox.hidden = false;
  stage.dataset.tone = 'bad';
  out.hidden = true;
  fileOut.hidden = true;
  copyBtn.hidden = true;
  sizes.textContent = '';
  result = '';
}

function decodeErrorMessage(e: unknown, raw: string): string {
  const msg = e instanceof Error ? e.message : '';
  if (msg.startsWith('char:')) {
    const ch = msg.slice(5);
    const shown = ch === '"' || ch === "'" ? `a quote mark (${ch})` : `<code>${escapeHtml(ch)}</code>`;
    return `This isn’t valid Base64: it contains ${shown}, which Base64 never uses. Check you copied only the Base64 part, without quotes or text around it.`;
  }
  if (msg === 'padding') return 'This isn’t valid Base64: an <code>=</code> sign can only appear at the very end.';
  if (msg === 'mixed') return 'This mixes normal Base64 (<code>+</code> <code>/</code>) with URL-safe Base64 (<code>-</code> <code>_</code>). It was probably joined from two different places.';
  if (msg === 'length') return `This looks cut off: Base64 comes in groups of 4 characters and the last group has only 1. Check you copied all of it (${raw.replace(/\s+/g, '').length} characters).`;
  return 'This isn’t valid Base64.';
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function resetOut() {
  errorBox.hidden = true;
  out.hidden = false;
  fileOut.hidden = true;
  copyBtn.hidden = false;
  copyBtn.textContent = 'Copy';
  stage.dataset.tone = 'ok';
  out.classList.toggle('text', mode === 'decode');
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = '';
}

function renderText() {
  resetOut();
  const raw = input.value;
  suggest.hidden = !(mode === 'encode' && looksLikeBase64(raw));
  if (!raw) {
    out.textContent = '';
    result = '';
    sizes.textContent = '';
    rows([]);
    return;
  }
  if (mode === 'encode') {
    const bytes = new TextEncoder().encode(raw);
    result = textToBase64(raw, urlSafe.checked);
    out.textContent = result;
    sizes.textContent = `${raw.length.toLocaleString()} characters → ${result.length.toLocaleString()} Base64 characters`;
    rows([
      ['Kind', urlSafe.checked ? 'URL-safe Base64 (base64url), no padding' : 'Standard Base64 (RFC 4648)'],
      ['Text as UTF-8 bytes', `${bytes.length.toLocaleString()} bytes`],
      ['Base64 length', `${result.length.toLocaleString()} characters`],
      ['Bigger by', bytes.length ? `${Math.round((result.length / bytes.length - 1) * 100)}%` : '0%'],
      ['Padding', urlSafe.checked ? 'none' : `${(result.match(/=+$/) || [''])[0].length} “=” sign(s)`],
      ['First bytes (hex)', hex(bytes)],
      ['Data URI', `data:text/plain;charset=utf-8;base64,${textToBase64(raw)}`.slice(0, 200)],
    ]);
    return;
  }
  // Decode
  let parsed;
  try {
    parsed = parseBase64(raw);
  } catch (e) {
    rows([]);
    showError(decodeErrorMessage(e, raw));
    return;
  }
  const { bytes } = parsed;
  const text = bytesToText(bytes);
  const sniff = sniffType(bytes);
  const isFile = sniff !== null || text === null || (parsed.mime !== undefined && !/^text\/|json|xml|javascript/.test(parsed.mime));
  rows([
    ['Kind', parsed.mime ? `Data URI (${parsed.mime})` : parsed.urlSafe ? 'URL-safe Base64 (base64url)' : 'Standard Base64'],
    ['Decoded size', `${bytes.length.toLocaleString()} bytes`],
    ['Looks like', sniff ? sniff.name : text !== null ? 'Text (UTF-8)' : 'Binary data'],
    ['First bytes (hex)', hex(bytes)],
  ]);
  if (!isFile && text !== null) {
    result = text;
    out.textContent = text;
    sizes.textContent = `${bytes.length.toLocaleString()} bytes of text`;
    return;
  }
  // A file: show it instead of gibberish.
  const mime = sniff?.mime || parsed.mime || 'application/octet-stream';
  const name = sniff?.name || (parsed.mime ? parsed.mime : 'Binary file');
  out.hidden = true;
  fileOut.hidden = false;
  copyBtn.hidden = true;
  const blob = new Blob([bytes as BlobPart], { type: mime });
  blobUrl = URL.createObjectURL(blob);
  const isImage = mime.startsWith('image/');
  fileImg.hidden = !isImage;
  if (isImage) fileImg.src = blobUrl;
  fileIcon.textContent = isImage ? '🖼️' : mime === 'application/pdf' ? '📕' : mime.startsWith('font/') ? '🔤' : '📄';
  fileName.textContent = `This is a ${name}`;
  fileSize.textContent = formatBytes(bytes.length);
  download.href = blobUrl;
  download.download = `decoded.${extFor(mime)}`;
  sizes.textContent = isImage ? 'The picture is shown above. Download it to save the file.' : 'This isn’t text, so it’s shown as a file you can download.';
}

function extFor(mime: string) {
  const map: Record<string, string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif',
    'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'application/pdf': 'pdf', 'application/zip': 'zip',
    'font/woff2': 'woff2', 'font/woff': 'woff', 'application/gzip': 'gz', 'video/mp4': 'mp4', 'audio/mpeg': 'mp3',
    'text/plain': 'txt', 'application/json': 'json',
  };
  return map[mime] || 'bin';
}

modeBtns.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode as typeof mode)));
input.addEventListener('input', renderText);
urlSafe.addEventListener('change', renderText);
$('b64-suggest-btn').addEventListener('click', () => setMode('decode'));
$('b64-swap').addEventListener('click', () => {
  if (!result) return;
  const next = result;
  input.value = next;
  setMode(mode === 'encode' ? 'decode' : 'encode');
  input.focus();
});
copyBtn.addEventListener('click', () => result && copy(result, copyBtn, 'Copy'));
$('b64-clear').addEventListener('click', () => {
  input.value = '';
  renderText();
  input.focus();
});
$('b64-paste').addEventListener('click', async () => {
  try {
    input.value = await navigator.clipboard.readText();
    renderText();
  } catch {
    input.focus();
  }
});

input.value = 'Hello from Darnly 👋';
setMode('encode');

// ---------- File tab ----------
const drop = $<HTMLLabelElement>('b64-drop');
const fileInput = $<HTMLInputElement>('b64-file');
const fstage = $<HTMLDivElement>('b64-fstage');
const fimg = $<HTMLImageElement>('b64-fimg');
const ficon = $<HTMLElement>('b64-ficon');
const fname = $<HTMLElement>('b64-fname');
const fsize = $<HTMLElement>('b64-fsize');
const fsize64 = $<HTMLElement>('b64-fsize64');
const mOrig = $<HTMLElement>('b64-m-orig');
const mB64 = $<HTMLElement>('b64-m-b64');
const fsizesText = $<HTMLElement>('b64-fsizes-text');
const fwarn = $<HTMLDivElement>('b64-fwarn');
const fcode = $<HTMLElement>('b64-fcode');
const fcopy = $<HTMLButtonElement>('b64-fcopy');
const fstatus = $<HTMLElement>('b64-fstatus');
const fmtBtns = [...document.querySelectorAll<HTMLButtonElement>('.formats [data-fmt]')];
const uriInput = $<HTMLTextAreaElement>('b64-uri');
const uriError = $<HTMLDivElement>('b64-uri-error');

type Fmt = 'uri' | 'img' | 'css' | 'json' | 'raw';
const fmtLabels: Record<Fmt, string> = { uri: 'Copy data URI', img: 'Copy <img> tag', css: 'Copy CSS', json: 'Copy JSON', raw: 'Copy Base64' };
let fmt: Fmt = 'uri';
let snip: ReturnType<typeof snippets> | null = null;
const PREVIEW_MAX = 4000;

function showSnippet() {
  if (!snip) return;
  const s = snip[fmt];
  fcode.textContent = s.length > PREVIEW_MAX ? `${s.slice(0, PREVIEW_MAX)}… (${(s.length - PREVIEW_MAX).toLocaleString()} more characters, all copied)` : s;
  fcopy.textContent = fmtLabels[fmt];
}

async function useFile(file: Blob, name: string) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniff = sniffType(bytes);
  const mime = file.type || sniff?.mime || 'application/octet-stream';
  const b64 = bytesToBase64(bytes);
  const uri = `data:${mime};base64,${b64}`;
  snip = snippets(uri, name);
  const isImage = mime.startsWith('image/');
  fimg.hidden = !isImage;
  ficon.hidden = isImage;
  if (isImage) fimg.src = uri;
  ficon.textContent = mime === 'application/pdf' ? '📕' : mime.startsWith('font/') ? '🔤' : '📄';
  fname.textContent = name;
  fsize.textContent = formatBytes(bytes.length);
  fsize64.textContent = formatBytes(uri.length);
  const max = Math.max(uri.length, 1);
  mOrig.style.width = `${(bytes.length / max) * 100}%`;
  mB64.style.width = '100%';
  const pct = bytes.length ? Math.round((uri.length / bytes.length - 1) * 100) : 0;
  fsizesText.textContent = `As text it’s ${pct}% bigger: ${uri.length.toLocaleString()} characters.`;
  const big = uri.length > WARN_AT;
  fwarn.hidden = !big;
  fwarn.innerHTML = big
    ? `This is over 10 KB, so it’s better as a file. Save it in your project (for example <code>public/${escapeHtml(name)}</code>) and link to it. Your page will load faster and browsers can cache it.`
    : '';
  fstage.dataset.tone = big ? 'warn' : 'ok';
  fstatus.textContent = '';
  drop.hidden = true;
  fstage.hidden = false;
  showSnippet();
}

fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f) useFile(f, f.name);
  fileInput.value = '';
});
['dragenter', 'dragover'].forEach((ev) =>
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add('over');
  }),
);
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = (e as DragEvent).dataTransfer?.files?.[0];
  if (f) useFile(f, f.name);
});
// Dropping anywhere on the file tab works too.
const filePanel = $('b64-panel-file');
filePanel.addEventListener('dragover', (e) => e.preventDefault());
filePanel.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = (e as DragEvent).dataTransfer?.files?.[0];
  if (f) useFile(f, f.name);
});
document.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.kind === 'file');
  if (!item) return;
  const f = item.getAsFile();
  if (!f) return;
  e.preventDefault();
  selectTab(1);
  useFile(f, f.name && f.name !== 'image.png' ? f.name : `pasted.${extFor(f.type)}`);
});
$('b64-another').addEventListener('click', () => fileInput.click());
fmtBtns.forEach((b) =>
  b.addEventListener('click', () => {
    fmt = b.dataset.fmt as Fmt;
    fmtBtns.forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    showSnippet();
  }),
);
fcopy.addEventListener('click', () => snip && copy(snip[fmt], fcopy, fmtLabels[fmt]));

// Examples are drawn on the spot, so there's nothing to download.
function sample(kind: string) {
  const big = kind === 'photo';
  const c = document.createElement('canvas');
  c.width = big ? 900 : 32;
  c.height = big ? 600 : 32;
  const g = c.getContext('2d')!;
  if (big) {
    const grad = g.createLinearGradient(0, 0, 900, 600);
    grad.addColorStop(0, '#2B7FFF');
    grad.addColorStop(1, '#FF5C8A');
    g.fillStyle = grad;
    g.fillRect(0, 0, 900, 600);
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `hsla(${(i * 37) % 360}, 80%, 70%, 0.35)`;
      g.beginPath();
      g.arc((i * 97) % 900, (i * 53) % 600, 6 + (i % 30), 0, Math.PI * 2);
      g.fill();
    }
  } else {
    g.fillStyle = '#1A9B5A';
    g.beginPath();
    g.arc(16, 16, 15, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#fff';
    g.lineWidth = 4;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(9, 16.5);
    g.lineTo(14, 21.5);
    g.lineTo(23, 11);
    g.stroke();
  }
  c.toBlob((b) => b && useFile(b, big ? 'hero.jpg' : 'check-icon.png'), big ? 'image/jpeg' : 'image/png', 0.92);
}
document.querySelectorAll<HTMLButtonElement>('[data-sample]').forEach((b) =>
  b.addEventListener('click', (e) => {
    e.preventDefault(); // the chip sits inside the drop label
    e.stopPropagation();
    sample(b.dataset.sample!);
  }),
);

// Paste a data URI to see the file again.
uriInput.addEventListener('input', () => {
  const raw = uriInput.value.trim();
  uriError.hidden = true;
  if (!raw) return;
  try {
    const p = parseBase64(raw);
    const sniff = sniffType(p.bytes);
    const mime = p.mime || sniff?.mime || 'application/octet-stream';
    const ext = extFor(mime);
    useFile(new Blob([p.bytes as BlobPart], { type: mime }), `decoded.${ext}`);
  } catch (e) {
    uriError.innerHTML = decodeErrorMessage(e, raw);
    uriError.hidden = false;
  }
});
