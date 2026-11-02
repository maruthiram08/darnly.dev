// Image to text: reads the text in a screenshot with tesseract.js, in the visitor's browser.
// Nothing is uploaded. The reader (worker, wasm core, English data) is served from /ocr/ and
// only downloaded the first time someone reads their own picture.
import type { Worker as OcrWorker } from 'tesseract.js';
import { EXAMPLE, type Line } from './image-to-text-example';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const fileInput = $<HTMLInputElement>('itt-file');
const drop = $<HTMLLabelElement>('itt-drop');
const dropText = $<HTMLSpanElement>('itt-drop-text');
const error = $<HTMLParagraphElement>('itt-error');
const img = $<HTMLImageElement>('itt-img');
const boxes = document.getElementById('itt-boxes') as unknown as SVGSVGElement;
const busy = $<HTMLDivElement>('itt-busy');
const busyTitle = $<HTMLElement>('itt-busy-title');
const busyNote = $<HTMLElement>('itt-busy-note');
const bar = $<HTMLSpanElement>('itt-bar');
const verdict = $<HTMLDivElement>('itt-verdict');
const caption = $<HTMLElement>('itt-caption');
const text = $<HTMLTextAreaElement>('itt-text');
const copyBtn = $<HTMLButtonElement>('itt-copy');
const promptBtn = $<HTMLButtonElement>('itt-prompt');
const promptText = $<HTMLPreElement>('itt-prompt-text');
const linesBody = $<HTMLTableSectionElement>('itt-lines');

// Under this, a line gets an amber box and a "check this" note.
const UNSURE = 75;
const SVG = 'http://www.w3.org/2000/svg';
const MAX_SIDE = 4000;

type Placed = Line & { start: number; end: number };
let placed: Placed[] = [];
let edited = false;
let objectUrl = '';
let run = 0;

// ---------- Showing a result ----------

function show(lines: Line[], width: number, height: number) {
  // The text is built from the lines, so each box knows where its line sits in the text box.
  placed = [];
  let out = '';
  let prevPara = -1;
  for (const l of lines) {
    if (out && l.para !== prevPara) out += '\n';
    prevPara = l.para;
    const start = out.length;
    out += l.text;
    placed.push({ ...l, start, end: out.length });
    out += '\n';
  }
  text.value = out.trimEnd();
  edited = false;

  boxes.setAttribute('viewBox', `0 0 ${width} ${height}`);
  boxes.replaceChildren();
  placed.forEach((l, i) => {
    const r = document.createElementNS(SVG, 'rect');
    const pad = Math.max(2, Math.round((l.y1 - l.y0) * 0.12));
    r.setAttribute('x', String(l.x0 - pad));
    r.setAttribute('y', String(l.y0 - pad));
    r.setAttribute('width', String(l.x1 - l.x0 + pad * 2));
    r.setAttribute('height', String(l.y1 - l.y0 + pad * 2));
    r.setAttribute('rx', String(pad));
    r.dataset.i = String(i);
    if (l.conf < UNSURE) r.classList.add('unsure');
    const t = document.createElementNS(SVG, 'title');
    t.textContent = `${l.text} (${Math.round(l.conf)}% sure)`;
    r.append(t);
    boxes.append(r);
  });

  linesBody.replaceChildren(
    ...placed.map((l, i) => {
      const tr = document.createElement('tr');
      if (l.conf < UNSURE) tr.className = 'unsure';
      for (const v of [String(i + 1), l.text, `${Math.round(l.conf)}%`]) {
        const td = document.createElement('td');
        td.textContent = v;
        tr.append(td);
      }
      return tr;
    }),
  );

  const unsure = placed.filter((l) => l.conf < UNSURE).length;
  verdict.replaceChildren();
  const head = document.createElement('span');
  const pill = document.createElement('span');
  if (!placed.length) {
    head.textContent = 'No text found';
    pill.className = 'pill bad';
    pill.textContent = 'Try a sharper or tighter crop';
  } else {
    head.textContent = `${placed.length} ${placed.length === 1 ? 'line' : 'lines'} found`;
    pill.className = unsure ? 'pill warn' : 'pill';
    pill.textContent = unsure ? `${unsure} to double-check (amber)` : 'All read clearly';
  }
  verdict.append(head, pill);
  updatePrompt();
  setButtons(true);
}

