// Social post previewer: everything runs in the visitor's browser. Nothing is uploaded.
import {
  LI_LIMIT,
  X_LIMIT,
  X_LONG_LIMIT,
  cropShare,
  firstLine,
  forLinkedIn,
  fromBold,
  graphemes,
  liLayout,
  liLength,
  pieces,
  plain,
  splitThread,
  xCut,
  xLayout,
  xLength,
  xLinkText,
  type Layout,
} from './social-post-previewer-core';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const textIn = $<HTMLTextAreaElement>('sp-text');
const hookEl = $<HTMLParagraphElement>('sp-hook');
const verdictsEl = $<HTMLUListElement>('sp-verdicts');
const countsEl = $<HTMLParagraphElement>('sp-counts');
const fileIn = $<HTMLInputElement>('sp-file');
const thumbsEl = $<HTMLDivElement>('sp-thumbs');
const editor = $<HTMLDivElement>('sp-editor');
const work = editor.parentElement as HTMLDivElement;
const numbersIn = $<HTMLInputElement>('sp-numbers');
const numbersWrap = $<HTMLLabelElement>('sp-numbers-wrap');
const starsIn = $<HTMLInputElement>('sp-stars');
const boldHookIn = $<HTMLInputElement>('sp-boldhook');
const copyLi = $<HTMLButtonElement>('sp-copy-li');
const copyX = $<HTMLButtonElement>('sp-copy-x');
const status = $<HTMLSpanElement>('sp-status');
const exampleBtn = $<HTMLButtonElement>('sp-example');
const liMock = $<HTMLDivElement>('sp-li');
const xMock = $<HTMLDivElement>('sp-x');
const liPane = $<HTMLDivElement>('sp-li-pane');
const xPane = $<HTMLDivElement>('sp-x-pane');
const liCrops = $<HTMLUListElement>('sp-li-crops');
const xCrops = $<HTMLUListElement>('sp-x-crops');
const threadFold = $<HTMLDetailsElement>('sp-thread-fold');
const threadEl = $<HTMLOListElement>('sp-thread');
const threadCount = $<HTMLSpanElement>('sp-thread-count');
const nameIn = $<HTMLInputElement>('sp-name');
const handleIn = $<HTMLInputElement>('sp-handle');
const headlineIn = $<HTMLInputElement>('sp-headline');
const avatarIn = $<HTMLInputElement>('sp-avatar');
const avatarPreview = $<HTMLSpanElement>('sp-avatar-preview');

const STORE_KEY = 'darnly-post-preview';
const MAX_PICS = 4;

const EXAMPLE = `I almost quit building my side project last night.

Not because of the code. Because every bug report I wrote to my AI agent started with "the thing on the left is broken".

So I built a button that does it for me: click the bug, and the agent gets a picture, the element and the console errors.

Day 2 of building in public:
→ **The Chrome extension is live**
→ Looking for 5 testers
→ Still 0 paying users

What should I build next? 👇

darnly.dev`;

// Phone and desktop sizes of each app's feed, in CSS pixels.
const WIDTH = {
  li: { phone: 390, desktop: 555 },
  x: { phone: 390, desktop: 598 },
} as const;

type Net = 'li' | 'x';
type Device = 'phone' | 'desktop';
type Pic = { url: string; aspect: number; sample?: boolean };

const state = {
  net: 'li' as Net,
  device: 'phone' as Device,
  dark: false,
  xMode: 'thread' as 'thread' | 'long',
  pics: [] as Pic[],
  avatar: '',
  liOpen: false,
  xOpen: false,
  copyIndex: 0,
};

// ---------- Small helpers ----------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svg(path: string): SVGSVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  for (const d of path.split('|')) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    s.appendChild(p);
  }
  return s;
}

const ICONS = {
  reply: 'M4 5h16v11H10l-5 4v-4H4z',
  repost: 'M7 17V8h11|M15 5l3 3-3 3|M17 7v9H6|M9 19l-3-3 3-3',
  like: 'M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z',
  views: 'M5 20v-7|M10 20V5|M15 20v-10|M20 20v-4',
  bookmark: 'M6.5 4h11v16L12 16l-5.5 4z',
  share: 'M12 15V4|M7.5 8.5 12 4l4.5 4.5|M5 13v7h14v-7',
  thumb: 'M7 11v9H4v-9z|M7 11l3.8-6.5c1.4 0 2.4 1.1 2 2.6L12 10h6.3a2 2 0 0 1 2 2.4l-1.3 6A2 2 0 0 1 17 20H7',
  comment: 'M4 5h16v11H9l-5 4z',
  send: 'M21 3 3 10.5l7 2.5 2.5 7z|M10 13l11-10',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z|M3 12h18|M12 3c2.5 2.6 3.6 5.6 3.6 9s-1.1 6.4-3.6 9c-2.5-2.6-3.6-5.6-3.6-9S9.5 5.6 12 3z',
};

