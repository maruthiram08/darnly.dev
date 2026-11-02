// QR code generator: everything runs in the visitor's browser. Nothing is uploaded.
import qrcode from 'qrcode-generator';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const textIn = $<HTMLTextAreaElement>('qr-text');
const errorEl = $<HTMLParagraphElement>('qr-error');
const preview = $<HTMLDivElement>('qr-preview');
const fgText = $<HTMLInputElement>('qr-fg-text');
const fgSwatch = $<HTMLInputElement>('qr-fg-swatch');
const bgText = $<HTMLInputElement>('qr-bg-text');
const bgSwatch = $<HTMLInputElement>('qr-bg-swatch');
const logoIn = $<HTMLInputElement>('qr-logo');
const logoRemove = $<HTMLButtonElement>('qr-logo-remove');
const verdict = $<HTMLDivElement>('qr-verdict');
const verdictTitle = $<HTMLElement>('qr-verdict-title');
const verdictText = $<HTMLElement>('qr-verdict-text');
const swapBtn = $<HTMLButtonElement>('qr-swap');
const pngBtn = $<HTMLButtonElement>('qr-png');
const svgBtn = $<HTMLButtonElement>('qr-svg');
const copyBtn = $<HTMLButtonElement>('qr-copy');
const status = $<HTMLParagraphElement>('qr-status');
const eclEl = $<HTMLElement>('qr-ecl');
const sizeEl = $<HTMLElement>('qr-size');
const ratioEl = $<HTMLElement>('qr-ratio');

// Every QR byte is UTF-8, so emoji and non-Latin text scan correctly on phones.
qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

const MARGIN = 4; // the quiet zone scanners need, in modules
const PNG_TARGET = 1024;

type Logo = { url: string; img: HTMLImageElement };
type Code = { n: number; total: number; path: string; logoBox: { x: number; size: number } | null; fg: string; bg: string };

let logo: Logo | null = null;
let fg = '#0B2230';
let bg = '#FFFFFF';
let current: Code | null = null;

// ---------- Colors ----------

const probe = document.createElement('canvas').getContext('2d')!;

// Any color the browser understands, returned as #RRGGBB, or null.
function readColor(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const hex = s.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return '#' + h.toUpperCase();
  }
  probe.fillStyle = '#010203';
  probe.fillStyle = s;
  const out = String(probe.fillStyle);
  if (out === '#010203') return null;
  if (out.startsWith('#')) return out.toUpperCase();
  return null; // see-through colors don't scan reliably, so we don't accept them
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const l = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
}

const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// ---------- Drawing ----------

const style = () => (document.querySelector<HTMLInputElement>('input[name="qr-style"]:checked')?.value ?? 'square');

