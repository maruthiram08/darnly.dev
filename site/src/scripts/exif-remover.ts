// EXIF remover: shows what's hidden in each photo, then removes it. Everything runs in the browser.
import { makeZip, type ZipEntry } from './zip';
import { addJpegExif, findings, readMeta, sniff, stripMeta, toDms, writeTiff, type Kind, type Meta } from './exif-remover-core';

const MAX_FILES = 50;
const MAX_BYTES = 60 * 1024 * 1024;

type Item = {
  name: string;
  bytes: Uint8Array;
  kind: Kind;
  meta: Meta;
  sample: boolean;
  url: string;
  card: HTMLLIElement;
  out: Blob | null;
  outName: string;
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fileInput = $<HTMLInputElement>('er-file');
const drop = $<HTMLLabelElement>('er-drop');
const error = $<HTMLParagraphElement>('er-error');
const bar = $<HTMLDivElement>('er-bar');
const summary = $<HTMLParagraphElement>('er-summary');
const cleanBtn = $<HTMLButtonElement>('er-clean');
const zipBtn = $<HTMLButtonElement>('er-zip');
const clearBtn = $<HTMLButtonElement>('er-clearall');
const list = $<HTMLUListElement>('er-list');

let items: Item[] = [];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function niceDate(s: string): string {
  const m = s.match(/^(\d{4})[:-](\d\d)[:-](\d\d)[ T]?(\d\d)?:?(\d\d)?/);
  if (!m) return s;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0));
  if (isNaN(d.getTime())) return s;
  return m[4] ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function coords(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? 'E' : 'W'}`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

type Fact = { key: string; icon: string; label: string; value: string; why: string };

function facts(m: Meta): Fact[] {
  const out: Fact[] = [];
  if (m.taken) out.push({ key: 'date', icon: '🕒', label: 'Taken on', value: niceDate(m.taken), why: 'Shows when you were there.' });
  const camera = [m.make, m.model && m.make && m.model.startsWith(m.make) ? m.model.slice(m.make.length).trim() : m.model].filter(Boolean).join(' ');
  if (camera) out.push({ key: 'camera', icon: '📷', label: 'Camera', value: camera, why: 'Your phone or camera model.' });
  if (m.lens) out.push({ key: 'camera', icon: '🔭', label: 'Lens', value: m.lens, why: 'Which lens took it.' });
  if (m.serial) out.push({ key: 'serial', icon: '🔢', label: 'Serial number', value: m.serial, why: 'Can link every photo from the same camera back to you.' });
  const who = [m.artist, m.owner].filter((v, i, a) => v && a.indexOf(v) === i).join(', ');
  if (who) out.push({ key: 'name', icon: '👤', label: 'Name', value: who, why: 'A person’s name saved in the file.' });
  if (m.copyright) out.push({ key: 'name', icon: '©', label: 'Copyright', value: m.copyright, why: 'Often your full name.' });
  if (m.description) out.push({ key: 'caption', icon: '💬', label: 'Caption', value: m.description.slice(0, 120), why: 'Text saved inside the file.' });
  if (m.software) out.push({ key: 'software', icon: '🛠️', label: 'Software', value: m.software, why: 'The app or system version that saved it.' });
  if (m.thumbnail) out.push({ key: 'thumbnail', icon: '🖼️', label: 'Hidden preview', value: 'A small copy of the original photo', why: 'It can still show parts you cropped out.' });
  const extra: string[] = [];
  if (m.xmp) extra.push('editing history (XMP)');
  if (m.iptc) extra.push('IPTC tags');
  if (m.comment) extra.push('a comment');
  if (m.text?.length) extra.push(m.text.includes('parameters') ? 'AI prompt and settings' : `text: ${m.text.slice(0, 3).join(', ')}`);
  if (extra.length) out.push({ key: 'other', icon: '📎', label: 'Also inside', value: extra.join(', '), why: 'Extra data apps leave behind.' });
  return out;
}

function verdict(m: Meta): { cls: string; badge: string; line: string } {
  const f = findings(m);
  if (m.gps) return { cls: 'danger', badge: '📍 Shows where it was taken', line: 'This photo has the exact spot where it was taken. Anyone who downloads it can see it on a map.' };
  if (f.length) return { cls: 'warn', badge: `${f.length} kind${f.length === 1 ? '' : 's'} of hidden info`, line: 'No location, but there’s other info about you and your camera inside.' };
  return { cls: 'ok', badge: '✓ Nothing hidden', line: 'We found nothing personal in this file. It’s safe to share as it is.' };
}

function renderCard(item: Item) {
  const { meta: m } = item;
  const v = verdict(m);
  const card = item.card;
  card.className = `card ${v.cls}`;
  card.replaceChildren();

  const pic = el('div', 'pic');
  const img = el('img');
  img.src = item.url;
  img.alt = '';
  img.addEventListener('error', () => pic.classList.add('nopreview'));
  const noprev = el('span', 'noprev', item.kind === 'heic' ? 'Your browser can’t show HEIC photos' : 'No preview');
  const badge = el('span', 'badge', v.badge);
  pic.append(img, noprev, badge);
  if (item.sample) pic.append(el('span', 'sample', 'Sample photo'));

  const body = el('div', 'body');
  const head = el('div', 'head');
  const name = el('strong', 'name', item.name);
  name.title = item.name;
  head.append(name, el('span', 'size', formatBytes(item.bytes.length)));
  body.append(head, el('p', 'line', v.line));

  if (m.gps) {
    const loc = el('div', 'loc fact');
    loc.dataset.key = 'location';
    const big = el('div', 'where');
    big.append(el('span', 'pin', '📍'));
    const txt = el('div');
    txt.append(el('strong', '', coords(m.gps.lat, m.gps.lon)));
    const extra = ['Precise enough to find the building'];
    if (m.gps.alt !== undefined) extra.push(`${Math.round(m.gps.alt)} m above sea level`);
    txt.append(el('span', 'sub', extra.join(' · ')));
    big.append(txt);
    const map = el('a', 'map', 'See this spot on a map ↗');
    map.href = `https://www.google.com/maps?q=${m.gps.lat.toFixed(6)},${m.gps.lon.toFixed(6)}`;
    map.target = '_blank';
    map.rel = 'noopener noreferrer';
    loc.append(big, map);
    body.append(loc);
  }

  const fl = facts(m);
  if (fl.length) {
    const ul = el('ul', 'facts');
    for (const f of fl) {
      const li = el('li', 'fact');
      li.dataset.key = f.key;
      li.append(el('span', 'ic', f.icon));
      const t = el('div');
      const top = el('div', 'top');
      top.append(el('span', 'label', f.label), el('span', 'value', f.value));
      t.append(top, el('span', 'why', f.why));
      li.append(t);
      ul.append(li);
    }
    body.append(ul);
  }

  const after = el('div', 'after');
  after.hidden = true;
  body.append(after);
  card.append(pic, body);
}