let sayTimer = 0;
function say(msg: string) {
  status.textContent = msg;
  window.clearTimeout(sayTimer);
  sayTimer = window.setTimeout(() => (status.textContent = ''), 4000);
}

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    say(done);
  } catch {
    say('Your browser blocked copying. Select the text in the box and copy it yourself.');
  }
}

const fmt = (n: number) => n.toLocaleString('en-US');

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return graphemes(parts[0])[0].toUpperCase() + (parts.length > 1 ? graphemes(parts[parts.length - 1])[0].toUpperCase() : '');
}

function avatar(size: string): HTMLSpanElement {
  const a = el('span', `av ${size}`);
  if (state.avatar) a.style.backgroundImage = `url("${state.avatar}")`;
  else {
    a.style.background = '#0593C6';
    a.textContent = initials(nameIn.value || 'You');
  }
  a.setAttribute('aria-hidden', 'true');
  return a;
}

// Rich text: links, @mentions and #hashtags in the app's link color.
function richText(target: HTMLElement, text: string, net: Net) {
  for (const p of pieces(text)) {
    if (p.kind === 'text') {
      target.appendChild(document.createTextNode(p.text));
      continue;
    }
    const span = el('span', p.kind, p.kind === 'link' && net === 'x' ? xLinkText(p.text) : p.text);
    target.appendChild(span);
  }
}

// ---------- Pictures ----------

function media(layout: Layout | null, width: number): { node: HTMLDivElement; cellAspects: number[] } | null {
  if (!layout || !state.pics.length) return null;
  const box = el('div', 'media');
  box.style.aspectRatio = String(layout.aspect);
  const cellAspects: number[] = [];
  layout.cells.forEach((c, i) => {
    const pic = state.pics[i];
    if (!pic) return;
    const cell = el('div', 'cell');
    const gap = 1; // the thin line between pictures
    cell.style.left = `calc(${c.x * 100}% + ${c.x > 0 ? gap : 0}px)`;
    cell.style.top = `calc(${c.y * 100}% + ${c.y > 0 ? gap : 0}px)`;
    cell.style.width = `calc(${c.w * 100}% - ${c.x > 0 || c.x + c.w < 1 ? gap : 0}px)`;
    cell.style.height = `calc(${c.h * 100}% - ${c.y > 0 || c.y + c.h < 1 ? gap : 0}px)`;
    const img = el('img');
    img.src = pic.url;
    img.alt = `Picture ${i + 1}`;
    cell.appendChild(img);
    box.appendChild(cell);
    cellAspects.push((c.w * width) / ((c.h * width) / layout.aspect));
  });
  return { node: box, cellAspects };
}

function cropNotes(target: HTMLUListElement, app: string, cellAspects: number[]) {
  target.replaceChildren();
  if (!state.pics.length) return;
  let anyCut = false;
  cellAspects.forEach((cellAspect, i) => {
    const pic = state.pics[i];
    const share = cropShare(pic.aspect, cellAspect);
    if (share < 0.03) return;
    anyCut = true;
    const li = el('li');
    const where = pic.aspect > cellAspect ? 'left and right' : 'top and bottom';
    const b = el('b', '', `${app} hides ${Math.round(share * 100)}%`);
    li.append(`Picture ${i + 1}: `, b, ` of it, from the ${where}.`);
    target.appendChild(li);
  });
  if (!anyCut) {
    const li = el('li');
    li.append(state.pics.length === 1 ? 'Your picture shows in full.' : 'Your pictures show in full.');
    target.appendChild(li);
  }
  if (state.pics.length > MAX_PICS) target.appendChild(el('li', '', `Only the first ${MAX_PICS} pictures are shown.`));
}

// ---------- LinkedIn ----------

const liMeasure = {
  phone: makeMeasurer('phone'),
  desktop: makeMeasurer('desktop'),
};

