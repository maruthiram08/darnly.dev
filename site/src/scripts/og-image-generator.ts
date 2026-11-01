// Share image maker: draws a 1200×630 picture on a canvas in the visitor's browser. Nothing is uploaded.

const W = 1200;
const H = 630;
const PAD = 80;

type Layout = 'left' | 'center' | 'split';
type Look = { bg: string; bg2: string; text: string; accent: string };

// Ready-made color sets. Picking one fills in the color pickers, which can then be tweaked.
const LOOKS: Record<string, Look> = {
  sky: { bg: '#0593C6', bg2: '#D83995', text: '#FCFFFF', accent: '#FCFFFF' },
  ink: { bg: '#0B2230', bg2: '#123B52', text: '#FCFFFF', accent: '#38C6F4' },
  paper: { bg: '#FCFFFF', bg2: '#EEF8FB', text: '#0B2230', accent: '#0593C6' },
  sunset: { bg: '#FF7A45', bg2: '#D83995', text: '#FFFFFF', accent: '#FFE8A3' },
  forest: { bg: '#0F3D2E', bg2: '#1F6F50', text: '#F3FFF8', accent: '#9BE7B9' },
  mono: { bg: '#111111', bg2: '#111111', text: '#FFFFFF', accent: '#FFFFFF' },
};

