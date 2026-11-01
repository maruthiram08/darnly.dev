// Color palette from image: everything runs in the visitor's browser. Nothing is uploaded.

type RGB = [number, number, number];
type Swatch = { rgb: RGB; hex: string; share: number };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const fileInput = $<HTMLInputElement>('cp-file');
const drop = $<HTMLLabelElement>('cp-drop');
const dropText = $<HTMLSpanElement>('cp-drop-text');
const error = $<HTMLParagraphElement>('cp-error');
const result = $<HTMLDivElement>('cp-result');
const preview = $<HTMLImageElement>('cp-preview');
const count = $<HTMLSelectElement>('cp-count');
const strip = $<HTMLDivElement>('cp-strip');
const list = $<HTMLUListElement>('cp-swatches');
const status = $<HTMLParagraphElement>('cp-status');
const copyAll = $<HTMLButtonElement>('cp-copy-all');
const css = $<HTMLElement>('cp-css');
const tw = $<HTMLElement>('cp-tw');
const twVersion = $<HTMLSelectElement>('cp-tw-version');

// Each sampled pixel lands in a 16×16×16 bucket; the palette is found from the buckets, which keeps it fast.
type Bucket = { rgb: RGB; weight: number };
let buckets: Bucket[] = [];
let swatches: Swatch[] = [];

const hex = ([r, g, b]: RGB) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

// "Redmean" distance: close to how people see color differences, and cheap.
function dist([r1, g1, b1]: RGB, [r2, g2, b2]: RGB): number {
  const rm = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

function sample(img: HTMLImageElement): Bucket[] {
  const max = 200;
  const w0 = img.naturalWidth || 300;
  const h0 = img.naturalHeight || 300;
  const s = Math.min(1, max / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * s));
  const h = Math.max(1, Math.round(h0 * s));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(img, 0, 0, w, h);
  const data = x.getImageData(0, 0, w, h).data;

  const sums = new Map<number, [number, number, number, number]>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue; // skip see-through pixels, like a logo's empty background
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const cur = sums.get(key);
    if (cur) {
      cur[0] += r;
      cur[1] += g;
      cur[2] += b;
      cur[3]++;
    } else sums.set(key, [r, g, b, 1]);
  }
  return [...sums.values()].map(([r, g, b, n]) => ({ rgb: [r / n, g / n, b / n] as RGB, weight: n }));
}

// Weighted k-means over the buckets. Seeds are picked so that small but distinct colors (an accent) still get a slot.
function palette(items: Bucket[], k: number): Swatch[] {
  const total = items.reduce((t, b) => t + b.weight, 0);
  if (!total) return [];
  const seeds: RGB[] = [];
  let best = items[0];
  for (const b of items) if (b.weight > best.weight) best = b;
  seeds.push([...best.rgb] as RGB);
  const minD = items.map((b) => dist(b.rgb, seeds[0]));
  // Ask for a few more clusters than shown, then merge near-duplicates.
  const want = Math.min(items.length, k + 4);
  while (seeds.length < want) {
    let pick = -1;
    let score = 0;
    items.forEach((b, i) => {
      const sc = Math.sqrt(b.weight) * minD[i] * minD[i];
      if (sc > score) {
        score = sc;
        pick = i;
      }
    });
    if (pick < 0) break;
    const p = [...items[pick].rgb] as RGB;
    seeds.push(p);
    items.forEach((b, i) => (minD[i] = Math.min(minD[i], dist(b.rgb, p))));
  }

  let centers = seeds;
  let weights: number[] = [];
  for (let iter = 0; iter < 12; iter++) {
    const acc = centers.map(() => [0, 0, 0, 0]);
    for (const b of items) {
      let j = 0;
      let d = Infinity;
      centers.forEach((c, ci) => {
        const dd = dist(b.rgb, c);
        if (dd < d) {
          d = dd;
          j = ci;
        }
      });
      const a = acc[j];
      a[0] += b.rgb[0] * b.weight;
      a[1] += b.rgb[1] * b.weight;
      a[2] += b.rgb[2] * b.weight;
      a[3] += b.weight;
    }
    centers = acc.map((a, i) => (a[3] ? ([a[0] / a[3], a[1] / a[3], a[2] / a[3]] as RGB) : centers[i]));
    weights = acc.map((a) => a[3]);
  }

  let groups = centers
    .map((rgb, i) => ({ rgb, weight: weights[i] }))
    .filter((g) => g.weight > 0)
    .sort((a, b) => b.weight - a.weight);

  // Merge colors that look the same, starting with the closest pair, until they're distinct or we're at k.
  const merge = () => {
    let bi = -1;
    let bj = -1;
    let bd = Infinity;
    for (let i = 0; i < groups.length; i++)
      for (let j = i + 1; j < groups.length; j++) {
        const d = dist(groups[i].rgb, groups[j].rgb);
        if (d < bd) {
          bd = d;
          bi = i;
          bj = j;
        }
      }
    return { bi, bj, bd };
  };
  for (;;) {
    if (groups.length <= 1) break;
    const { bi, bj, bd } = merge();
    if (groups.length <= k && bd >= 45) break;
    const a = groups[bi];
    const b = groups[bj];
    const w = a.weight + b.weight;
    // Keep the bigger color's exact shade so the result is a color really in the image.
    groups[bi] = { rgb: a.weight >= b.weight ? a.rgb : b.rgb, weight: w };
    groups.splice(bj, 1);
  }
  // Very small specks (under half a percent) are usually edge noise, not a color you'd use.
  const kept = groups.filter((g) => g.weight / total >= 0.005);
  return (kept.length ? kept : groups)
    .sort((a, b) => b.weight - a.weight)
    .map((g) => {
      const rgb = g.rgb.map((v) => Math.round(v)) as RGB;
      return { rgb, hex: hex(rgb), share: g.weight / total };
    });
}

