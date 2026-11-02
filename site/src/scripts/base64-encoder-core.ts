// Base64 helpers with no DOM, so they can be tested on their own.

export function bytesToBase64(bytes: Uint8Array, urlSafe = false): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  const b64 = btoa(bin);
  return urlSafe ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b64;
}

export function textToBase64(text: string, urlSafe = false): string {
  return bytesToBase64(new TextEncoder().encode(text), urlSafe);
}

export type Parsed = { bytes: Uint8Array; urlSafe: boolean; mime?: string };

// Accepts standard or URL-safe Base64, with or without padding, spaces or line breaks, or a full data: URI.
export function parseBase64(input: string): Parsed {
  let s = input.trim();
  let mime: string | undefined;
  const m = /^data:([^,]*?),/i.exec(s);
  if (m) {
    const meta = m[1];
    if (!/;base64$/i.test(meta)) {
      // A data URI that isn't Base64 (URL-encoded text).
      const bytes = new TextEncoder().encode(decodeURIComponent(s.slice(m[0].length)));
      return { bytes, urlSafe: false, mime: meta.split(';')[0] || 'text/plain' };
    }
    mime = meta.replace(/;base64$/i, '').split(';')[0] || 'application/octet-stream';
    s = s.slice(m[0].length);
  }
  s = s.replace(/\s+/g, '');
  if (!s) throw new Error('empty');
  const urlSafe = /[-_]/.test(s);
  if (urlSafe && /[+/]/.test(s)) throw new Error('mixed');
  let clean = s.replace(/-/g, '+').replace(/_/g, '/');
  const padAt = clean.indexOf('=');
  if (padAt !== -1 && !/^=+$/.test(clean.slice(padAt))) throw new Error('padding');
  clean = clean.replace(/=+$/, '');
  const bad = clean.search(/[^A-Za-z0-9+/]/);
  if (bad !== -1) throw new Error(`char:${clean[bad]}`);
  if (clean.length % 4 === 1) throw new Error('length');
  const bin = atob(clean + '='.repeat((4 - (clean.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, urlSafe, mime };
}

// Readable text if the bytes are valid UTF-8 with no control characters (other than tabs and line breaks).
export function bytesToText(bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)) return null;
    return text;
  } catch {
    return null;
  }
}

// Recognizes common file types from their first bytes.
export function sniffType(b: Uint8Array): { mime: string; name: string } | null {
  const starts = (...sig: number[]) => sig.every((x, i) => b[i] === x);
  const ascii = (from: number, s: string) => [...s].every((c, i) => b[from + i] === c.charCodeAt(0));
  if (starts(0x89, 0x50, 0x4e, 0x47)) return { mime: 'image/png', name: 'PNG image' };
  if (starts(0xff, 0xd8, 0xff)) return { mime: 'image/jpeg', name: 'JPEG image' };
  if (ascii(0, 'GIF8')) return { mime: 'image/gif', name: 'GIF image' };
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return { mime: 'image/webp', name: 'WebP image' };
  if (ascii(4, 'ftypavif')) return { mime: 'image/avif', name: 'AVIF image' };
  if (starts(0x00, 0x00, 0x01, 0x00)) return { mime: 'image/x-icon', name: 'ICO icon' };
  if (ascii(0, '%PDF')) return { mime: 'application/pdf', name: 'PDF document' };
  if (starts(0x50, 0x4b, 0x03, 0x04)) return { mime: 'application/zip', name: 'ZIP archive' };
  if (ascii(0, 'wOF2')) return { mime: 'font/woff2', name: 'WOFF2 font' };
  if (ascii(0, 'wOFF')) return { mime: 'font/woff', name: 'WOFF font' };
  if (starts(0x1f, 0x8b)) return { mime: 'application/gzip', name: 'Gzip file' };
  if (ascii(4, 'ftyp')) return { mime: 'video/mp4', name: 'MP4 video' };
  if (ascii(0, 'ID3') || starts(0xff, 0xfb)) return { mime: 'audio/mpeg', name: 'MP3 audio' };
  const head = new TextDecoder().decode(b.subarray(0, 200)).trimStart();
  if (/^(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(head)) return { mime: 'image/svg+xml', name: 'SVG image' };
  return null;
}

// Does this look like Base64 rather than ordinary text? Used to suggest switching to Decode.
export function looksLikeBase64(s: string): boolean {
  const t = s.trim();
  if (/^data:[^,]*;base64,/i.test(t)) return true;
  const c = t.replace(/\s+/g, '');
  if (c.length < 8 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(c)) return false;
  if (!/\d|[+/_-]|=$/.test(c) && !/[a-z][A-Z]|[A-Z]{2}[a-z]/.test(c)) return false;
  try {
    const { bytes } = parseBase64(c);
    return bytesToText(bytes) !== null || sniffType(bytes) !== null;
  } catch {
    return false;
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} byte${n === 1 ? '' : 's'}`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function snippets(dataUri: string, name: string) {
  const alt = name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/"/g, '') || 'image';
  return {
    uri: dataUri,
    img: `<img src="${dataUri}" alt="${alt}" />`,
    css: `background-image: url("${dataUri}");`,
    json: JSON.stringify({ name, dataUri }, null, 2),
    raw: dataUri.slice(dataUri.indexOf(',') + 1),
  };
}