function makeMeasurer(device: Device): HTMLDivElement {
  // A copy of the preview's own box, off screen, at the app's real width.
  const box = liMock.cloneNode(false) as HTMLDivElement;
  box.removeAttribute('id');
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText = `position:absolute;left:-10000px;top:0;visibility:hidden;width:${WIDTH.li[device]}px;transform:none`;
  const text = el('div', 'text');
  box.appendChild(text);
  document.body.appendChild(box);
  return box;
}

// How LinkedIn cuts a post: 3 lines, then "…see more" on the third. Returns how much of the text shows.
function liCut(text: string, device: Device): { shown: string; cut: boolean } {
  const box = liMeasure[device];
  box.classList.toggle('dark', state.dark);
  const t = box.firstElementChild as HTMLDivElement;
  const lines = 3;
  const lh = 20;
  const fits = (s: string, tail: boolean) => {
    t.replaceChildren();
    richText(t, s, 'li');
    if (tail) t.appendChild(el('span', 'more', '…see more'));
    // Padding is 8px on top; the text box itself must stay within 3 lines.
    return t.clientHeight - 8 <= lines * lh + 2;
  };
  const trimmed = text.replace(/\s+$/, '');
  if (fits(trimmed, false)) return { shown: trimmed, cut: false };
  const gs = graphemes(trimmed);
  let lo = 0;
  let hi = gs.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (fits(gs.slice(0, mid).join('').replace(/\s+$/, ''), true)) lo = mid;
    else hi = mid - 1;
  }
  let shown = gs.slice(0, lo).join('');
  // LinkedIn ends the cut on a whole word.
  const space = shown.search(/\s\S*$/);
  if (space > shown.length - 25 && space > 0 && lo < gs.length && !/\s/.test(gs[lo])) shown = shown.slice(0, space);
  return { shown: shown.replace(/\s+$/, ''), cut: true };
}

function renderLinkedIn(text: string): { cut: boolean; shownChars: number } {
  const w = WIDTH.li[state.device];
  liMock.style.width = `${w}px`;
  liMock.classList.toggle('dark', state.dark);
  liMock.replaceChildren();

  const head = el('div', 'li-head');
  const who = el('div', 'li-who');
  who.append(el('b', '', nameIn.value.trim() || 'Your Name'));
  who.append(el('span', 'hl', headlineIn.value.trim() || 'Building something people want'));
  const when = el('span', 'when', '2m • ');
  when.appendChild(svg(ICONS.globe));
  who.append(when);
  head.append(avatar('lg'), who);
  liMock.appendChild(head);

  const cut = liCut(text, state.device);
  const body = el('div', 'text');
  if (cut.cut && !state.liOpen) {
    richText(body, cut.shown, 'li');
    const more = el('button', 'more', '…see more');
    more.type = 'button';
    more.addEventListener('click', () => {
      state.liOpen = true;
      render();
    });
    body.appendChild(more);
  } else {
    richText(body, text, 'li');
  }
  if (text.trim()) liMock.appendChild(body);

  const m = media(state.pics.length ? liLayout(state.pics.map((p) => p.aspect)) : null, w);
  if (m) liMock.appendChild(m.node);
  cropNotes(liCrops, 'LinkedIn', m?.cellAspects ?? []);

  const social = el('div', 'li-social');
  const rx = el('span', 'rx');
  const like = el('i', '', '👍');
  like.style.background = '#378fe9';
  const love = el('i', '', '❤');
  love.style.background = '#df704d';
  rx.append(like, love, ' 48');
  social.append(rx, el('span', '', '6 comments • 2 reposts'));
  liMock.appendChild(social);

  const acts = el('div', 'acts');
  for (const [icon, label] of [
    [ICONS.thumb, 'Like'],
    [ICONS.comment, 'Comment'],
    [ICONS.repost, 'Repost'],
    [ICONS.send, 'Send'],
  ]) {
    const s = el('span');
    s.append(svg(icon), label);
    acts.appendChild(s);
  }
  liMock.appendChild(acts);
  return { cut: cut.cut, shownChars: liLength(cut.shown) };
}

// ---------- X ----------