function select(i: number, scroll = true) {
  boxes.querySelectorAll('rect.on').forEach((r) => r.classList.remove('on'));
  const l = placed[i];
  if (!l) return;
  boxes.querySelector(`rect[data-i="${i}"]`)?.classList.add('on');
  if (edited) return;
  text.focus({ preventScroll: true });
  text.setSelectionRange(l.start, l.end);
  if (scroll) {
    // Bring the selected line into view inside the text box.
    const lineNo = text.value.slice(0, l.start).split('\n').length - 1;
    const lh = parseFloat(getComputedStyle(text).lineHeight) || 20;
    text.scrollTop = Math.max(0, lineNo * lh - text.clientHeight / 3);
  }
}

boxes.addEventListener('click', (e) => {
  const r = (e.target as Element).closest('rect');
  if (r) select(Number((r as SVGRectElement).dataset.i));
});

// Selecting text in the box lights up its line on the picture.
function syncFromCaret() {
  if (edited) return;
  const pos = text.selectionStart;
  const i = placed.findIndex((l) => pos >= l.start && pos <= l.end);
  boxes.querySelectorAll('rect.on').forEach((r) => r.classList.remove('on'));
  if (i >= 0) boxes.querySelector(`rect[data-i="${i}"]`)?.classList.add('on');
}
text.addEventListener('click', syncFromCaret);
text.addEventListener('keyup', syncFromCaret);
text.addEventListener('input', () => {
  edited = true;
  boxes.querySelectorAll('rect.on').forEach((r) => r.classList.remove('on'));
  updatePrompt();
});

// ---------- Copy ----------

const ERRORISH = /\b(error|exception|failed|failure|cannot|can't|couldn't|undefined|null|traceback|panic|fatal|denied|refused|not found|invalid|unexpected|warning|timed? ?out|ENOENT|EACCES|ECONNREFUSED|[45]\d\d)\b/i;

function prompt(): string {
  const body = text.value.trim();
  if (!body) return '';
  const fence = body.includes('```') ? '~~~' : '```';
  const block = `${fence}\n${body}\n${fence}`;
  return ERRORISH.test(body)
    ? `I'm seeing this error:\n\n${block}\n\nFind what causes it in the code and fix it. If you need more context, tell me what to check.`
    : `Here's the text from a screenshot of my app:\n\n${block}\n\n`;
}

function updatePrompt() {
  promptText.textContent = prompt() || 'Nothing to copy yet.';
}

async function copy(btn: HTMLButtonElement, value: string, label: string) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    btn.textContent = 'Copied ✓';
  } catch {
    // Older browsers, or no permission: select the text so Ctrl+C works.
    text.focus();
    text.select();
    btn.textContent = 'Press Ctrl+C to copy';
  }
  setTimeout(() => (btn.textContent = label), 1600);
}
copyBtn.addEventListener('click', () => copy(copyBtn, text.value.trim(), 'Copy text'));
promptBtn.addEventListener('click', () => copy(promptBtn, prompt(), 'Copy as a prompt for your AI agent'));

function setButtons(on: boolean) {
  copyBtn.disabled = !on;
  promptBtn.disabled = !on;
}

// ---------- Reading a picture ----------

let workerP: Promise<OcrWorker> | null = null;
let onProgress: (m: { status: string; progress: number }) => void = () => {};

function getWorker(): Promise<OcrWorker> {
  if (!workerP) {
    const abs = (p: string) => new URL(p, location.href).href;
    workerP = import('tesseract.js')
      .then(({ createWorker }) =>
        createWorker('eng', 1, {
          workerPath: abs('/ocr/worker.min.js'),
          corePath: abs('/ocr/'),
          langPath: abs('/ocr'),
          workerBlobURL: false,
          logger: (m: { status: string; progress: number }) => onProgress(m),
        }),
      )
      .catch((e) => {
        workerP = null;
        throw e;
      });
  }
  return workerP;
}