function updateBar() {
  bar.hidden = !items.length;
  if (!items.length) return;
  const real = items.filter((i) => !i.sample);
  const cleaned = items.filter((i) => i.out);
  if (cleaned.length && cleaned.length === items.length) {
    const left = items.filter((i) => i.out && i.card.dataset.left);
    summary.textContent = left.length
      ? `Done, but ${left.length} ${left.length === 1 ? 'photo still has' : 'photos still have'} some info we couldn’t remove (see below).`
      : items.length === 1
        ? 'Done. The clean copy has no location, date or camera info. Download it below.'
        : `Done. All ${items.length} clean copies have no location, date or camera info.`;
    summary.classList.toggle('danger', left.length > 0);
    summary.classList.toggle('good', !left.length);
    cleanBtn.hidden = true;
    zipBtn.hidden = items.length < 2;
    return;
  }
  const located = items.filter((i) => i.meta.gps).length;
  const withInfo = items.filter((i) => findings(i.meta).length).length;
  const n = items.length;
  const what = !real.length ? 'This sample photo' : n === 1 ? 'This photo' : `${located} of ${n} photos`;
  summary.textContent = located
    ? `${what} ${located === 1 ? 'shows where it was' : 'show where they were'} taken.`
    : withInfo
      ? `No location found, but ${withInfo === 1 && n === 1 ? 'this photo has' : `${withInfo} of ${n} photos have`} other hidden info.`
      : `Nothing personal found in ${n === 1 ? 'this photo' : `these ${n} photos`}.`;
  summary.classList.toggle('danger', located > 0);
  summary.classList.remove('good');
  cleanBtn.hidden = false;
  cleanBtn.disabled = false;
  cleanBtn.textContent = n === 1 ? 'Remove everything' : `Remove everything from ${n} photos`;
  zipBtn.hidden = true;
}

function ext(type: string): string {
  return type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
}

function decode(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode'));
    img.src = url;
  });
}

// Formats we can't edit byte by byte get re-drawn: the new file only has the pixels.
async function redraw(item: Item): Promise<Blob> {
  const img = await decode(item.url);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext('2d')!.drawImage(img, 0, 0);
  const png = /\.(png|gif|bmp|ico)$/i.test(item.name);
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), png ? 'image/png' : 'image/jpeg', png ? undefined : 0.92),
  );
}