function xPost(text: string, opts: { first: boolean; last: boolean; showMore?: boolean }): HTMLElement {
  const post = el('article', 'xp');
  const side = el('div', 'xp-side');
  side.appendChild(avatar('md'));
  if (!opts.last) side.appendChild(el('div', 'xp-line'));
  const main = el('div', 'xp-main');
  const head = el('div', 'xp-head');
  const handle = handleIn.value.trim().replace(/^@?/, '@') || '@yourhandle';
  head.append(el('b', '', nameIn.value.trim() || 'Your Name'), el('span', '', `${handle === '@' ? '@yourhandle' : handle} · ${opts.first ? '2m' : '1m'}`));
  main.appendChild(head);
  if (text) {
    const body = el('div', 'text');
    richText(body, text, 'x');
    if (opts.showMore) {
      body.append('… ');
      const more = el('button', 'more', 'Show more');
      more.type = 'button';
      more.addEventListener('click', () => {
        state.xOpen = true;
        render();
      });
      body.appendChild(more);
    }
    main.appendChild(body);
  }
  if (opts.first) {
    const m = media(state.pics.length ? xLayout(state.pics.map((p) => p.aspect)) : null, WIDTH.x[state.device] - 72);
    if (m) main.appendChild(m.node);
    cropNotes(xCrops, 'X', m?.cellAspects ?? []);
  }
  const acts = el('div', 'acts');
  const counts = opts.first ? ['12', '8', '96', '4.1K', '', ''] : ['2', '1', '18', '1.2K', '', ''];
  [ICONS.reply, ICONS.repost, ICONS.like, ICONS.views, ICONS.bookmark, ICONS.share].forEach((icon, i) => {
    const s = el('span');
    s.append(svg(icon), counts[i]);
    acts.appendChild(s);
  });
  main.appendChild(acts);
  post.append(side, main);
  return post;
}

function renderX(text: string): string[] {
  xMock.style.width = `${WIDTH.x[state.device]}px`;
  xMock.classList.toggle('dark', state.dark);
  xMock.replaceChildren();
  let posts: string[];
  if (state.xMode === 'long') {
    posts = text.trim() ? [text.trim()] : [];
    const cut = xCut(text.trim());
    xMock.appendChild(
      xPost(cut.cut && !state.xOpen ? cut.shown : text.trim(), { first: true, last: true, showMore: cut.cut && !state.xOpen }),
    );
  } else {
    posts = splitThread(text, { numbers: numbersIn.checked });
    if (!posts.length) xMock.appendChild(xPost('', { first: true, last: true }));
    posts.forEach((p, i) => xMock.appendChild(xPost(p, { first: i === 0, last: i === posts.length - 1 })));
  }
  xMock.appendChild(el('div', 'x-foot'));
  return posts;
}

// ---------- Fitting the previews to the screen ----------

// Each preview keeps the app's real width and is scaled down to fit, so lines break where they would in the app.
function fit() {
  for (const mock of [liMock, xMock]) {
    const holder = mock.parentElement as HTMLDivElement;
    if (holder.offsetParent === null) continue;
    mock.style.transform = '';
    holder.style.height = '';
    const avail = holder.clientWidth;
    const w = mock.offsetWidth;
    if (w > avail && avail > 0) {
      const s = avail / w;
      mock.style.transform = `scale(${s})`;
      holder.style.height = `${mock.offsetHeight * s}px`;
      holder.style.justifyContent = 'flex-start';
    } else {
      holder.style.justifyContent = 'center';
    }
  }
}

// ---------- The whole page ----------

let lastText = '';
let xPosts: string[] = [];

function verdict(kind: 'ok' | 'warn' | 'bad', parts: (string | HTMLElement)[]) {
  const li = el('li', kind);
  li.appendChild(el('span', 'dot'));
  const span = el('span');
  span.append(...parts);
  li.appendChild(span);
  verdictsEl.appendChild(li);
}

