// EXIF remover core: read what's hidden in a photo, and strip it without touching the pixels.
// Pure functions on bytes, so they can be tested outside the browser.
import { crc32 } from './zip';

export type Kind = 'jpeg' | 'png' | 'webp' | 'heic' | 'other';

export type Meta = {
  gps?: { lat: number; lon: number; alt?: number };
  taken?: string; // EXIF date "2025:03:12 20:41:07"
  make?: string;
  model?: string;
  lens?: string;
  software?: string;
  artist?: string;
  copyright?: string;
  owner?: string;
  serial?: string;
  description?: string;
  orientation?: number;
  thumbnail?: boolean;
  exif?: boolean; // any EXIF block at all
  xmp?: boolean;
  iptc?: boolean;
  comment?: boolean;
  text?: string[]; // PNG text keys, e.g. "Author", "parameters"
};

const ascii = new TextDecoder('latin1');
const utf8 = new TextDecoder();

function startsWith(b: Uint8Array, at: number, s: string): boolean {
  if (at + s.length > b.length) return false;
  for (let i = 0; i < s.length; i++) if (b[at + i] !== s.charCodeAt(i)) return false;
  return true;
}

export function sniff(b: Uint8Array): Kind {
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpeg';
  if (startsWith(b, 0, '\x89PNG\r\n\x1a\n')) return 'png';
  if (startsWith(b, 0, 'RIFF') && startsWith(b, 8, 'WEBP')) return 'webp';
  if (startsWith(b, 4, 'ftyp') && /^(heic|heix|hevc|heim|heis|mif1|msf1|avif|avis)/.test(ascii.decode(b.subarray(8, 12)))) return 'heic';
  return 'other';
}

// ---------- Reading EXIF (TIFF) ----------

const SIZES = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];

type Entry = { type: number; count: number; at: number };

class Tiff {
  b: Uint8Array;
  v: DataView;
  le: boolean;
  constructor(b: Uint8Array) {
    this.b = b;
    this.v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    this.le = b[0] === 0x49;
  }
  u16(o: number) { return this.v.getUint16(o, this.le); }
  u32(o: number) { return this.v.getUint32(o, this.le); }
  ifd(off: number): { tags: Map<number, Entry>; next: number } {
    const tags = new Map<number, Entry>();
    if (!off || off + 2 > this.b.length) return { tags, next: 0 };
    const n = this.u16(off);
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      if (e + 12 > this.b.length) break;
      const type = this.u16(e + 2);
      const count = this.u32(e + 4);
      const size = (SIZES[type] ?? 1) * count;
      const at = size <= 4 ? e + 8 : this.u32(e + 8);
      if (at + size <= this.b.length) tags.set(this.u16(e), { type, count, at });
    }
    const nx = off + 2 + n * 12;
    return { tags, next: nx + 4 <= this.b.length ? this.u32(nx) : 0 };
  }
  str(e?: Entry): string | undefined {
    if (!e) return undefined;
    const raw = this.b.subarray(e.at, e.at + e.count);
    let s: string;
    if (e.type === 7 && startsWith(raw, 0, 'ASCII\0\0\0')) s = ascii.decode(raw.subarray(8));
    else if (e.type === 7 && startsWith(raw, 0, 'UNICODE\0')) s = new TextDecoder(this.le ? 'utf-16le' : 'utf-16be').decode(raw.subarray(8));
    else if (e.type === 2 || e.type === 7) s = utf8.decode(raw);
    else return undefined;
    s = s.replace(/\0+$/g, '').replace(/\0/g, ' ').trim();
    return s || undefined;
  }
  num(e?: Entry): number | undefined {
    if (!e) return undefined;
    if (e.type === 3) return this.u16(e.at);
    if (e.type === 4) return this.u32(e.at);
    if (e.type === 1) return this.b[e.at];
    return undefined;
  }
  rats(e?: Entry): number[] | undefined {
    if (!e || (e.type !== 5 && e.type !== 10)) return undefined;
    const out: number[] = [];
    for (let i = 0; i < e.count; i++) {
      const n = e.type === 5 ? this.u32(e.at + i * 8) : this.v.getInt32(e.at + i * 8, this.le);
      const d = e.type === 5 ? this.u32(e.at + i * 8 + 4) : this.v.getInt32(e.at + i * 8 + 4, this.le);
      out.push(d ? n / d : 0);
    }
    return out;
  }
}

