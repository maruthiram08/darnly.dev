// Screenshots for the responsive checker, for sites that refuse to be shown in a frame.
// Uses Cloudflare Browser Rendering (the BROWSER binding). This is the one tool that costs money
// per use, so it has its own stricter limits (see wrangler.jsonc) and a one hour cache.

import puppeteer from '@cloudflare/puppeteer';

export const WIDTHS = [
  { width: 390, height: 844, mobile: true },
  { width: 768, height: 1024, mobile: true },
  { width: 1280, height: 800, mobile: false },
];

const PAGE_TIMEOUT_MS = 12_000;
const TOTAL_MS = 25_000;
// How far down the page we capture: about three screens.
const MAX_SCREENS = 3;

type Check = (raw: string) => boolean;

// Takes one JPEG per width. `allowed` decides every address the browser may load, including redirects.
export async function takeShots(binding: unknown, target: string, allowed: Check): Promise<{ width: number; image: string }[]> {
  const browser = await puppeteer.launch(binding as Parameters<typeof puppeteer.launch>[0]);
  const deadline = Date.now() + TOTAL_MS;
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      const u = r.url();
      if (u.startsWith('data:') || u.startsWith('blob:') || allowed(u)) r.continue();
      else r.abort('blockedbyclient');
    });
    const shots: { width: number; image: string }[] = [];
    for (const w of WIDTHS) {
      const left = deadline - Date.now();
      if (left < 2_000) break;
      await page.setViewport({ width: w.width, height: w.height, isMobile: w.mobile, hasTouch: w.mobile, deviceScaleFactor: 1 });
      let status = 0;
      try {
        const res = await page.goto(target, { waitUntil: 'networkidle2', timeout: Math.min(PAGE_TIMEOUT_MS, left - 1_000) });
        status = res?.status() ?? 0;
      } catch {
        // Busy pages never go quiet; take what has loaded so far.
      }
      const at = page.url();
      if (at.startsWith('chrome-error:') || status === 403 || status === 429) throw new Error('site-blocked');
      if (!allowed(at)) throw new Error('redirected');
      const full = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => w.height);
      const height = Math.max(w.height, Math.min(full, w.height * MAX_SCREENS));
      const jpeg = (await page.screenshot({
        type: 'jpeg',
        quality: 60,
        clip: { x: 0, y: 0, width: w.width, height },
        captureBeyondViewport: true,
      })) as Uint8Array;
      shots.push({ width: w.width, image: `data:image/jpeg;base64,${base64(jpeg)}` });
    }
    return shots;
  } finally {
    await browser.close().catch(() => {});
  }
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