function render() {
  const raw = textIn.value;
  if (raw !== lastText) {
    state.liOpen = false;
    state.xOpen = false;
    state.copyIndex = 0;
    lastText = raw;
  }
  const xText = plain(fromBold(raw));
  const liText = forLinkedIn(raw, { stars: starsIn.checked, boldHook: boldHookIn.checked });

  // Hook
  const hook = firstLine(plain(fromBold(raw)));
  hookEl.textContent = hook || 'Start writing and your first line shows here.';
  hookEl.classList.toggle('none', !hook);

  liPane.hidden = state.net !== 'li';
  xPane.hidden = state.net !== 'x';
  const li = renderLinkedIn(liText);
  xPosts = renderX(xText);

  // Verdicts
  verdictsEl.replaceChildren();
  const liLen = liLength(liText);
  const xLen = xLength(xText);
  if (raw.trim()) {
    const phone = liCut(liText, 'phone');
    const desk = liCut(liText, 'desktop');
    const hookShown = (c: { shown: string; cut: boolean }) => !c.cut || plain(fromBold(c.shown)).replace(/^\s+/, '').startsWith(hook);
    if (!hook) {
      // nothing to judge
    } else if (hookShown(phone) && hookShown(desk)) {
      verdict('ok', ['Your hook shows in full before ', el('b', '', '…see more'), ' on LinkedIn']);
    } else if (hookShown(desk)) {
      verdict('warn', ['Your first line gets cut on phones. Shorter hooks land better']);
    } else {
      verdict('bad', ['Your first line gets cut before ', el('b', '', '…see more'), '. Make it shorter']);
    }
    if (liLen > LI_LIMIT) verdict('bad', ['Too long for LinkedIn: ', el('b', '', `${fmt(liLen)} / ${fmt(LI_LIMIT)}`)]);
    else if (!phone.cut && !desk.cut) verdict('ok', ['LinkedIn shows the whole post, no ', el('b', '', '…see more')]);
    else
      verdict('warn', [
        'LinkedIn shows ',
        el('b', '', `${fmt(liLength(phone.shown))} characters`),
        ` on phones and `,
        el('b', '', fmt(liLength(desk.shown))),
        ' on computers, then ',
        el('b', '', '…see more'),
      ]);
    if (xLen <= X_LIMIT) verdict('ok', ['Fits in one X post: ', el('b', '', `${fmt(xLen)} / ${X_LIMIT}`)]);
    else if (state.xMode === 'thread') verdict('warn', ['On X it’s a thread of ', el('b', '', `${xPosts.length} posts`)]);
    else if (xLen > X_LONG_LIMIT) verdict('bad', ['Too long even for a long X post: ', el('b', '', `${fmt(xLen)} / ${fmt(X_LONG_LIMIT)}`)]);
    else verdict('warn', ['One long X post: people see 280, then ', el('b', '', 'Show more'), '. Needs X Premium']);
  }

  // Counts
  countsEl.replaceChildren();
  const xOver = state.xMode === 'thread' ? false : xLen > X_LONG_LIMIT || xLen > X_LIMIT;
  const xc = el(
    'span',
    xOver ? 'over' : '',
    state.xMode === 'thread' && xPosts.length > 1 ? `X ${fmt(xLen)} = ${xPosts.length} posts` : `X ${fmt(xLen)}/${X_LIMIT}`,
  );
  const lc = el('span', liLen > LI_LIMIT ? 'over' : '', `LinkedIn ${fmt(liLen)}/${fmt(LI_LIMIT)}`);
  countsEl.append(xc, ' · ', lc);
  if (li.cut) countsEl.append(` · ${fmt(li.shownChars)} before “see more”`);

  // Thread list
  const isThread = state.xMode === 'thread' && xPosts.length > 1;
  threadFold.hidden = !isThread;
  numbersWrap.hidden = state.xMode !== 'thread';
  threadEl.replaceChildren();
  threadCount.textContent = isThread ? `(${xPosts.length})` : '';
  xPosts.forEach((p, i) => {
    const item = el('li');
    item.appendChild(el('p', '', p));
    const row = el('div', 'row');
    const b = el('button', '', `Copy post ${i + 1}`);
    b.type = 'button';
    b.addEventListener('click', () => copy(p, `Copied post ${i + 1} of ${xPosts.length}.`));
    row.append(b, `${xLength(p)}/${X_LIMIT}`);
    item.appendChild(row);
    threadEl.appendChild(item);
  });
  copyX.textContent = isThread ? `Copy X post ${Math.min(state.copyIndex, xPosts.length - 1) + 1} of ${xPosts.length}` : 'Copy for X';

  fit();
  save();
}

let queued = 0;
function schedule() {
  if (queued) return;
  queued = requestAnimationFrame(() => {
    queued = 0;
    render();
  });
}

// ---------- Saving the draft in this browser ----------