function isFinder(r: number, c: number, n: number) {
  return (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
}

function roundRect(x: number, y: number, w: number, h: number, rad: number) {
  return `M${x + rad} ${y}h${w - 2 * rad}a${rad} ${rad} 0 0 1 ${rad} ${rad}v${h - 2 * rad}a${rad} ${rad} 0 0 1 ${-rad} ${rad}h${-(w - 2 * rad)}a${rad} ${rad} 0 0 1 ${-rad} ${-rad}v${-(h - 2 * rad)}a${rad} ${rad} 0 0 1 ${rad} ${-rad}z`;
}

// One SVG path (drawn with the even-odd rule) is used for the preview, the SVG file and the PNG.
function build(text: string): Code {
  const qr = qrcode(0, logo ? 'H' : 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const total = n + MARGIN * 2;
  const rounded = style() === 'rounded';

  // The logo covers about a fifth of the width, centered on whole modules. Level H rebuilds what it hides.
  let logoBox: Code['logoBox'] = null;
  let lo = -1;
  let hi = -1;
  if (logo) {
    let size = Math.floor(n * 0.22);
    if (size % 2 !== n % 2) size -= 1;
    lo = (n - size) / 2;
    hi = lo + size;
    logoBox = { x: lo + MARGIN, size };
  }

  const parts: string[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      if (logoBox && r >= lo && r < hi && c >= lo && c < hi) continue;
      if (rounded && isFinder(r, c, n)) continue;
      const x = c + MARGIN;
      const y = r + MARGIN;
      if (rounded) parts.push(`M${x + 0.05} ${y + 0.5}a0.45 0.45 0 1 0 0.9 0a0.45 0.45 0 1 0 -0.9 0z`);
      else parts.push(`M${x} ${y}h1v1h-1z`);
    }
  }
  if (rounded) {
    // Finder eyes stay solid shapes so phones lock on fast.
    for (const [r, c] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      const x = c + MARGIN;
      const y = r + MARGIN;
      parts.push(roundRect(x, y, 7, 7, 2), roundRect(x + 1, y + 1, 5, 5, 1.4), roundRect(x + 2, y + 2, 3, 3, 1));
    }
  }
  return { n, total, path: parts.join(''), logoBox, fg, bg };
}

function svgString(code: Code): string {
  const { total, path, logoBox } = code;
  let logoSvg = '';
  if (logoBox && logo) {
    const pad = 0.5;
    logoSvg =
      `<rect x="${logoBox.x}" y="${logoBox.x}" width="${logoBox.size}" height="${logoBox.size}" rx="1" fill="${code.bg}"/>` +
      `<image href="${logo.url}" x="${logoBox.x + pad}" y="${logoBox.x + pad}" width="${logoBox.size - pad * 2}" height="${logoBox.size - pad * 2}" preserveAspectRatio="xMidYMid meet"/>`;
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="${style() === 'rounded' ? 'geometricPrecision' : 'crispEdges'}">` +
    `<rect width="${total}" height="${total}" fill="${code.bg}"/>` +
    `<path d="${path}" fill="${code.fg}" fill-rule="evenodd"/>` +
    logoSvg +
    `</svg>`
  );
}

function canvasFor(code: Code): HTMLCanvasElement {
  const px = Math.ceil(PNG_TARGET / code.total); // whole pixels per module keep square edges sharp
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px * code.total;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(px, px);
  ctx.fillStyle = code.bg;
  ctx.fillRect(0, 0, code.total, code.total);
  ctx.fillStyle = code.fg;
  ctx.fill(new Path2D(code.path), 'evenodd');
  if (code.logoBox && logo) {
    const { x, size } = code.logoBox;
    ctx.fillStyle = code.bg;
    ctx.beginPath();
    ctx.roundRect(x, x, size, size, 1);
    ctx.fill();
    const box = size - 1;
    const w = logo.img.naturalWidth || 1;
    const h = logo.img.naturalHeight || 1;
    const k = Math.min(box / w, box / h);
    ctx.drawImage(logo.img, x + 0.5 + (box - w * k) / 2, x + 0.5 + (box - h * k) / 2, w * k, h * k);
  }
  return canvas;
}

// ---------- Verdict ----------

function setVerdict(state: 'ok' | 'warn' | 'bad', title: string, text: string) {
  verdict.dataset.state = state;
  verdictTitle.textContent = title;
  verdictText.textContent = text;
}

function judge(code: Code) {
  const ratio = contrast(code.fg, code.bg);
  const reversed = luminance(code.fg) > luminance(code.bg);
  ratioEl.textContent = `${ratio.toFixed(1)}:1`;
  swapBtn.hidden = !reversed;
  if (ratio < 2.5) {
    setVerdict('bad', 'Hard to scan', 'The dots and the background are too close in color. Make the dots darker or the background lighter.');
  } else if (reversed) {
    setVerdict('warn', 'May not scan everywhere', 'Light dots on a dark background fail in some scanner apps. Dark dots on a light background are safest.');
  } else if (ratio < 4) {
    setVerdict('warn', 'May be slow to scan', 'The contrast is a bit low, so older phones or dim rooms may struggle. Darker dots will help.');
  } else if (code.n > 57) {
    setVerdict('warn', 'Very dense code', 'That’s a lot of text, so the dots are tiny. Print it big, or use a shorter link.');
  } else if (code.logoBox) {
    setVerdict('ok', 'Easy to scan', 'Strong contrast. Your logo hides part of the code, and the highest error correction fills it back in.');
  } else {
    setVerdict('ok', 'Easy to scan', 'Dark dots on a light background with strong contrast.');
  }
}

// ---------- Update ----------

function setError(msg: string) {
  errorEl.textContent = msg;
  errorEl.hidden = !msg;
}

function render() {
  const text = textIn.value;
  if (!text.trim()) {
    setError('Type a link or some text to make a QR code.');
    return;
  }
  try {
    current = build(text);
  } catch {
    setError('That’s too much text for one QR code. Shorten it, or put the text on a page and make a code for that link.');
    return;
  }
  setError('');
  preview.innerHTML = svgString(current);
  eclEl.textContent = logo ? 'H (30%, raised for your logo)' : 'M (15%)';
  sizeEl.textContent = `${current.n} × ${current.n}`;
  judge(current);
}

function syncColor(which: 'fg' | 'bg', value: string, fromSwatch: boolean) {
  const color = readColor(value);
  const textEl = which === 'fg' ? fgText : bgText;
  const swatch = which === 'fg' ? fgSwatch : bgSwatch;
  textEl.setAttribute('aria-invalid', color ? 'false' : 'true');
  if (!color) return;
  if (which === 'fg') fg = color;
  else bg = color;
  swatch.value = color.toLowerCase();
  if (fromSwatch) textEl.value = color;
  render();
}

function say(msg: string) {
  status.textContent = msg;
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

const pngBlob = (code: Code) =>
  new Promise<Blob>((resolve, reject) => canvasFor(code).toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'));

textIn.addEventListener('input', render);
fgText.addEventListener('input', () => syncColor('fg', fgText.value, false));
bgText.addEventListener('input', () => syncColor('bg', bgText.value, false));
fgSwatch.addEventListener('input', () => syncColor('fg', fgSwatch.value, true));
bgSwatch.addEventListener('input', () => syncColor('bg', bgSwatch.value, true));
document.querySelectorAll('input[name="qr-style"]').forEach((el) => el.addEventListener('change', render));

logoIn.addEventListener('change', () => {
  const file = logoIn.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    say('That logo is over 5 MB. Try a smaller file.');
    logoIn.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const url = String(reader.result);
    const img = new Image();
    img.onload = () => {
      logo = { url, img };
      logoRemove.hidden = false;
      say('Logo added. Error correction is now H so it still scans.');
      render();
    };
    img.onerror = () => say('We couldn’t read that image. Try a PNG or JPG.');
    img.src = url;
  };
  reader.readAsDataURL(file);
});

logoRemove.addEventListener('click', () => {
  logo = null;
  logoIn.value = '';
  logoRemove.hidden = true;
  say('Logo removed.');
  render();
});

swapBtn.addEventListener('click', () => {
  [fg, bg] = [bg, fg];
  fgText.value = fg;
  bgText.value = bg;
  fgSwatch.value = fg.toLowerCase();
  bgSwatch.value = bg.toLowerCase();
  render();
  say('Colors swapped.');
});

pngBtn.addEventListener('click', async () => {
  if (!current) return;
  try {
    download(await pngBlob(current), 'qr-code.png');
    say('PNG downloaded.');
  } catch {
    say('Something went wrong making the PNG. Try the SVG instead.');
  }
});

svgBtn.addEventListener('click', () => {
  if (!current) return;
  download(new Blob([svgString(current)], { type: 'image/svg+xml' }), 'qr-code.svg');
  say('SVG downloaded.');
});

copyBtn.addEventListener('click', async () => {
  if (!current) return;
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob(current) })]);
    say('Copied. Paste it into your doc, slide or chat.');
  } catch {
    say('Your browser blocked copying images. Use Download PNG instead.');
  }
});

render();