function dms(r?: number[]): number | undefined {
  if (!r || !r.length) return undefined;
  return (r[0] ?? 0) + (r[1] ?? 0) / 60 + (r[2] ?? 0) / 3600;
}

// Reads a TIFF block (the bytes after "Exif\0\0") into meta.
export function readTiff(b: Uint8Array, meta: Meta) {
  if (!(startsWith(b, 0, 'II*\0') || startsWith(b, 0, 'MM\0*'))) return;
  meta.exif = true;
  try {
    const t = new Tiff(b);
    const { tags: i0, next } = t.ifd(t.u32(4));
    meta.make ??= t.str(i0.get(0x010f));
    meta.model ??= t.str(i0.get(0x0110));
    meta.software ??= t.str(i0.get(0x0131));
    meta.artist ??= t.str(i0.get(0x013b));
    meta.copyright ??= t.str(i0.get(0x8298));
    meta.description ??= t.str(i0.get(0x010e));
    meta.orientation ??= t.num(i0.get(0x0112));
    const date0 = t.str(i0.get(0x0132));
    if (next && t.ifd(next).tags.size) meta.thumbnail = true;

    const exifPtr = t.num(i0.get(0x8769));
    if (exifPtr) {
      const { tags: ex } = t.ifd(exifPtr);
      meta.taken ??= t.str(ex.get(0x9003)) ?? t.str(ex.get(0x9004));
      meta.lens ??= t.str(ex.get(0xa434));
      meta.owner ??= t.str(ex.get(0xa430));
      meta.serial ??= t.str(ex.get(0xa431));
      meta.description ??= t.str(ex.get(0x9286)); // UserComment
    }
    meta.taken ??= date0;

    const gpsPtr = t.num(i0.get(0x8825));
    if (gpsPtr && !meta.gps) {
      const { tags: g } = t.ifd(gpsPtr);
      let lat = dms(t.rats(g.get(2)));
      let lon = dms(t.rats(g.get(4)));
      if (lat !== undefined && lon !== undefined && !(lat === 0 && lon === 0)) {
        if (t.str(g.get(1))?.toUpperCase().startsWith('S')) lat = -lat;
        if (t.str(g.get(3))?.toUpperCase().startsWith('W')) lon = -lon;
        const alt = t.rats(g.get(6))?.[0];
        const below = t.num(g.get(5)) === 1;
        meta.gps = { lat, lon, alt: alt === undefined ? undefined : below ? -alt : alt };
      }
    }
  } catch {
    // A broken EXIF block still counts as "has EXIF"; we just can't list what's in it.
  }
}

