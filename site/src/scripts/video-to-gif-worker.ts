// Web Worker: turns video frames into a GIF with gifenc, off the main thread so the page stays smooth.
// Frames that look the same as the one before are merged into one longer frame, which keeps
// screen recordings (where little moves) small.
import { GIFEncoder, quantize, applyPalette } from 'gifenc';

type Msg =
  | { type: 'start'; width: number; height: number; repeat: number }
  | { type: 'frame'; data: ArrayBuffer; delay: number }
  | { type: 'end' };

let enc: ReturnType<typeof GIFEncoder> | null = null;
let w = 0;
let h = 0;
let repeat = 0;
let prev: Uint8ClampedArray | null = null;
let pending: { index: Uint8Array; palette: number[][]; delay: number } | null = null;
let first = true;
let frames = 0;

// True when two frames differ by no more than video noise. Checks every 7th pixel, which is plenty.
function same(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  for (let i = 0; i < a.length; i += 28) {
    if (Math.abs(a[i] - b[i]) > 6 || Math.abs(a[i + 1] - b[i + 1]) > 6 || Math.abs(a[i + 2] - b[i + 2]) > 6) return false;
  }
  return true;
}

// Picks the palette from about 40,000 of the frame's pixels instead of all of them:
// as good to the eye, and many times quicker on a big frame.
function sample(d: Uint8ClampedArray, max = 40000): Uint8ClampedArray {
  const n = d.length / 4;
  const step = Math.floor(n / max) | 1; // Odd, so the picks don't line up in columns.
  if (step <= 1) return d;
  const out = new Uint8ClampedArray(Math.ceil(n / step) * 4);
  let j = 0;
  for (let i = 0; i < n; i += step) {
    const k = i * 4;
    out[j++] = d[k]; out[j++] = d[k + 1]; out[j++] = d[k + 2]; out[j++] = d[k + 3];
  }
  return out.subarray(0, j);
}

function flush() {
  if (!enc || !pending) return;
  enc.writeFrame(pending.index, w, h, { palette: pending.palette, delay: pending.delay, repeat, first });
  first = false;
  frames++;
  pending = null;
}

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  if (m.type === 'start') {
    enc = GIFEncoder();
    w = m.width;
    h = m.height;
    repeat = m.repeat;
    prev = null;
    pending = null;
    first = true;
    frames = 0;
    return;
  }
  if (!enc) return;
  if (m.type === 'frame') {
    const rgba = new Uint8ClampedArray(m.data);
    if (prev && pending && same(prev, rgba)) {
      pending.delay += m.delay;
    } else {
      flush();
      const palette = quantize(sample(rgba), 256);
      pending = { index: applyPalette(rgba, palette), palette, delay: m.delay };
      prev = rgba;
    }
    self.postMessage({ type: 'progress', bytes: enc.bytesView().length });
    return;
  }
  if (m.type === 'end') {
    flush();
    enc.finish();
    const out = enc.bytes();
    self.postMessage({ type: 'done', bytes: out, frames }, { transfer: [out.buffer] });
    enc = null;
  }
};