function save() {
  try {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ text: textIn.value, name: nameIn.value, handle: handleIn.value, headline: headlineIn.value }),
    );
  } catch {
    /* private mode: fine */
  }
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (s && typeof s === 'object') {
      textIn.value = typeof s.text === 'string' && s.text.trim() ? s.text : EXAMPLE;
      nameIn.value = typeof s.name === 'string' ? s.name : '';
      handleIn.value = typeof s.handle === 'string' ? s.handle : '';
      headlineIn.value = typeof s.headline === 'string' ? s.headline : '';
      return;
    }
  } catch {
    /* ignore */
  }
  textIn.value = EXAMPLE;
}

// ---------- Pictures in ----------

function addFiles(files: Iterable<File>) {
  let added = 0;
  // The sample picture makes way for the visitor's own.
  for (const p of state.pics.filter((q) => q.sample)) URL.revokeObjectURL(p.url);
  state.pics = state.pics.filter((q) => !q.sample);
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    if (state.pics.length >= MAX_PICS) {
      say(`Up to ${MAX_PICS} pictures, like on X.`);
      break;
    }
    const url = URL.createObjectURL(f);
    const pic: Pic = { url, aspect: 1 };
    state.pics.push(pic);
    added++;
    const img = new Image();
    img.onload = () => {
      pic.aspect = img.naturalWidth / img.naturalHeight || 1;
      drawThumbs();
      schedule();
    };
    img.onerror = () => {
      state.pics = state.pics.filter((p) => p !== pic);
      URL.revokeObjectURL(url);
      say('That picture couldn’t be opened. Try a PNG, JPG or WebP.');
      drawThumbs();
      schedule();
    };
    img.src = url;
  }
  if (added) drawThumbs();
}

function drawThumbs() {
  thumbsEl.replaceChildren();
  state.pics.forEach((p, i) => {
    const t = el('div', 'th');
    const img = el('img');
    img.src = p.url;
    img.alt = `Picture ${i + 1}`;
    const x = el('button', '', '×');
    x.type = 'button';
    x.setAttribute('aria-label', `Remove picture ${i + 1}`);
    x.addEventListener('click', () => {
      URL.revokeObjectURL(p.url);
      state.pics.splice(i, 1);
      drawThumbs();
      schedule();
    });
    t.append(img, x);
    if (p.sample) t.appendChild(el('span', 'tag', 'SAMPLE'));
    thumbsEl.appendChild(t);
  });
}

fileIn.addEventListener('change', () => {
  if (fileIn.files) addFiles(fileIn.files);
  fileIn.value = '';
});
const pics = editor.querySelector('.pics') as HTMLDivElement;
work.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types.includes('Files')) {
    e.preventDefault();
    pics.classList.add('over');
  }
});
work.addEventListener('dragleave', (e) => {
  if (!work.contains(e.relatedTarget as Node)) pics.classList.remove('over');
});
work.addEventListener('drop', (e) => {
  if (!e.dataTransfer?.files.length) return;
  e.preventDefault();
  pics.classList.remove('over');
  addFiles(e.dataTransfer.files);
});
document.addEventListener('paste', (e) => {
  const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;
  e.preventDefault();
  addFiles(files);
});

avatarIn.addEventListener('change', () => {
  const f = avatarIn.files?.[0];
  if (!f || !f.type.startsWith('image/')) return;
  if (state.avatar) URL.revokeObjectURL(state.avatar);
  state.avatar = URL.createObjectURL(f);
  drawAvatarPick();
  schedule();
});

function drawAvatarPick() {
  if (state.avatar) {
    avatarPreview.style.backgroundImage = `url("${state.avatar}")`;
    avatarPreview.textContent = '';
  } else {
    avatarPreview.style.background = '#0593C6';
    avatarPreview.textContent = initials(nameIn.value || 'You');
  }
}

// ---------- Controls ----------

function pick(attr: string, value: string) {
  document.querySelectorAll<HTMLButtonElement>(`[${attr}]`).forEach((b) => b.setAttribute('aria-checked', String(b.getAttribute(attr) === value)));
}