// XMP is XML; pull the few things people care about, including GPS that editors like Lightroom write.
export function readXmp(xml: string, meta: Meta) {
  meta.xmp = true;
  const attr = (name: string) => {
    const m = xml.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`)) ?? xml.match(new RegExp(`<${name}>([^<]*)</${name}>`));
    return m?.[1]?.trim() || undefined;
  };
  const coord = (s?: string) => {
    const m = s?.match(/^(\d+),(\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?))?([NSEW])$/i);
    if (!m) return undefined;
    const v = Number(m[1]) + Number(m[2]) / 60 + Number(m[3] ?? 0) / 3600;
    return /[SW]/i.test(m[4]) ? -v : v;
  };
  if (!meta.gps) {
    const lat = coord(attr('exif:GPSLatitude'));
    const lon = coord(attr('exif:GPSLongitude'));
    if (lat !== undefined && lon !== undefined) meta.gps = { lat, lon };
  }
  meta.make ??= attr('tiff:Make');
  meta.model ??= attr('tiff:Model');
  meta.software ??= attr('xmp:CreatorTool');
  const created = attr('exif:DateTimeOriginal') ?? attr('photoshop:DateCreated') ?? attr('xmp:CreateDate');
  if (created && !meta.taken) meta.taken = created.replace(/^(\d{4})-(\d\d)-(\d\d)T?/, '$1:$2:$3 ').trim();
  meta.lens ??= attr('aux:Lens') ?? attr('exifEX:LensModel');
  meta.serial ??= attr('aux:SerialNumber') ?? attr('exifEX:BodySerialNumber');
  const creator = xml.match(/<dc:creator>[\s\S]*?<rdf:li[^>]*>([^<]+)<\/rdf:li>/)?.[1]?.trim();
  meta.artist ??= creator;
}

// ---------- JPEG ----------

type Seg = { marker: number; start: number; end: number }; // end is exclusive; for SOS it includes the scan data

// Walks the main image only: segments, scan data, up to and including EOI.
function jpegSegments(b: Uint8Array): { segs: Seg[]; eoi: number } {
  const segs: Seg[] = [];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) throw new Error('bad jpeg');
    while (b[i] === 0xff && b[i + 1] === 0xff) i++;
    const m = b[i + 1];
    if (m === 0xd9) return { segs, eoi: i + 2 };
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) {
      segs.push({ marker: m, start: i, end: i + 2 });
      i += 2;
      continue;
    }
    const len = (b[i + 2] << 8) | b[i + 3];
    let end = i + 2 + len;
    if (m === 0xda) {
      // Entropy-coded data runs until a marker that isn't a stuffed byte or a restart marker.
      let j = end;
      while (j + 1 < b.length && !(b[j] === 0xff && b[j + 1] !== 0 && !(b[j + 1] >= 0xd0 && b[j + 1] <= 0xd7))) j++;
      end = j;
    }
    if (end > b.length) end = b.length;
    segs.push({ marker: m, start: i, end });
    i = end;
  }
  return { segs, eoi: b.length };
}

function appId(b: Uint8Array, s: Seg): string {
  return ascii.decode(b.subarray(s.start + 4, Math.min(s.end, s.start + 4 + 40)));
}

function readJpeg(b: Uint8Array, meta: Meta) {
  const { segs } = jpegSegments(b);
  for (const s of segs) {
    const id = appId(b, s);
    if (s.marker === 0xe1 && id.startsWith('Exif\0')) readTiff(b.subarray(s.start + 10, s.end), meta);
    else if (s.marker === 0xe1 && id.startsWith('http://ns.adobe.com/xap/1.0/\0')) readXmp(utf8.decode(b.subarray(s.start + 33, s.end)), meta);
    else if (s.marker === 0xe1 && id.startsWith('http://ns.adobe.com/xmp/extension/')) meta.xmp = true;
    else if (s.marker === 0xed) meta.iptc = true;
    else if (s.marker === 0xfe) meta.comment = true;
  }
}

// Keep only what's needed to show the picture right: JFIF, the color profile, Adobe color info, and the image itself.
function keepJpeg(b: Uint8Array, s: Seg): boolean {
  const m = s.marker;
  if (m === 0xe0) return appId(b, s).startsWith('JFIF\0');
  if (m === 0xe2) return appId(b, s).startsWith('ICC_PROFILE\0');
  if (m === 0xee) return appId(b, s).startsWith('Adobe');
  if (m >= 0xe1 && m <= 0xef) return false;
  if (m === 0xfe) return false;
  return true;
}

function app1(tiff: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + 6 + tiff.length);
  out.set([0xff, 0xe1, ((out.length - 2) >> 8) & 0xff, (out.length - 2) & 0xff], 0);
  out.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4); // "Exif\0\0"
  out.set(tiff, 10);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function stripJpeg(b: Uint8Array, orientation?: number): Uint8Array {
  const { segs } = jpegSegments(b);
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  // Without the rotation flag, a sideways phone photo would come out sideways, so keep just that one value.
  const rot = orientation && orientation !== 1 ? app1(writeTiff([{ tag: 0x0112, type: 3, value: orientation }])) : null;
  let placed = !rot;
  for (const s of segs) {
    if (!placed && s.marker !== 0xe0) {
      parts.push(rot!);
      placed = true;
    }
    if (keepJpeg(b, s)) parts.push(b.subarray(s.start, s.end));
  }
  // Anything after the main image (extra pictures like depth maps, each with its own metadata) is dropped.
  parts.push(new Uint8Array([0xff, 0xd9]));
  return concat(parts);
}

// ---------- PNG ----------

const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

function pngChunks(b: Uint8Array): { type: string; start: number; end: number; data: Uint8Array }[] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out = [];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = v.getUint32(i);
    const type = ascii.decode(b.subarray(i + 4, i + 8));
    const end = Math.min(b.length, i + 12 + len);
    out.push({ type, start: i, end, data: b.subarray(i + 8, Math.min(b.length, i + 8 + len)) });
    i = end;
    if (type === 'IEND') break;
  }
  return out;
}

function readPng(b: Uint8Array, meta: Meta) {
  for (const c of pngChunks(b)) {
    if (c.type === 'eXIf') readTiff(c.data, meta);
    else if (c.type === 'tEXt' || c.type === 'zTXt' || c.type === 'iTXt') {
      const nul = c.data.indexOf(0);
      const key = ascii.decode(c.data.subarray(0, nul < 0 ? Math.min(c.data.length, 79) : nul));
      if (key === 'XML:com.adobe.xmp') {
        // iTXt: key\0 flag method lang\0 tkey\0 text (only plain text is readable without inflating)
        let p = nul + 3;
        p = c.data.indexOf(0, p) + 1;
        p = c.data.indexOf(0, p) + 1;
        readXmp(c.data[nul + 1] === 0 ? utf8.decode(c.data.subarray(p)) : '', meta);
      } else {
        (meta.text ??= []).includes(key) || meta.text.push(key);
        if (c.type === 'tEXt') {
          const val = ascii.decode(c.data.subarray(nul + 1)).trim();
          if (key === 'Author') meta.artist ??= val;
          if (key === 'Software') meta.software ??= val;
          if (key === 'Copyright') meta.copyright ??= val;
          if (key === 'Creation Time') meta.taken ??= val;
        }
      }
    } else if (c.type === 'tIME') meta.text ??= [];
  }
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function stripPng(b: Uint8Array, orientation?: number): Uint8Array {
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  for (const c of pngChunks(b)) {
    if (c.type === 'IEND' && orientation && orientation !== 1) parts.push(pngChunk('eXIf', writeTiff([{ tag: 0x0112, type: 3, value: orientation }])));
    if (!PNG_DROP.has(c.type)) parts.push(b.subarray(c.start, c.end));
  }
  return concat(parts);
}

// ---------- WebP ----------

function webpChunks(b: Uint8Array) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: { type: string; start: number; end: number; data: Uint8Array }[] = [];
  let i = 12;
  while (i + 8 <= b.length) {
    const type = ascii.decode(b.subarray(i, i + 4));
    const len = v.getUint32(i + 4, true);
    const end = Math.min(b.length, i + 8 + len + (len & 1));
    out.push({ type, start: i, end, data: b.subarray(i + 8, Math.min(b.length, i + 8 + len)) });
    i = end;
  }
  return out;
}

function readWebp(b: Uint8Array, meta: Meta) {
  for (const c of webpChunks(b)) {
    if (c.type === 'EXIF') readTiff(startsWith(c.data, 0, 'Exif\0\0') ? c.data.subarray(6) : c.data, meta);
    else if (c.type === 'XMP ') readXmp(utf8.decode(c.data), meta);
  }
}

function stripWebp(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [b.subarray(0, 12)];
  for (const c of webpChunks(b)) {
    if (c.type === 'EXIF' || c.type === 'XMP ') continue;
    const chunk = b.slice(c.start, c.end);
    if (c.type === 'VP8X') chunk[8] &= ~0x0c; // clear the "has EXIF" and "has XMP" flags
    parts.push(chunk);
  }
  const out = concat(parts);
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  return out;
}

// ---------- Anything else (HEIC, AVIF, TIFF…): find an EXIF block by its signature ----------

function readLoose(b: Uint8Array, meta: Meta) {
  const limit = Math.min(b.length, 4 * 1024 * 1024);
  for (let i = 0; i + 10 < limit; i++) {
    if (b[i] === 0x45 && startsWith(b, i, 'Exif\0\0') && (startsWith(b, i + 6, 'MM\0*') || startsWith(b, i + 6, 'II*\0'))) {
      readTiff(b.subarray(i + 6), meta);
      break;
    }
  }
  if (startsWith(b, 0, 'II*\0') || startsWith(b, 0, 'MM\0*')) readTiff(b, meta);
  const text = ascii.decode(b.subarray(0, limit));
  const x = text.indexOf('<x:xmpmeta');
  if (x >= 0) readXmp(text.slice(x, text.indexOf('</x:xmpmeta>', x) + 12 || undefined), meta);
}

// ---------- Public API ----------

export function readMeta(b: Uint8Array): Meta {
  const meta: Meta = {};
  try {
    const k = sniff(b);
    if (k === 'jpeg') readJpeg(b, meta);
    else if (k === 'png') readPng(b, meta);
    else if (k === 'webp') readWebp(b, meta);
    else readLoose(b, meta);
  } catch {
    // Unreadable structure: report what we found so far.
  }
  return meta;
}

// Returns the same picture with the metadata removed, or null if this format needs re-drawing instead.
export function stripMeta(b: Uint8Array): Uint8Array | null {
  const k = sniff(b);
  try {
    if (k === 'jpeg') return stripJpeg(b, readMeta(b).orientation);
    if (k === 'png') return stripPng(b, readMeta(b).orientation);
    if (k === 'webp') return stripWebp(b);
  } catch {
    return null;
  }
  return null;
}

// What's left that someone could learn from. Used for the verdict and to double-check the clean copy.
export function findings(m: Meta): string[] {
  const out: string[] = [];
  if (m.gps) out.push('location');
  if (m.taken) out.push('date');
  if (m.make || m.model || m.lens) out.push('camera');
  if (m.serial) out.push('serial');
  if (m.artist || m.owner || m.copyright) out.push('name');
  if (m.software) out.push('software');
  if (m.description) out.push('caption');
  if (m.thumbnail) out.push('thumbnail');
  if (m.xmp || m.iptc || m.comment || m.text?.length) out.push('other');
  return out;
}

// ---------- Writing a small EXIF block (big-endian) ----------

export type Tag = { tag: number; type: 2 | 3 | 4 | 5; value: string | number | number[] };

function tagBytes(t: Tag): Uint8Array {
  if (t.type === 2) {
    const s = String(t.value);
    const out = new Uint8Array(s.length + 1);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }
  const vals = Array.isArray(t.value) ? t.value : [Number(t.value)];
  const size = t.type === 3 ? 2 : t.type === 4 ? 4 : 8;
  const n = t.type === 5 ? vals.length / 2 : vals.length;
  const out = new Uint8Array(n * size);
  const v = new DataView(out.buffer);
  for (let i = 0; i < vals.length; i++) {
    if (t.type === 3) v.setUint16(i * 2, vals[i]);
    else v.setUint32(i * 4, vals[i]);
  }
  return out;
}

function count(t: Tag, bytes: Uint8Array): number {
  return t.type === 2 ? bytes.length : t.type === 3 ? bytes.length / 2 : t.type === 4 ? bytes.length / 4 : bytes.length / 8;
}

// IFD0 plus optional Exif and GPS sub-IFDs. Rationals are given as flat [num, den, num, den…].
export function writeTiff(ifd0: Tag[], exif: Tag[] = [], gps: Tag[] = []): Uint8Array {
  const groups: Tag[][] = [[...ifd0], exif, gps];
  if (exif.length) groups[0].push({ tag: 0x8769, type: 4, value: 0 });
  if (gps.length) groups[0].push({ tag: 0x8825, type: 4, value: 0 });
  const used = groups.filter((g, i) => i === 0 || g.length);
  for (const g of used) g.sort((a, b) => a.tag - b.tag);
  const sizeOf = (g: Tag[]) => 2 + g.length * 12 + 4 + g.reduce((n, t) => { const l = tagBytes(t).length; return n + (l > 4 ? l + (l & 1) : 0); }, 0);
  const offsets: number[] = [];
  let off = 8;
  for (const g of used) {
    offsets.push(off);
    off += sizeOf(g);
  }
  const out = new Uint8Array(off);
  const v = new DataView(out.buffer);
  out.set([0x4d, 0x4d, 0, 42, 0, 0, 0, 8]);
  used.forEach((g, gi) => {
    const base = offsets[gi];
    let data = base + 2 + g.length * 12 + 4;
    v.setUint16(base, g.length);
    g.forEach((t, i) => {
      if (t.tag === 0x8769) t = { ...t, value: offsets[used.indexOf(exif)] };
      if (t.tag === 0x8825) t = { ...t, value: offsets[used.indexOf(gps)] };
      const bytes = tagBytes(t);
      const e = base + 2 + i * 12;
      v.setUint16(e, t.tag);
      v.setUint16(e + 2, t.type);
      v.setUint32(e + 4, count(t, bytes));
      if (bytes.length <= 4) out.set(bytes, e + 8);
      else {
        v.setUint32(e + 8, data);
        out.set(bytes, data);
        data += bytes.length + (bytes.length & 1);
      }
    });
    v.setUint32(base + 2 + g.length * 12, 0);
  });
  return out;
}

// Puts an EXIF block right after the start of a JPEG (used for the sample photo).
export function addJpegExif(jpeg: Uint8Array, tiff: Uint8Array): Uint8Array {
  return concat([jpeg.subarray(0, 2), app1(tiff), jpeg.subarray(2)]);
}

// Degrees to EXIF rationals: [deg,1, min,1, sec*100,100]
export function toDms(x: number): number[] {
  const a = Math.abs(x);
  const d = Math.floor(a);
  const m = Math.floor((a - d) * 60);
  const s = Math.round(((a - d) * 60 - m) * 60 * 100);
  return [d, 1, m, 1, s, 100];
}
