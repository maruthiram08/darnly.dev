// Blur placeholder generator core: BlurHash and ThumbHash encode/decode, with no DOM.
// BlurHash follows Wolt's reference (MIT). ThumbHash follows Evan Wallace's reference (MIT).

const { PI, cos, abs, max, min, round, floor, pow, sign } = Math;

// ---------- BlurHash ----------

const B83 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';

function enc83(n: number, len: number): string {
  let s = '';
  for (let i = 1; i <= len; i++) s += B83[floor(n / pow(83, len - i)) % 83];
  return s;
}
function dec83(s: string): number {
  let v = 0;
  for (const c of s) {
    const d = B83.indexOf(c);
    if (d < 0) throw new Error('Not a BlurHash');
    v = v * 83 + d;
  }
  return v;
}
const toLin = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
};
const toSrgb = (v: number) => {
  const c = max(0, min(1, v));
  return c <= 0.0031308 ? Math.trunc(c * 12.92 * 255 + 0.5) : Math.trunc((1.055 * pow(c, 1 / 2.4) - 0.055) * 255 + 0.5);
};
const signPow = (v: number, e: number) => (sign(v) || 1) * pow(abs(v), e);

/** rgba is w*h*4 bytes. cx, cy are the detail across and down (1 to 9). */
export function blurhashEncode(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, cx: number, cy: number): string {
  if (cx < 1 || cx > 9 || cy < 1 || cy > 9) throw new Error('BlurHash detail must be 1 to 9');
  const lin = new Float64Array(w * h * 3);
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    lin[i * 3] = toLin(rgba[j]);
    lin[i * 3 + 1] = toLin(rgba[j + 1]);
    lin[i * 3 + 2] = toLin(rgba[j + 2]);
  }
  const factors: number[][] = [];
  for (let y = 0; y < cy; y++) {
    for (let x = 0; x < cx; x++) {
      const norm = x === 0 && y === 0 ? 1 : 2;
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < h; j++) {
        const fy = cos((PI * y * j) / h);
        for (let i = 0; i < w; i++) {
          const basis = norm * cos((PI * x * i) / w) * fy;
          const k = (j * w + i) * 3;
          r += basis * lin[k];
          g += basis * lin[k + 1];
          b += basis * lin[k + 2];
        }
      }
      const s = 1 / (w * h);
      factors.push([r * s, g * s, b * s]);
    }
  }
  const [dc, ...ac] = factors;
  let hash = enc83(cx - 1 + (cy - 1) * 9, 1);
  let maxVal = 1;
  if (ac.length) {
    let actualMax = 0;
    for (const f of ac) actualMax = max(actualMax, abs(f[0]), abs(f[1]), abs(f[2]));
    const q = floor(max(0, min(82, floor(actualMax * 166 - 0.5))));
    maxVal = (q + 1) / 166;
    hash += enc83(q, 1);
  } else {
    hash += enc83(0, 1);
  }
  hash += enc83((toSrgb(dc[0]) << 16) + (toSrgb(dc[1]) << 8) + toSrgb(dc[2]), 4);
  for (const f of ac) {
    const q = (v: number) => floor(max(0, min(18, floor(signPow(v / maxVal, 0.5) * 9 + 9.5))));
    hash += enc83(q(f[0]) * 361 + q(f[1]) * 19 + q(f[2]), 2);
  }
  return hash;
}

export function blurhashDecode(hash: string, w: number, h: number): Uint8ClampedArray {
  const size = dec83(hash[0]);
  const ny = floor(size / 9) + 1;
  const nx = (size % 9) + 1;
  if (hash.length !== 4 + 2 * nx * ny) throw new Error('BlurHash has the wrong length');
  const maxVal = (dec83(hash[1]) + 1) / 166;
  const colors: number[][] = [];
  const dc = dec83(hash.slice(2, 6));
  colors.push([toLin(dc >> 16), toLin((dc >> 8) & 255), toLin(dc & 255)]);
  for (let i = 1; i < nx * ny; i++) {
    const v = dec83(hash.slice(4 + i * 2, 6 + i * 2));
    const qr = floor(v / 361), qg = floor(v / 19) % 19, qb = v % 19;
    colors.push([signPow((qr - 9) / 9, 2) * maxVal, signPow((qg - 9) / 9, 2) * maxVal, signPow((qb - 9) / 9, 2) * maxVal]);
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < ny; j++) {
        const fy = cos((PI * y * j) / h);
        for (let i = 0; i < nx; i++) {
          const basis = cos((PI * x * i) / w) * fy;
          const c = colors[i + j * nx];
          r += c[0] * basis;
          g += c[1] * basis;
          b += c[2] * basis;
        }
      }
      const k = 4 * (x + y * w);
      out[k] = toSrgb(r);
      out[k + 1] = toSrgb(g);
      out[k + 2] = toSrgb(b);
      out[k + 3] = 255;
    }
  }
  return out;
}