document.querySelectorAll<HTMLButtonElement>('[data-xmode]').forEach((b) =>
  b.addEventListener('click', () => {
    state.xMode = b.dataset.xmode as 'thread' | 'long';
    pick('data-xmode', state.xMode);
    state.copyIndex = 0;
    schedule();
  }),
);
document.querySelectorAll<HTMLButtonElement>('[data-device]').forEach((b) =>
  b.addEventListener('click', () => {
    state.device = b.dataset.device as Device;
    pick('data-device', state.device);
    schedule();
  }),
);
document.querySelectorAll<HTMLButtonElement>('[data-theme-pick]').forEach((b) =>
  b.addEventListener('click', () => {
    state.dark = b.dataset.themePick === 'dark';
    pick('data-theme-pick', b.dataset.themePick!);
    schedule();
  }),
);
const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-net]'));
tabs.forEach((b) => {
  b.addEventListener('click', () => {
    state.net = b.dataset.net as Net;
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t === b)));
    schedule();
  });
  b.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = tabs[(tabs.indexOf(b) + 1) % tabs.length];
    next.focus();
    next.click();
  });
});

for (const input of [textIn, nameIn, handleIn, headlineIn]) input.addEventListener('input', schedule);
nameIn.addEventListener('input', drawAvatarPick);
for (const input of [numbersIn, starsIn, boldHookIn]) input.addEventListener('change', schedule);

copyLi.addEventListener('click', () => {
  const t = forLinkedIn(textIn.value, { stars: starsIn.checked, boldHook: boldHookIn.checked }).trim();
  if (!t) return say('Write something first.');
  copy(t, 'Copied for LinkedIn. Paste it into a new post.');
});

copyX.addEventListener('click', async () => {
  if (!xPosts.length) return say('Write something first.');
  if (state.xMode === 'thread' && xPosts.length > 1) {
    const i = Math.min(state.copyIndex, xPosts.length - 1);
    await copy(xPosts[i], i + 1 < xPosts.length ? `Copied post ${i + 1} of ${xPosts.length}. Post it, then click again for the next one.` : `Copied the last post (${i + 1} of ${xPosts.length}).`);
    state.copyIndex = i + 1 < xPosts.length ? i + 1 : 0;
    copyX.textContent = `Copy X post ${state.copyIndex + 1} of ${xPosts.length}`;
    return;
  }
  copy(xPosts[0], 'Copied for X.');
});

exampleBtn.addEventListener('click', () => {
  textIn.value = EXAMPLE;
  schedule();
  textIn.focus();
});

// Refit only when the width changes; fitting sets heights, which would otherwise loop.
let lastWidth = 0;
new ResizeObserver((entries) => {
  const w = Math.round(entries[0].contentRect.width);
  if (w === lastWidth) return;
  lastWidth = w;
  requestAnimationFrame(fit);
}).observe(liPane.parentElement as HTMLElement);

// A sample phone screenshot (9:16), so the page shows picture crops before anyone adds one.
function samplePicture() {
  const c = document.createElement('canvas');
  c.width = 720;
  c.height = 1280;
  const g = c.getContext('2d');
  if (!g) return;
  const grad = g.createLinearGradient(0, 0, 720, 1280);
  grad.addColorStop(0, '#0593C6');
  grad.addColorStop(1, '#1565B8');
  g.fillStyle = grad;
  g.fillRect(0, 0, 720, 1280);
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.beginPath();
  g.roundRect(60, 180, 600, 920, 36);
  g.fill();
  g.fillStyle = '#0B2230';
  g.font = '700 54px system-ui, sans-serif';
  g.fillText('Day 2', 110, 290);
  g.font = '500 34px system-ui, sans-serif';
  g.fillStyle = '#4A6472';
  g.fillText('building in public', 110, 345);
  const rows: [string, string][] = [['#1E8A5A', 'Extension live'], ['#C27A00', '5 testers wanted'], ['#D83995', '0 paying users']];
  rows.forEach(([color, label], i) => {
    const y = 470 + i * 150;
    g.fillStyle = color;
    g.beginPath();
    g.arc(140, y - 12, 22, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#0B2230';
    g.font = '600 38px system-ui, sans-serif';
    g.fillText(label, 190, y);
  });
  g.fillStyle = '#ffffff';
  g.font = '700 40px system-ui, sans-serif';
  g.fillText('darnly.dev', 60, 1200);
  c.toBlob((blob) => {
    if (!blob || state.pics.length) return;
    state.pics.push({ url: URL.createObjectURL(blob), aspect: 720 / 1280, sample: true });
    drawThumbs();
    schedule();
  }, 'image/png');
}

load();
drawAvatarPick();
render();
samplePicture();
// Fonts can change line breaks once they load.
document.fonts?.ready.then(() => render());