// Only weights the site already loads, so the picture matches what the page shows.
const FONTS: Record<string, { title: string; weight: number; body: string }> = {
  bold: { title: '"Bricolage Grotesque", system-ui, sans-serif', weight: 800, body: 'Figtree, system-ui, sans-serif' },
  clean: { title: 'Figtree, system-ui, sans-serif', weight: 600, body: 'Figtree, system-ui, sans-serif' },
  code: { title: '"JetBrains Mono", ui-monospace, monospace', weight: 500, body: '"JetBrains Mono", ui-monospace, monospace' },
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('og-canvas');
const ctx = canvas.getContext('2d')!;
const title = $<HTMLTextAreaElement>('og-title');
const subtitle = $<HTMLTextAreaElement>('og-subtitle');
const site = $<HTMLInputElement>('og-site');
const layout = $<HTMLSelectElement>('og-layout');
const font = $<HTMLSelectElement>('og-font');
const looks = $<HTMLDivElement>('og-looks');
const bg = $<HTMLInputElement>('og-bg');
const bg2 = $<HTMLInputElement>('og-bg2');
const gradient = $<HTMLInputElement>('og-gradient');
const textColor = $<HTMLInputElement>('og-text');
const accent = $<HTMLInputElement>('og-accent');
const logoInput = $<HTMLInputElement>('og-logo');
const logoText = $<HTMLSpanElement>('og-logo-text');
const logoClear = $<HTMLButtonElement>('og-logo-clear');
const error = $<HTMLParagraphElement>('og-error');
const download = $<HTMLButtonElement>('og-download');
const html = $<HTMLElement>('og-html');
const copy = $<HTMLButtonElement>('og-copy');

let logo: HTMLImageElement | null = null;

// Splits text into lines that fit maxWidth. Very long words are cut so nothing runs off the edge.
function wrap(text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\n/)) {
    let line = '';
    for (let word of para.split(/\s+/).filter(Boolean)) {
      while (ctx.measureText(word).width > maxWidth && word.length > 1) {
        let cut = word.length - 1;
        while (cut > 1 && ctx.measureText(word.slice(0, cut)).width > maxWidth) cut--;
        if (line) lines.push(line);
        lines.push(word.slice(0, cut));
        line = '';
        word = word.slice(cut);
      }
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  while (lines.length > 1 && !lines[lines.length - 1]) lines.pop();
  return lines;
}

// Biggest size (from max down to min) at which the text fits in maxLines; past that, extra lines end in "…".
function fit(text: string, family: string, weight: number, max: number, min: number, maxWidth: number, maxLines: number) {
  let size = max;
  let lines: string[] = [];
  for (; size >= min; size -= 2) {
    ctx.font = `${weight} ${size}px ${family}`;
    lines = wrap(text, maxWidth);
    if (lines.length <= maxLines) return { size, lines };
  }
  size = min;
  ctx.font = `${weight} ${size}px ${family}`;
  lines = wrap(text, maxWidth).slice(0, maxLines);
  let last = lines[maxLines - 1];
  while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
  lines[maxLines - 1] = `${last.trimEnd()}…`;
  return { size, lines };
}

function drawLogo(x: number, y: number, box: number, align: 'left' | 'center') {
  if (!logo) return 0;
  const w = logo.naturalWidth || box;
  const h = logo.naturalHeight || box;
  const k = Math.min((box * 2.5) / w, box / h);
  const dw = w * k;
  const dh = h * k;
  ctx.drawImage(logo, align === 'center' ? x - dw / 2 : x, y, dw, dh);
  return dh;
}

function draw() {
  const f = FONTS[font.value] ?? FONTS.bold;
  const mode = layout.value as Layout;
  const titleText = title.value.trim() || 'Your page title';
  const subText = subtitle.value.trim();
  const siteText = site.value.trim();

  // Background.
  if (gradient.checked) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, bg.value);
    g.addColorStop(1, bg2.value);
    ctx.fillStyle = g;
  } else ctx.fillStyle = bg.value;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';

  const center = mode === 'center';
  const textW = mode === 'split' ? W - PAD * 2 - 340 : W - PAD * 2;
  const x = center ? W / 2 : PAD;
  ctx.textAlign = center ? 'center' : 'left';

  // Title and subtitle sizes first, so the whole block can be centered vertically.
  const t = fit(titleText, f.title, f.weight, 96, 44, textW, 3);
  const tLead = t.size * 1.08;
  let s = { size: 0, lines: [] as string[] };
  if (subText) s = fit(subText, f.body, 500, 40, 24, textW, 3);
  const sLead = s.size * 1.35;
  const logoBox = mode === 'split' ? 0 : logo ? 72 : 0;
  const block = (logoBox ? logoBox + 40 : 0) + t.lines.length * tLead + (s.lines.length ? 28 + s.lines.length * sLead : 0);
  let y = Math.max(PAD, (H - block) / 2 - (siteText ? 20 : 0));

  if (logoBox) {
    drawLogo(x, y, logoBox, center ? 'center' : 'left');
    y += logoBox + 40;
  }

  ctx.fillStyle = textColor.value;
  ctx.font = `${f.weight} ${t.size}px ${f.title}`;
  for (const line of t.lines) {
    y += tLead;
    ctx.fillText(line, x, y - tLead * 0.2);
  }

  if (s.lines.length) {
    y += 28;
    ctx.globalAlpha = 0.85;
    ctx.font = `500 ${s.size}px ${f.body}`;
    for (const line of s.lines) {
      y += sLead;
      ctx.fillText(line, x, y - sLead * 0.25);
    }
    ctx.globalAlpha = 1;
  }

  // Site name with a small accent bar, along the bottom.
  if (siteText) {
    ctx.font = `500 28px ${f.body}`;
    const label = siteText.length > 60 ? `${siteText.slice(0, 59)}…` : siteText;
    const tw = ctx.measureText(label).width;
    const bx = center ? W / 2 - (tw + 44) / 2 : PAD;
    ctx.fillStyle = accent.value;
    ctx.fillRect(bx, H - PAD - 22, 28, 6);
    ctx.fillStyle = textColor.value;
    ctx.textAlign = 'left';
    ctx.fillText(label, bx + 44, H - PAD - 10);
  }

  // Split layout: logo (or an accent block) in a panel on the right.
  if (mode === 'split') {
    const size = 260;
    const px = W - PAD - size;
    const py = (H - size) / 2;
    ctx.fillStyle = accent.value;
    ctx.globalAlpha = 0.16;
    ctx.beginPath();
    ctx.roundRect(px, py, size, size, 40);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (logo) {
      const w = logo.naturalWidth || 1;
      const h = logo.naturalHeight || 1;
      const k = Math.min((size - 60) / w, (size - 60) / h);
      ctx.drawImage(logo, px + (size - w * k) / 2, py + (size - h * k) / 2, w * k, h * k);
    } else {
      ctx.fillStyle = accent.value;
      ctx.beginPath();
      ctx.arc(px + size / 2, py + size / 2, 56, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function snippet(): string {
  const t = (title.value.trim() || 'Your page title').replace(/"/g, '&quot;');
  const d = subtitle.value.trim().replace(/"/g, '&quot;');
  return [
    `<meta property="og:title" content="${t}">`,
    d ? `<meta property="og:description" content="${d}">` : '',
    '<meta property="og:image" content="https://YOUR-SITE.com/og-image.png">',
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="twitter:image" content="https://YOUR-SITE.com/og-image.png">',
  ]
    .filter(Boolean)
    .join('\n');
}

function refresh() {
  bg2.disabled = !gradient.checked;
  draw();
  html.textContent = snippet();
}

function pickLook(name: string) {
  const l = LOOKS[name];
  if (!l) return;
  bg.value = l.bg;
  bg2.value = l.bg2;
  textColor.value = l.text;
  accent.value = l.accent;
  gradient.checked = l.bg !== l.bg2;
  for (const b of looks.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.look === name));
  refresh();
}

function loadLogo(file: File) {
  error.hidden = true;
  if (!file.type.startsWith('image/')) {
    error.textContent = 'That file isn’t an image. Try a PNG, JPG, SVG or WebP.';
    error.hidden = false;
    return;
  }
  const img = new Image();
  img.onload = () => {
    logo = img;
    logoText.textContent = file.name;
    logoClear.hidden = false;
    refresh();
  };
  img.onerror = () => {
    error.textContent = 'We couldn’t read that image. Try saving it as a PNG first.';
    error.hidden = false;
  };
  img.src = URL.createObjectURL(file);
}

for (const [name, l] of Object.entries(LOOKS)) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.look = name;
  b.setAttribute('aria-pressed', 'false');
  b.setAttribute('aria-label', `${name[0].toUpperCase()}${name.slice(1)} colors`);
  b.title = name[0].toUpperCase() + name.slice(1);
  b.style.background = `linear-gradient(135deg, ${l.bg}, ${l.bg2})`;
  b.style.color = l.text;
  b.textContent = 'Aa';
  b.addEventListener('click', () => pickLook(name));
  looks.append(b);
}

for (const el of [title, subtitle, site, layout, font, bg, bg2, gradient, textColor, accent]) el.addEventListener('input', refresh);
for (const el of [bg, bg2, textColor, accent])
  el.addEventListener('input', () => looks.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false')));

logoInput.addEventListener('change', () => logoInput.files?.[0] && loadLogo(logoInput.files[0]));
logoClear.addEventListener('click', () => {
  logo = null;
  logoInput.value = '';
  logoText.textContent = 'Add a logo (optional)';
  logoClear.hidden = true;
  refresh();
});
document.addEventListener('paste', (e) => {
  const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
  if (f) loadLogo(f);
});

download.addEventListener('click', () => {
  canvas.toBlob((b) => {
    if (!b) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = 'og-image.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }, 'image/png');
});

copy.addEventListener('click', async () => {
  await navigator.clipboard.writeText(snippet());
  copy.textContent = 'Copied';
  setTimeout(() => (copy.textContent = 'Copy'), 1500);
});

canvas.width = W;
canvas.height = H;
pickLook('sky');

// Web fonts may arrive after the first draw; redraw once they're ready so the picture uses them.
Promise.all(
  ['800 96px "Bricolage Grotesque"', '600 96px Figtree', '500 40px Figtree', '500 40px "JetBrains Mono"'].map((s) =>
    document.fonts.load(s).catch(() => []),
  ),
).then(refresh);