// Dark text on light colors, white text on dark ones.
function textOn([r, g, b]: RGB): string {
  const l = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b);
  return lum > 0.4 ? '#0B2230' : '#FFFFFF';
}

const name = (i: number) => `color-${i + 1}`;

function cssSnippet(): string {
  return `:root {\n${swatches.map((s, i) => `  --${name(i)}: ${s.hex};`).join('\n')}\n}`;
}

function twSnippet(): string {
  if (twVersion.value === 'v3') {
    const rows = swatches.map((s, i) => `          '${i + 1}': '${s.hex}',`).join('\n');
    return `// tailwind.config.js\nmodule.exports = {\n  theme: {\n    extend: {\n      colors: {\n        palette: {\n${rows}\n        },\n      },\n    },\n  },\n};\n// Use it as bg-palette-1, text-palette-2, …`;
  }
  return `/* In your main CSS file, after @import "tailwindcss"; */\n@theme {\n${swatches
    .map((s, i) => `  --color-palette-${i + 1}: ${s.hex};`)
    .join('\n')}\n}\n/* Use it as bg-palette-1, text-palette-2, … */`;
}

async function copyText(text: string, done: (ok: boolean) => void) {
  try {
    await navigator.clipboard.writeText(text);
    done(true);
  } catch {
    done(false);
  }
}

function say(msg: string) {
  status.textContent = msg;
}

function render() {
  swatches = palette(buckets, Number(count.value));
  strip.replaceChildren(
    ...swatches.map((s) => {
      const d = document.createElement('span');
      d.style.background = s.hex;
      d.style.flexGrow = String(Math.max(s.share, 0.02));
      return d;
    }),
  );
  list.replaceChildren(
    ...swatches.map((s, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.background = s.hex;
      b.style.color = textOn(s.rgb);
      b.setAttribute('aria-label', `Copy ${s.hex}`);
      const h = document.createElement('strong');
      h.textContent = s.hex.toUpperCase();
      const sub = document.createElement('span');
      sub.textContent = `rgb(${s.rgb.join(', ')})`;
      const pct = `${Math.max(1, Math.round(s.share * 100))}% of the image`;
      const tip = document.createElement('em');
      tip.textContent = `${pct} · click to copy`;
      b.append(h, sub, tip);
      b.addEventListener('click', () =>
        copyText(s.hex.toUpperCase(), (ok) => {
          tip.textContent = ok ? 'Copied' : 'Copy failed';
          say(ok ? `Copied ${s.hex.toUpperCase()}` : 'Your browser blocked copying. Select the text instead.');
          setTimeout(() => (tip.textContent = `${pct} · click to copy`), 1400);
        }),
      );
      li.append(b);
      li.dataset.index = String(i);
      return li;
    }),
  );
  css.textContent = cssSnippet();
  tw.textContent = twSnippet();
  if (swatches.length < Number(count.value))
    say(`This image only has ${swatches.length} clearly different color${swatches.length === 1 ? '' : 's'}.`);
  else say('');
}

function load(file: File) {
  error.hidden = true;
  if (!file.type.startsWith('image/')) {
    error.textContent = 'That file isn’t an image. Try a PNG, JPG, SVG or WebP.';
    error.hidden = false;
    return;
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    buckets = sample(img);
    if (!buckets.length) {
      error.textContent = 'That image is fully see-through, so there are no colors to pick.';
      error.hidden = false;
      return;
    }
    preview.src = url;
    dropText.textContent = `${file.name || 'Pasted image'} · choose another`;
    result.hidden = false;
    render();
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    error.textContent = 'We couldn’t read that image. Try saving it as a PNG or JPG first.';
    error.hidden = false;
  };
  img.src = url;
}

fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f) load(f);
});
drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('over');
});
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const f = e.dataTransfer?.files?.[0];
  if (f) load(f);
});
document.addEventListener('paste', (e) => {
  const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
  if (f) load(f);
});
count.addEventListener('input', () => buckets.length && render());
twVersion.addEventListener('input', () => (tw.textContent = twSnippet()));

copyAll.addEventListener('click', () =>
  copyText(swatches.map((s) => s.hex.toUpperCase()).join('\n'), (ok) => say(ok ? 'Copied all colors' : 'Your browser blocked copying.')),
);
for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
  btn.addEventListener('click', () => {
    const target = $(btn.dataset.copy!);
    copyText(target.textContent ?? '', (ok) => {
      btn.textContent = ok ? 'Copied' : 'Copy failed';
      setTimeout(() => (btn.textContent = 'Copy'), 1400);
    });
  });
}
