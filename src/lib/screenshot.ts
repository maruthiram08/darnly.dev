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
): Promise<Blob> {
  const img = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  if (rect) {
    const s = img.width / viewportWidth;
    const pad = 4 * s;
    ctx.strokeStyle = '#e11d48';
    ctx.lineWidth = Math.max(3, 3 * s);
    ctx.strokeRect(rect.x * s - pad, rect.y * s - pad, rect.width * s + pad * 2, rect.height * s + pad * 2);
  }
  if (point) {
    // A dot where the user clicked, so a big box still shows the exact spot.
    const s = img.width / viewportWidth;
    ctx.beginPath();
    ctx.arc(point.x * s, point.y * s, 7 * s, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(225, 29, 72, 0.9)';
    ctx.fill();
    ctx.lineWidth = 2 * s;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }
  return canvas.convertToBlob({ type: 'image/png' });
}