async function clean(item: Item, taken: Set<string>) {
  const after = item.card.querySelector<HTMLDivElement>('.after')!;
  after.hidden = false;
  after.className = 'after';
  after.textContent = 'Removing…';
  let blob: Blob;
  let how: string;
  try {
    const stripped = stripMeta(item.bytes);
    if (stripped) {
      blob = new Blob([stripped as BlobPart], { type: item.kind === 'png' ? 'image/png' : item.kind === 'webp' ? 'image/webp' : 'image/jpeg' });
      how = 'Same picture, same quality: only the hidden info was taken out.';
    } else {
      blob = await redraw(item);
      how = 'Saved as a fresh copy of the picture, so nothing from the original file came along.';
    }
  } catch {
    after.className = 'after fail';
    after.textContent =
      item.kind === 'heic'
        ? 'Your browser can’t open HEIC photos, so we can’t clean this one here. On iPhone, tap Share, then Options at the top, turn off Location, and share it again. Or open this page in Safari.'
        : 'We couldn’t open this file to clean it.';
    return;
  }
  const check = readMeta(new Uint8Array(await blob.arrayBuffer()));
  const left = findings(check);
  if (left.length) item.card.dataset.left = left.join(',');
  else delete item.card.dataset.left;

  const base = item.name.replace(/\.[^.]+$/, '') || 'photo';
  let name = `${base}-clean.${ext(blob.type)}`;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base}-clean-${i}.${ext(blob.type)}`;
  taken.add(name.toLowerCase());
  item.out = blob;
  item.outName = name;

  const hadInfo = findings(item.meta).length > 0;
  const line = item.card.querySelector('.line');
  if (line && hadInfo && !left.length)
    line.textContent = item.meta.gps
      ? 'The clean copy no longer shows where it was taken. Share that one, not the original.'
      : 'The clean copy has none of the info below. Share that one, not the original.';
  item.card.classList.remove('danger', 'warn');
  item.card.classList.add('done');
  const badge = item.card.querySelector('.badge');
  if (badge) badge.textContent = left.length ? 'Partly cleaned' : '✓ Clean';
  for (const f of item.card.querySelectorAll<HTMLElement>('.fact')) if (!left.includes(f.dataset.key ?? '')) f.classList.add('gone');

  after.replaceChildren();
  const msg = el('div', 'msg');
  msg.append(el('strong', '', left.length ? 'Some info is still inside.' : hadInfo ? '✓ Removed. Checked again: nothing left.' : '✓ Checked again: nothing personal inside.'));
  const kept = check.orientation && check.orientation !== 1 ? ' Kept only which way up the photo goes, so it isn’t shown sideways.' : '';
  msg.append(el('span', '', `${formatBytes(item.bytes.length)} → ${formatBytes(blob.size)}. ${how}${kept}`));
  const a = el('a', 'dl', 'Download clean photo');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  after.append(msg, a);
}

cleanBtn.addEventListener('click', async () => {
  cleanBtn.disabled = true;
  cleanBtn.textContent = 'Removing…';
  const taken = new Set<string>();
  for (const i of items) await clean(i, taken);
  if (!items.every((i) => i.out)) {
    // Some files couldn't be cleaned at all; still show the ones that worked.
    cleanBtn.hidden = true;
    const ok = items.filter((i) => i.out).length;
    summary.textContent = ok ? `Cleaned ${ok} of ${items.length}. See the note on the others below.` : 'We couldn’t clean these files here. See the note below.';
    zipBtn.hidden = ok < 2;
    return;
  }
  updateBar();
});

zipBtn.addEventListener('click', async () => {
  zipBtn.disabled = true;
  try {
    const entries: ZipEntry[] = [];
    for (const i of items) if (i.out) entries.push({ name: i.outName, data: new Uint8Array(await i.out.arrayBuffer()) });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([makeZip(entries) as BlobPart], { type: 'application/zip' }));
    a.download = 'clean-photos.zip';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  } finally {
    zipBtn.disabled = false;
  }
});

function reset() {
  for (const i of items) {
    URL.revokeObjectURL(i.url);
    const dl = i.card.querySelector<HTMLAnchorElement>('.dl');
    if (dl?.href) URL.revokeObjectURL(dl.href);
  }
  items = [];
  list.replaceChildren();
  updateBar();
}

clearBtn.addEventListener('click', () => {
  reset();
  error.hidden = true;
});

function addItem(name: string, bytes: Uint8Array, type: string, sample = false) {
  const kind = sniff(bytes);
  const item: Item = {
    name,
    bytes,
    kind,
    meta: readMeta(bytes),
    sample,
    url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: type || 'image/jpeg' })),
    card: el('li'),
    out: null,
    outName: '',
  };
  items.push(item);
  renderCard(item);
  list.append(item.card);
}

async function add(files: File[]) {
  error.hidden = true;
  if (items.some((i) => i.sample) || items.every((i) => i.out)) reset();
  const isImage = (f: File) => f.type.startsWith('image/') || /\.(heic|heif|avif|jpe?g|png|webp|tiff?|dng)$/i.test(f.name);
  const images = files.filter(isImage);
  const problems: string[] = [];
  const skipped = files.length - images.length;
  if (skipped) problems.push(`${skipped} ${skipped === 1 ? 'file wasn’t a photo' : 'files weren’t photos'}`);
  const room = MAX_FILES - items.length;
  if (images.length > room) problems.push(`only ${MAX_FILES} photos at a time, so ${images.length - room} were left out`);
  for (const f of images.slice(0, Math.max(0, room))) {
    if (f.size > MAX_BYTES) {
      problems.push(`${f.name} is over 60 MB`);
      continue;
    }
    try {
      addItem(f.name, new Uint8Array(await f.arrayBuffer()), f.type);
    } catch {
      problems.push(`we couldn’t read ${f.name}`);
    }
  }
  if (problems.length) {
    const msg = problems.join('; ');
    error.textContent = msg.charAt(0).toUpperCase() + msg.slice(1) + '.';
    error.hidden = false;
  }
  updateBar();
  if (items.length) bar.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// A made-up holiday photo with a phone's usual metadata, so the page shows what it does before you drop anything.
async function loadSample() {
  const c = document.createElement('canvas');
  c.width = 960;
  c.height = 640;
  const x = c.getContext('2d')!;
  const sky = x.createLinearGradient(0, 0, 0, 640);
  sky.addColorStop(0, '#FFB27A');
  sky.addColorStop(0.55, '#FF7FA8');
  sky.addColorStop(1, '#6C5CE7');
  x.fillStyle = sky;
  x.fillRect(0, 0, 960, 640);
  x.fillStyle = 'rgba(255,240,200,0.9)';
  x.beginPath();
  x.arc(700, 250, 70, 0, Math.PI * 2);
  x.fill();
  // A lattice tower silhouette
  x.fillStyle = '#2B1E4A';
  x.beginPath();
  x.moveTo(330, 560);
  x.quadraticCurveTo(420, 380, 468, 120);
  x.lineTo(492, 120);
  x.quadraticCurveTo(540, 380, 630, 560);
  x.lineTo(570, 560);
  x.quadraticCurveTo(480, 470, 390, 560);
  x.closePath();
  x.fill();
  x.fillRect(476, 70, 8, 60);
  x.fillRect(405, 395, 150, 14);
  x.fillRect(445, 260, 70, 10);
  x.fillStyle = '#1D1436';
  x.fillRect(0, 548, 960, 92);
  const jpeg = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.85));
  if (!jpeg || items.length) return;
  const tiff = writeTiff(
    [
      { tag: 0x010f, type: 2, value: 'Apple' },
      { tag: 0x0110, type: 2, value: 'iPhone 15 Pro' },
      { tag: 0x0131, type: 2, value: '17.4.1' },
      { tag: 0x0132, type: 2, value: '2025:06:14 21:07:33' },
    ],
    [
      { tag: 0x9003, type: 2, value: '2025:06:14 21:07:33' },
      { tag: 0xa434, type: 2, value: 'iPhone 15 Pro back triple camera 6.765mm f/1.78' },
    ],
    [
      { tag: 1, type: 2, value: 'N' },
      { tag: 2, type: 5, value: toDms(48.85837) },
      { tag: 3, type: 2, value: 'E' },
      { tag: 4, type: 5, value: toDms(2.294481) },
      { tag: 6, type: 5, value: [3520, 100] },
    ],
  );
  addItem('IMG_4021.jpg', addJpegExif(new Uint8Array(await jpeg.arrayBuffer()), tiff), 'image/jpeg', true);
  updateBar();
}

fileInput.addEventListener('change', () => {
  if (fileInput.files?.length) add([...fileInput.files]);
  fileInput.value = '';
});
drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('over');
});
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const files = [...(e.dataTransfer?.files ?? [])];
  if (files.length) add(files);
});
document.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files ?? [])];
  if (files.length) add(files);
});

loadSample();
