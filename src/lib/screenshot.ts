import type { ElementInfo } from './element-info';

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