const STEPS: Record<string, [string, number, number]> = {
  // status -> [what we say, where the bar starts, how much of the bar it fills]
  'loading tesseract core': ['Getting the text reader ready…', 0, 0.35],
  'loading language traineddata': ['Getting the English language file…', 0.35, 0.3],
  'initializing api': ['Almost ready…', 0.65, 0.05],
  'recognizing text': ['Reading the text…', 0.7, 0.3],
};

function setBusy(on: boolean, title = 'Reading the text…', note = '') {
  busy.hidden = !on;
  busyTitle.textContent = title;
  busyNote.textContent = note;
  if (on) bar.style.width = '0%';
}

// Small screenshots read better when scaled up; huge ones are scaled down to keep it quick.
async function prepare(file: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file);
  let scale = 1;
  if (bmp.width < 1000) scale = Math.min(2, 2000 / bmp.width);
  if (Math.max(bmp.width, bmp.height) * scale > MAX_SIDE) scale = MAX_SIDE / Math.max(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext('2d')!;
  // See-through parts become white, so dark text on a clear background stays readable.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

async function read(file: Blob, name: string) {
  const id = ++run;
  error.hidden = true;
  if (!file.type.startsWith('image/')) {
    showError('That isn’t a picture. Drop a PNG, JPG, WebP or GIF screenshot.');
    return;
  }
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  img.src = objectUrl;
  img.alt = `Your screenshot: ${name}`;
  img.removeAttribute('width');
  img.removeAttribute('height');
  boxes.replaceChildren();
  linesBody.replaceChildren();
  verdict.replaceChildren();
  text.value = '';
  placed = [];
  updatePrompt();
  setButtons(false);
  caption.textContent = name;
  dropText.textContent = 'Drop, choose or paste another screenshot to read it.';

  const firstTime = !workerP;
  setBusy(true, firstTime ? 'Getting the text reader ready…' : 'Reading the text…', firstTime ? 'First time only: about 7 MB. Next time it starts right away.' : '');
  onProgress = (m) => {
    if (id !== run) return;
    const step = STEPS[m.status];
    if (!step) return;
    busyTitle.textContent = step[0];
    bar.style.width = `${Math.round((step[1] + step[2] * (m.progress || 0)) * 100)}%`;
  };

  try {
    const [canvas, worker] = await Promise.all([prepare(file), getWorker()]);
    if (id !== run) return;
    if (!firstTime) busyNote.textContent = '';
    const { data } = await worker.recognize(canvas, {}, { text: false, blocks: true });
    if (id !== run) return;
    const lines: Line[] = [];
    let para = 0;
    for (const b of data.blocks ?? []) {
      for (const p of b.paragraphs) {
        for (const l of p.lines) {
          const t = l.text.replace(/\s+$/, '');
          if (!t.trim()) continue;
          lines.push({ text: t, conf: l.confidence, para, x0: l.bbox.x0, y0: l.bbox.y0, x1: l.bbox.x1, y1: l.bbox.y1 });
        }
        para++;
      }
    }
    setBusy(false);
    show(lines, canvas.width, canvas.height);
  } catch (e) {
    if (id !== run) return;
    setBusy(false);
    console.warn(e);
    showError('We couldn’t read that picture. Try another one, or reload the page and try again.');
  }
}

function showError(msg: string) {
  error.textContent = msg;
  error.hidden = false;
}

// ---------- Getting a picture in ----------

fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f) read(f, f.name);
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
  const f = e.dataTransfer?.files?.[0];
  if (f) read(f, f.name);
});
document.addEventListener('paste', (e) => {
  // Let people paste text into the text box as usual.
  if (e.target === text) return;
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
  const f = item?.getAsFile();
  if (!f) return;
  e.preventDefault();
  read(f, 'Pasted screenshot');
});

// The sample is shown with the result the reader gives for it, so nothing downloads until it's needed.
show(EXAMPLE.lines, EXAMPLE.width, EXAMPLE.height);