/** Pick BlurHash detail for an image shape: 4 across the long side, at least 3 on the short side. */
export function blurhashDetail(w: number, h: number): [number, number] {
  if (w >= h) return [4, max(3, min(4, round((4 * h) / w)))];
  return [max(3, min(4, round((4 * w) / h))), 4];
}

// ---------- ThumbHash ----------

/** rgba is w*h*4 bytes; w and h must be 100 or less. */
export function thumbhashEncode(w: number, h: number, rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  if (w > 100 || h > 100) throw new Error(`${w}x${h} doesn't fit in 100x100`);
  let avgR = 0, avgG = 0, avgB = 0, avgA = 0;
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    const a = rgba[j + 3] / 255;
    avgR += (a / 255) * rgba[j];
    avgG += (a / 255) * rgba[j + 1];
    avgB += (a / 255) * rgba[j + 2];
    avgA += a;
  }
  if (avgA) {
    avgR /= avgA;
    avgG /= avgA;
    avgB /= avgA;
  }
  const hasAlpha = avgA < w * h;
  const lLimit = hasAlpha ? 5 : 7;
  const lx = max(1, round((lLimit * w) / max(w, h)));
  const ly = max(1, round((lLimit * h) / max(w, h)));
  const l: number[] = [], p: number[] = [], q: number[] = [], al: number[] = [];
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    const a = rgba[j + 3] / 255;
    const r = avgR * (1 - a) + (a / 255) * rgba[j];
    const g = avgG * (1 - a) + (a / 255) * rgba[j + 1];
    const b = avgB * (1 - a) + (a / 255) * rgba[j + 2];
    l[i] = (r + g + b) / 3;
    p[i] = (r + g) / 2 - b;
    q[i] = r - g;
    al[i] = a;
  }
  const channel = (ch: number[], nx: number, ny: number): [number, number[], number] => {
    let dc = 0, scale = 0;
    const ac: number[] = [];
    const fx: number[] = [];
    for (let cy = 0; cy < ny; cy++) {
      for (let cx = 0; cx * ny < nx * (ny - cy); cx++) {
        let f = 0;
        for (let x = 0; x < w; x++) fx[x] = cos((PI / w) * cx * (x + 0.5));
        for (let y = 0; y < h; y++) {
          const fy = cos((PI / h) * cy * (y + 0.5));
          for (let x = 0; x < w; x++) f += ch[x + y * w] * fx[x] * fy;
        }
        f /= w * h;
        if (cx || cy) {
          ac.push(f);
          scale = max(scale, abs(f));
        } else dc = f;
      }
    }
    if (scale) for (let i = 0; i < ac.length; i++) ac[i] = 0.5 + (0.5 / scale) * ac[i];
    return [dc, ac, scale];
  };
  const [lDc, lAc, lScale] = channel(l, max(3, lx), max(3, ly));
  const [pDc, pAc, pScale] = channel(p, 3, 3);
  const [qDc, qAc, qScale] = channel(q, 3, 3);
  const [aDc, aAc, aScale] = hasAlpha ? channel(al, 5, 5) : [0, [] as number[], 0];
  const landscape = w > h;
  const h24 = round(63 * lDc) | (round(31.5 + 31.5 * pDc) << 6) | (round(31.5 + 31.5 * qDc) << 12) | (round(31 * lScale) << 18) | ((hasAlpha ? 1 : 0) << 23);
  const h16 = (landscape ? ly : lx) | (round(63 * pScale) << 3) | (round(63 * qScale) << 9) | ((landscape ? 1 : 0) << 15);
  const hash = [h24 & 255, (h24 >> 8) & 255, h24 >> 16, h16 & 255, h16 >> 8];
  const acStart = hasAlpha ? 6 : 5;
  let idx = 0;
  if (hasAlpha) hash.push(round(15 * aDc) | (round(15 * aScale) << 4));
  for (const ac of hasAlpha ? [lAc, pAc, qAc, aAc] : [lAc, pAc, qAc]) {
    for (const f of ac) {
      const k = acStart + (idx >> 1);
      hash[k] = (hash[k] || 0) | (round(15 * f) << ((idx++ & 1) << 2));
    }
  }
  return new Uint8Array(hash);
}

export function thumbhashRatio(hash: Uint8Array): number {
  const header = hash[3];
  const hasAlpha = hash[2] & 0x80;
  const landscape = hash[4] & 0x80;
  const lx = landscape ? (hasAlpha ? 5 : 7) : header & 7;
  const ly = landscape ? header & 7 : hasAlpha ? 5 : 7;
  return lx / ly;
}

