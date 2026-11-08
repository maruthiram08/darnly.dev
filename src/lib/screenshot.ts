import type { ElementInfo } from './element-info';

/** Largest side of a saved reference picture, in pixels: big enough to read, small enough for an agent. */
export const MAX_REFERENCE_SIDE = 1600;

/** Turns a pasted or dropped picture into a PNG, shrunk so its longest side is at most MAX_REFERENCE_SIDE. */
export async function referencePng(file: Blob): Promise<Blob> {
  const img = await createImageBitmap(file);
  const k = Math.min(1, MAX_REFERENCE_SIDE / Math.max(img.width, img.height, 1));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(img.width * k)), Math.max(1, Math.round(img.height * k)));
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.convertToBlob({ type: 'image/png' });
}

/**
 * Draws a red box around the picked element on the screenshot.
 * The screenshot is in device pixels, the element box in CSS pixels, so we scale by their ratio.
 */
export async function markScreenshot(
  dataUrl: string,
  viewportWidth: number,
  rect?: ElementInfo['rect'],
  point?: ElementInfo['point'],
  /** Lines written in a bar above the screenshot, so the picture alone still says what's wrong. */
  caption?: string[],
): Promise<Blob> {
  const img = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const k = img.width / viewportWidth;
  const font = 15 * k;
  const pad = 12 * k;
  const lines = caption?.length ? wrap(caption, img.width - pad * 2, font) : [];
  const bar = lines.length ? lines.length * font * 1.4 + pad * 2 : 0;
  const canvas = new OffscreenCanvas(img.width, img.height + bar);
  const ctx = canvas.getContext('2d')!;
  if (bar) {
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, img.width, bar);
    ctx.fillStyle = '#ffffff';
    ctx.font = `${font}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    lines.forEach((l, i) => ctx.fillText(l, pad, pad + i * font * 1.4));
    ctx.translate(0, bar);
  }
  ctx.drawImage(img, 0, 0);
  if (rect) {
    const s = img.width / viewportWidth;
    const pad = 4 * s;
    ctx.strokeStyle = '#e11d48';
    ctx.lineWidth = Math.max(3, 3 * s);
    ctx.strokeRect(rect.x * s - pad, rect.y * s - pad, rect.width * s + pad * 2, rect.height * s + pad * 2);
  }
  if (point) {
    // A hollow ring where the user clicked (only when the box is a big container),
    // so the exact spot shows without hiding the text under it.
    const s = img.width / viewportWidth;
    ctx.beginPath();
    ctx.arc(point.x * s, point.y * s, 9 * s, 0, Math.PI * 2);
    ctx.lineWidth = 4 * s;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.lineWidth = 2.5 * s;
    ctx.strokeStyle = '#e11d48';
    ctx.stroke();
  }
  return canvas.convertToBlob({ type: 'image/png' });
}

/** Wraps text to a width, at most 6 lines in all. */
function wrap(paragraphs: string[], width: number, font: number): string[] {
  const ctx = new OffscreenCanvas(1, 1).getContext('2d')!;
  ctx.font = `${font}px system-ui, sans-serif`;
  const out: string[] = [];
  for (const p of paragraphs) {
    let line = '';
    for (const word of p.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > width) {
        out.push(line);
        line = word;
      } else line = next;
    }
    if (line) out.push(line);
  }
  return out.length > 6 ? [...out.slice(0, 5), out[5] + ' …'] : out;
}

/** The steps picture holds at most this many screenshots (the last ones: the bug is at the end). */
export const MAX_STEP_PICTURES = 12;

/**
 * One picture of the recorded steps: a grid of the small screenshots, each captioned with its number (matching the
 * numbered list in the report) and what the user did. JPEG, so a dozen screenshots stay small.
 */
export async function stepsSheet(steps: { shot?: string; label: string; n: number }[]): Promise<Blob | undefined> {
  const withShots = steps.filter((s) => s.shot).slice(-MAX_STEP_PICTURES);
  if (!withShots.length) return undefined;
  const images = await Promise.all(withShots.map(async (s) => createImageBitmap(await (await fetch(s.shot!)).blob()).catch(() => null)));
  const cols = Math.min(3, withShots.length);
  const cellW = 420;
  const thumbH = Math.round(cellW * Math.max(...images.map((i) => (i ? i.height / i.width : 0.625)), 0.4));
  const captionH = 34;
  const gap = 12;
  const rows = Math.ceil(withShots.length / cols);
  const canvas = new OffscreenCanvas(cols * cellW + (cols + 1) * gap, rows * (thumbH + captionH) + (rows + 1) * gap);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f3f4f6';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  withShots.forEach((s, i) => {
    const x = gap + (i % cols) * (cellW + gap);
    const y = gap + Math.floor(i / cols) * (thumbH + captionH + gap);
    const img = images[i];
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, cellW, thumbH + captionH);
    if (img) ctx.drawImage(img, x, y, cellW, Math.round((cellW * img.height) / img.width));
    // The number and what the user did, in a bar under the picture (nothing drawn over the page itself).
    ctx.fillStyle = '#111827';
    ctx.font = '13px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    let label = `${s.n}. ${s.label}`;
    while (label.length > 4 && ctx.measureText(label).width > cellW - 16) label = label.slice(0, -2);
    if (label !== `${s.n}. ${s.label}`) label = label.trimEnd() + '…';
    ctx.fillText(label, x + 8, y + thumbH + captionH / 2);
  });
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
}