export function thumbhashDecode(hash: Uint8Array): { w: number; h: number; rgba: Uint8ClampedArray } {
  const h24 = hash[0] | (hash[1] << 8) | (hash[2] << 16);
  const h16 = hash[3] | (hash[4] << 8);
  const lDc = (h24 & 63) / 63;
  const pDc = ((h24 >> 6) & 63) / 31.5 - 1;
  const qDc = ((h24 >> 12) & 63) / 31.5 - 1;
  const lScale = ((h24 >> 18) & 31) / 31;
  const hasAlpha = h24 >> 23;
  const pScale = ((h16 >> 3) & 63) / 63;
  const qScale = ((h16 >> 9) & 63) / 63;
  const landscape = h16 >> 15;
  const lx = max(3, landscape ? (hasAlpha ? 5 : 7) : h16 & 7);
  const ly = max(3, landscape ? h16 & 7 : hasAlpha ? 5 : 7);
  const aDc = hasAlpha ? (hash[5] & 15) / 15 : 1;
  const aScale = (hash[5] >> 4) / 15;
  const acStart = hasAlpha ? 6 : 5;
  let idx = 0;
  const channel = (nx: number, ny: number, scale: number) => {
    const ac: number[] = [];
    for (let cy = 0; cy < ny; cy++)
      for (let cx = cy ? 0 : 1; cx * ny < nx * (ny - cy); cx++)
        ac.push((((hash[acStart + (idx >> 1)] >> ((idx++ & 1) << 2)) & 15) / 7.5 - 1) * scale);
    return ac;
  };
  const lAc = channel(lx, ly, lScale);
  const pAc = channel(3, 3, pScale * 1.25);
  const qAc = channel(3, 3, qScale * 1.25);
  const aAc = hasAlpha ? channel(5, 5, aScale) : [];
  const ratio = thumbhashRatio(hash);
  const w = round(ratio > 1 ? 32 : 32 * ratio);
  const h = round(ratio > 1 ? 32 / ratio : 32);
  const rgba = new Uint8ClampedArray(w * h * 4);
  const fx: number[] = [], fy: number[] = [];
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      let l = lDc, p = pDc, q = qDc, a = aDc;
      for (let cx = 0, n = max(lx, hasAlpha ? 5 : 3); cx < n; cx++) fx[cx] = cos((PI / w) * (x + 0.5) * cx);
      for (let cy = 0, n = max(ly, hasAlpha ? 5 : 3); cy < n; cy++) fy[cy] = cos((PI / h) * (y + 0.5) * cy);
      for (let cy = 0, j = 0; cy < ly; cy++)
        for (let cx = cy ? 0 : 1, f2 = fy[cy] * 2; cx * ly < lx * (ly - cy); cx++, j++) l += lAc[j] * fx[cx] * f2;
      for (let cy = 0, j = 0; cy < 3; cy++)
        for (let cx = cy ? 0 : 1, f2 = fy[cy] * 2; cx < 3 - cy; cx++, j++) {
          const f = fx[cx] * f2;
          p += pAc[j] * f;
          q += qAc[j] * f;
        }
      if (hasAlpha)
        for (let cy = 0, j = 0; cy < 5; cy++)
          for (let cx = cy ? 0 : 1, f2 = fy[cy] * 2; cx < 5 - cy; cx++, j++) a += aAc[j] * fx[cx] * f2;
      const b = l - (2 / 3) * p;
      const r = (3 * l - b + q) / 2;
      const g = r - q;
      rgba[i] = max(0, 255 * min(1, r));
      rgba[i + 1] = max(0, 255 * min(1, g));
      rgba[i + 2] = max(0, 255 * min(1, b));
      rgba[i + 3] = max(0, 255 * min(1, a));
    }
  }
  return { w, h, rgba };
}

// ---------- Small helpers ----------

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** A blurred SVG wrapping a tiny image, like Next.js does, so it looks smooth anywhere (CSS, <img>). */
export function blurSvg(tinyDataUri: string, w: number, h: number, seeThrough = false): string {
  // Solid images keep hard edges after blurring; see-through ones keep their soft alpha.
  const solid = seeThrough ? '' : "<feComponentTransfer><feFuncA type='discrete' tableValues='1 1'/></feComponentTransfer>";
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}'><filter id='b' color-interpolation-filters='sRGB'><feGaussianBlur stdDeviation='0.6'/>${solid}</filter><image filter='url(#b)' x='0' y='0' width='${w}' height='${h}' preserveAspectRatio='none' href='${tinyDataUri}'/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
