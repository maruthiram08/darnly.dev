// Video to GIF: trims a video and turns it into a GIF in the visitor's browser. Nothing is uploaded.
// Frames are grabbed by seeking a hidden <video> and drawing it on a canvas; a Web Worker
// (video-to-gif-worker.ts) encodes them with gifenc while the next frame is grabbed.

const MB = 1024 * 1024;
const PLACES = [
  { name: 'GitHub', limit: 10 * MB },
  { name: 'Discord', limit: 10 * MB },
  { name: 'X', limit: 15 * MB },
];
const WIDTHS = [320, 480, 640, 800, 1024, 1280];
const DEFAULT_WIDTH = 800;
const DEFAULT_CLIP = 10; // Seconds picked at first for long videos.
const MAX_FRAMES = 600;
const MIN_CLIP = 0.2;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const startBox = $<HTMLDivElement>('vg-start');
const drop = $<HTMLLabelElement>('vg-drop');
const fileInput = $<HTMLInputElement>('vg-file');
const sampleBtn = $<HTMLButtonElement>('vg-sample');
const errorEl = $<HTMLParagraphElement>('vg-error');
const work = $<HTMLDivElement>('vg-work');
const video = $<HTMLVideoElement>('vg-video');
const tl = $<HTMLDivElement>('vg-tl');
const strip = $<HTMLCanvasElement>('vg-strip');
const shadeL = $<HTMLDivElement>('vg-shade-l');
const shadeR = $<HTMLDivElement>('vg-shade-r');
const sel = $<HTMLDivElement>('vg-sel');
const playhead = $<HTMLDivElement>('vg-playhead');
const h1 = $<HTMLDivElement>('vg-h1');
const h2 = $<HTMLDivElement>('vg-h2');
const trimEl = $<HTMLParagraphElement>('vg-trim');
const widthSel = $<HTMLSelectElement>('vg-width');
const fpsSel = $<HTMLSelectElement>('vg-fps');
const speedSel = $<HTMLSelectElement>('vg-speed');
const loopSel = $<HTMLSelectElement>('vg-loop');
const gifImg = $<HTMLImageElement>('vg-gif');
const busy = $<HTMLDivElement>('vg-busy');
const bar = $<HTMLSpanElement>('vg-bar');
const busyText = $<HTMLParagraphElement>('vg-busy-text');
const sizeEl = $<HTMLElement>('vg-size');
const metaEl = $<HTMLSpanElement>('vg-meta');
const fitsEl = $<HTMLUListElement>('vg-fits');
const tip = $<HTMLParagraphElement>('vg-tip');
const tipText = $<HTMLSpanElement>('vg-tip-text');
const smallerBtn = $<HTMLButtonElement>('vg-smaller');
const downloadA = $<HTMLAnchorElement>('vg-download');
const mdBtn = $<HTMLButtonElement>('vg-md');
const vidBtn = $<HTMLButtonElement>('vg-vid');
const vidKind = $<HTMLSpanElement>('vg-vid-kind');
const vidOut = $<HTMLSpanElement>('vg-vid-out');
const resetBtn = $<HTMLButtonElement>('vg-reset');

// A second, hidden video that frames are grabbed from, so the preview keeps playing.
const grab = document.createElement('video');
grab.muted = true;
grab.playsInline = true;
grab.preload = 'auto';

let srcUrl = '';
let gifUrl = '';
let vidUrl = '';
let baseName = 'demo';
let duration = 0;
let vw = 0;
let vh = 0;
let start = 0;
let end = 0;
let run = 0; // Bumped for every new render, so an old one stops.
let worker: Worker | null = null;
let timer = 0;
let lastSize = 0;
let rendering = false;
let recording = false;
let captureId = 0;
let gifSize = 0;

const fmtTime = (s: number) => `${s.toFixed(1)} s`;
function fmtSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < MB) return `${Math.round(b / 1024)} KB`;
  return `${(b / MB).toFixed(b < 10 * MB ? 1 : 0)} MB`;
}

function showError(msg: string) {
  errorEl.textContent = msg;
  errorEl.hidden = !msg;
}

// Video from MediaRecorder often reports its length as Infinity until it's read to the end.
async function realDuration(v: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(v.duration) && v.duration > 0) return v.duration;
  await new Promise<void>((res) => {
    const done = () => { v.removeEventListener('durationchange', check); res(); };
    const check = () => { if (Number.isFinite(v.duration)) done(); };
    v.addEventListener('durationchange', check);
    v.currentTime = 1e9;
    setTimeout(done, 3000);
  });
  const d = v.duration;
  v.currentTime = 0;
  return Number.isFinite(d) ? d : 0;
}

function seek(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((res) => {
    if (Math.abs(v.currentTime - t) < 0.001 && v.readyState >= 2) return res();
    const done = () => { v.removeEventListener('seeked', done); clearTimeout(to); res(); };
    const to = setTimeout(done, 2000);
    v.addEventListener('seeked', done);
    v.currentTime = t;
  });
}

function loadInto(v: HTMLVideoElement, url: string): Promise<void> {
  return new Promise((res, rej) => {
    const ok = () => { clean(); res(); };
    const bad = () => { clean(); rej(new Error('load')); };
    const clean = () => { v.removeEventListener('loadeddata', ok); v.removeEventListener('error', bad); };
    v.addEventListener('loadeddata', ok);
    v.addEventListener('error', bad);
    v.src = url;
    v.load();
  });
}

async function openVideo(blob: Blob, name: string) {
  showError('');
  if (blob.type && !blob.type.startsWith('video/') && !/\.(mov|mkv|mp4|webm|m4v)$/i.test(name)) {
    showError('That doesn’t look like a video. Try an MP4, WebM or MOV file.');
    return;
  }
  stopRender();
  if (srcUrl) URL.revokeObjectURL(srcUrl);
  srcUrl = URL.createObjectURL(blob);
  baseName = (name.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'demo').slice(0, 60);
  try {
    await Promise.all([loadInto(video, srcUrl), loadInto(grab, srcUrl)]);
  } catch {
    showError('Your browser can’t play this video. If it’s a MOV from an iPhone (HEVC), try Safari, or export it as MP4 first.');
    return;
  }
  vw = grab.videoWidth;
  vh = grab.videoHeight;
  duration = await realDuration(grab);
  await realDuration(video);
  if (!vw || !vh || !duration) {
    showError('This video has no picture we can read. Try another file.');
    return;
  }
  start = 0;
  end = Math.min(duration, DEFAULT_CLIP);
  fillWidths();
  startBox.hidden = true;
  work.hidden = false;
  clearVideoOut();
  layoutTimeline();
  video.currentTime = 0;
  video.playbackRate = Number(speedSel.value);
  video.play().catch(() => {});
  await drawStrip();
  schedule(0);
}

function fillWidths() {
  const max = Math.min(vw, 1280);
  const opts = WIDTHS.filter((w) => w < max);
  widthSel.innerHTML = '';
  for (const w of opts) widthSel.add(new Option(`${w} px`, String(w)));
  widthSel.add(new Option(`${max} px (${max === vw ? 'original' : 'largest'})`, String(max)));
  const pick = opts.includes(DEFAULT_WIDTH) ? DEFAULT_WIDTH : max;
  widthSel.value = String(pick);
}

// The strip of little pictures under the video.
async function drawStrip() {
  const rect = tl.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  strip.width = Math.round(rect.width * dpr);
  strip.height = Math.round(rect.height * dpr);
  const ctx = strip.getContext('2d')!;
  const th = strip.height;
  const tw = Math.max(1, Math.round((th * vw) / vh));
  const n = Math.max(1, Math.ceil(strip.width / tw));
  const myRun = run;
  for (let i = 0; i < n; i++) {
    if (myRun !== run && rendering) return; // A render started; it needs the hidden video.
    await seek(grab, Math.min(duration - 0.01, (i + 0.5) * (duration / n)));
    ctx.drawImage(grab, i * tw, 0, tw, th);
  }
}

function layoutTimeline() {
  const a = (start / duration) * 100;
  const b = (end / duration) * 100;
  shadeL.style.width = `${a}%`;
  shadeR.style.width = `${100 - b}%`;
  sel.style.left = `${a}%`;
  sel.style.width = `${b - a}%`;
  h1.style.left = `${a}%`;
  h2.style.left = `${b}%`;
  for (const [h, v, lo, hi] of [[h1, start, 0, end - MIN_CLIP], [h2, end, start + MIN_CLIP, duration]] as const) {
    h.setAttribute('aria-valuemin', lo.toFixed(1));
    h.setAttribute('aria-valuemax', hi.toFixed(1));
    h.setAttribute('aria-valuenow', v.toFixed(1));
    h.setAttribute('aria-valuetext', fmtTime(v));
  }
  const len = end - start;
  const speed = Number(speedSel.value);
  const shown = len / speed;
  trimEl.innerHTML = `${fmtTime(start)} to ${fmtTime(end)} · <strong>${fmtTime(len)} clip</strong>` +
    (speed !== 1 ? ` · plays in ${fmtTime(shown)}` : '') +
    (duration > DEFAULT_CLIP && start === 0 && Math.abs(end - DEFAULT_CLIP) < 0.01 ? ' · drag the handles to pick another part' : '');
}

function frameCount() {
  const fps = Number(fpsSel.value);
  const speed = Number(speedSel.value);
  return Math.max(1, Math.min(MAX_FRAMES, Math.round(((end - start) / speed) * fps)));
}

// ---- Trimming by dragging ----
type Drag = { kind: 'h1' | 'h2' | 'sel'; x0: number; s0: number; e0: number };
let drag: Drag | null = null;

function timeAt(clientX: number) {
  const r = tl.getBoundingClientRect();
  return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration;
}

function onDown(kind: Drag['kind']) {
  return (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    drag = { kind, x0: e.clientX, s0: start, e0: end };
    tl.setPointerCapture(e.pointerId);
  };
}
h1.addEventListener('pointerdown', onDown('h1'));
h2.addEventListener('pointerdown', onDown('h2'));
sel.addEventListener('pointerdown', onDown('sel'));
// Clicking the strip outside the selection moves the nearest handle there.
tl.addEventListener('pointerdown', (e) => {
  const t = timeAt(e.clientX);
  const kind = Math.abs(t - start) < Math.abs(t - end) ? 'h1' : 'h2';
  drag = { kind, x0: e.clientX, s0: start, e0: end };
  tl.setPointerCapture(e.pointerId);
  moveDrag(e.clientX);
});
tl.addEventListener('pointermove', (e) => { if (drag) moveDrag(e.clientX); });
const endDrag = () => {
  if (!drag) return;
  drag = null;
  afterTrim();
};
tl.addEventListener('pointerup', endDrag);
tl.addEventListener('pointercancel', endDrag);

function moveDrag(x: number) {
  if (!drag) return;
  const r = tl.getBoundingClientRect();
  if (drag.kind === 'h1') {
    start = Math.max(0, Math.min(timeAt(x), end - MIN_CLIP));
    video.currentTime = start;
  } else if (drag.kind === 'h2') {
    end = Math.min(duration, Math.max(timeAt(x), start + MIN_CLIP));
    video.currentTime = end;
  } else {
    const len = drag.e0 - drag.s0;
    const dt = ((x - drag.x0) / r.width) * duration;
    start = Math.max(0, Math.min(duration - len, drag.s0 + dt));
    end = start + len;
    video.currentTime = start;
  }
  video.pause();
  layoutTimeline();
}

function afterTrim() {
  layoutTimeline();
  video.currentTime = start;
  video.play().catch(() => {});
  schedule();
}

for (const [h, which] of [[h1, 'start'], [h2, 'end']] as const) {
  h.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 1 : 0.1;
    let d = 0;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') d = -step;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') d = step;
    else return;
    e.preventDefault();
    if (which === 'start') start = Math.max(0, Math.min(end - MIN_CLIP, start + d));
    else end = Math.min(duration, Math.max(start + MIN_CLIP, end + d));
    afterTrim();
  });
}

// Keep the preview playing only the trimmed part, at the chosen speed.
function tick() {
  if (duration) {
    if (!drag && (video.currentTime >= end || video.currentTime < start - 0.05)) {
      video.currentTime = start;
      if (video.paused) video.play().catch(() => {});
    }
    playhead.style.left = `${(video.currentTime / duration) * 100}%`;
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
video.addEventListener('ended', () => { video.currentTime = start; video.play().catch(() => {}); });

// ---- Making the GIF ----
function schedule(delay = 350) {
  clearTimeout(timer);
  showBusy(0, 'Making your GIF…');
  fitsEl.innerHTML = PLACES.map((p) => `<li class="wait">${p.name}</li>`).join('');
  timer = window.setTimeout(render, delay);
}

function showBusy(p: number, text: string) {
  busy.hidden = false;
  bar.style.width = `${Math.round(p * 100)}%`;
  busyText.textContent = text;
  downloadA.setAttribute('aria-disabled', 'true');
  vidBtn.disabled = true;
}

function stopRender() {
  run++;
  rendering = false;
  clearTimeout(timer);
  if (worker) { worker.terminate(); worker = null; }
}

// Grabs a frame at each time in `times` and hands it to `send`. Plays the hidden video and
// picks frames as they're shown, which is far quicker than seeking to every frame (a seek
// decodes from the last keyframe, often seconds back). Falls back to seeking where the
// browser can't tell us when a frame is shown. `wait` pauses while the encoder catches up.
async function captureFrames(times: number[], send: () => void, cancelled: () => boolean, wait: () => Promise<void> | null): Promise<boolean> {
  await seek(grab, times[0]);
  if (cancelled()) return false;
  send();
  let k = 1;
  if (k >= times.length) return true;
  if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) {
    for (; k < times.length; k++) {
      await seek(grab, times[k]);
      if (cancelled()) return false;
      send();
      const p = wait();
      if (p) await p;
    }
    return true;
  }
  const last = times[times.length - 1];
  const id = ++captureId;
  return new Promise<boolean>((res) => {
    let finished = false;
    let waiting = false;
    let seen = performance.now();
    const finish = async (val: boolean, fallback = false) => {
      if (finished) return;
      finished = true;
      clearInterval(dog);
      grab.removeEventListener('ended', onEnded);
      if (id === captureId) { grab.pause(); grab.playbackRate = 1; }
      if (fallback) {
        // No frames arrived for a while (a hidden tab, or an odd file): seek for the rest.
        for (; k < times.length; k++) {
          await seek(grab, times[k]);
          if (cancelled()) return res(false);
          send();
          const p = wait();
          if (p) await p;
        }
      }
      if (val) for (; k < times.length; k++) send(); // The video ended a little early: repeat the last frame.
      res(val);
    };
    const dog = setInterval(() => {
      if (cancelled()) return finish(false);
      if (!waiting && performance.now() - seen > 2500) finish(true, true);
    }, 500);
    const onEnded = () => finish(!cancelled());
    grab.addEventListener('ended', onEnded);
    const onFrame = async (_now: number, meta: VideoFrameCallbackMetadata) => {
      if (finished) return;
      if (cancelled()) return finish(false);
      seen = performance.now();
      const t = meta.mediaTime;
      while (k < times.length && times[k] <= t + 0.002) { send(); k++; }
      if (k >= times.length || t >= last) return finish(true);
      const p = wait();
      if (p) {
        grab.pause();
        waiting = true;
        await p;
        waiting = false;
        seen = performance.now();
        if (cancelled()) return finish(false);
        grab.play().catch(() => finish(false));
      }
      grab.requestVideoFrameCallback(onFrame);
    };
    grab.playbackRate = 2;
    grab.requestVideoFrameCallback(onFrame);
    grab.play().catch(() => finish(false));
  });
}

async function render() {
  if (recording) { timer = window.setTimeout(render, 500); return; }
  stopRender();
  const myRun = run;
  rendering = true;
  const width = Number(widthSel.value);
  const w = Math.max(2, Math.round(width));
  const h = Math.max(2, Math.round((vh * w) / vw));
  const fps = Number(fpsSel.value);
  const speed = Number(speedSel.value);
  const n = frameCount();
  const delay = 1000 / fps;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';

  const wk = new Worker(new URL('./video-to-gif-worker.ts', import.meta.url), { type: 'module' });
  worker = wk;
  let acked = 0;
  let posted = 0;
  let resume: (() => void) | null = null;
  const done = new Promise<{ bytes: Uint8Array; frames: number }>((res, rej) => {
    wk.onmessage = (e) => {
      if (e.data.type === 'progress') {
        lastSize = e.data.bytes;
        acked++;
        showBusy(acked / n, `Making your GIF… ${Math.round((acked / n) * 100)}% · ${fmtSize(lastSize)} so far`);
        if (resume && posted - acked <= 2) { const r = resume; resume = null; r(); }
      }
      if (e.data.type === 'done') res(e.data);
    };
    wk.onerror = () => rej(new Error('worker'));
  });
  wk.postMessage({ type: 'start', width: w, height: h, repeat: Number(loopSel.value) });

  const send = () => {
    ctx.drawImage(grab, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    wk.postMessage({ type: 'frame', data: data.buffer, delay }, [data.buffer]);
    posted++;
  };
  const times = Array.from({ length: n }, (_, i) => Math.min(end - 0.001, start + (i / fps) * speed));
  const ok = await captureFrames(times, send, () => myRun !== run, () => posted - acked > 6
    ? new Promise<void>((r) => { resume = r; })
    : null);
  if (!ok || myRun !== run) return;
  wk.postMessage({ type: 'end' });
  let out: { bytes: Uint8Array; frames: number };
  try {
    out = await done;
  } catch {
    if (myRun === run) {
      busy.hidden = true;
      showError('Something went wrong making the GIF. Try a smaller width or a shorter clip.');
    }
    return;
  }
  if (myRun !== run) return;
  rendering = false;
  wk.terminate();
  worker = null;
  showError('');
  const blob = new Blob([out.bytes as BlobPart], { type: 'image/gif' });
  if (gifUrl) URL.revokeObjectURL(gifUrl);
  gifUrl = URL.createObjectURL(blob);
  gifImg.src = gifUrl;
  gifImg.hidden = false;
  gifImg.width = w;
  gifImg.height = h;
  busy.hidden = true;
  downloadA.href = gifUrl;
  downloadA.download = `${baseName}.gif`;
  downloadA.setAttribute('aria-disabled', 'false');
  vidBtn.disabled = false;
  showSize(blob.size, w, h, n, out.frames, ((end - start) / speed));
}

function showSize(size: number, w: number, h: number, n: number, kept: number, secs: number) {
  gifSize = size;
  sizeEl.textContent = fmtSize(size);
  const merged = n - kept;
  metaEl.textContent = `${w} × ${h} · ${n} frames${merged > 0 ? ` (${merged} still ones merged)` : ''} · ${fmtTime(secs)}`;
  fitsEl.innerHTML = PLACES.map((p) =>
    size <= p.limit
      ? `<li class="ok">✓ Fits ${p.name}</li>`
      : `<li class="no">✗ Too big for ${p.name} (${p.limit / MB} MB)</li>`,
  ).join('');
  const smallest = PLACES[0].limit;
  if (size > smallest) {
    tipText.textContent = `Over ${smallest / MB} MB. A shorter clip, a smaller width or fewer frames will fix it.`;
    tip.hidden = false;
    smallerBtn.hidden = !canShrink();
  } else {
    tip.hidden = true;
  }
}

// Step down one setting at a time: width first, then frame rate.
function canShrink() {
  return widthSel.selectedIndex > 0 || fpsSel.selectedIndex > 0;
}
smallerBtn.addEventListener('click', () => {
  const w = Number(widthSel.value);
  if (w > 480 && widthSel.selectedIndex > 0) widthSel.selectedIndex--;
  else if (fpsSel.selectedIndex > 1) fpsSel.selectedIndex--;
  else if (widthSel.selectedIndex > 0) widthSel.selectedIndex--;
  else if (fpsSel.selectedIndex > 0) fpsSel.selectedIndex--;
  schedule(0);
});

for (const s of [widthSel, fpsSel, loopSel]) s.addEventListener('change', () => { clearVideoOut(); schedule(); });
speedSel.addEventListener('change', () => {
  video.playbackRate = Number(speedSel.value);
  layoutTimeline();
  clearVideoOut();
  schedule();
});

mdBtn.addEventListener('click', async () => {
  const md = `![Demo](docs/${baseName}.gif)`;
  try {
    await navigator.clipboard.writeText(md);
    mdBtn.textContent = 'Copied!';
  } catch {
    mdBtn.textContent = md;
  }
  setTimeout(() => { mdBtn.textContent = 'Copy Markdown'; }, 1800);
});

// ---- The smaller video version ----
const VIDEO_TYPES = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
const videoType = typeof MediaRecorder !== 'undefined' ? VIDEO_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) : undefined;
const videoExt = videoType?.startsWith('video/mp4') ? 'mp4' : 'webm';
vidKind.textContent = videoType ? videoExt.toUpperCase() : 'video';
if (!videoType || !('captureStream' in HTMLCanvasElement.prototype)) vidBtn.closest('.alt')?.setAttribute('hidden', '');

function clearVideoOut() {
  vidOut.textContent = '';
  if (vidUrl) { URL.revokeObjectURL(vidUrl); vidUrl = ''; }
}

// Plays the trimmed clip once through a canvas and records it. Takes as long as the clip.
vidBtn.addEventListener('click', async () => {
  if (!videoType || rendering || recording) return;
  clearVideoOut();
  recording = true;
  vidBtn.disabled = true;
  const w = Number(widthSel.value) & ~1;
  const h = Math.round((vh * w) / vw) & ~1;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const fps = Math.max(24, Number(fpsSel.value));
  const stream = canvas.captureStream(fps);
  const rec = new MediaRecorder(stream, { mimeType: videoType, videoBitsPerSecond: Math.round(w * h * 3) });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise<void>((res) => { rec.onstop = () => res(); });
  const speed = Number(speedSel.value);
  await seek(grab, start);
  ctx.drawImage(grab, 0, 0, w, h);
  grab.playbackRate = speed;
  rec.start();
  await grab.play().catch(() => {});
  const secs = (end - start) / speed;
  await new Promise<void>((res) => {
    const draw = () => {
      ctx.drawImage(grab, 0, 0, w, h);
      const left = Math.max(0, (end - grab.currentTime) / speed);
      vidOut.textContent = `Recording… ${Math.ceil(left)} s left`;
      if (grab.currentTime >= end || grab.ended || grab.paused) return res();
      requestAnimationFrame(draw);
    };
    draw();
    setTimeout(res, secs * 1000 + 3000);
  });
  grab.pause();
  grab.playbackRate = 1;
  rec.stop();
  await stopped;
  const blob = new Blob(chunks, { type: videoType.split(';')[0] });
  vidUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = vidUrl;
  a.download = `${baseName}.${videoExt}`;
  a.textContent = `Download ${videoExt.toUpperCase()} (${fmtSize(blob.size)})`;
  vidOut.textContent = '';
  vidOut.append(a);
  if (gifSize > blob.size) {
    const x = gifSize / blob.size;
    vidOut.append(` · ${x >= 2 ? `${Math.round(x)}× smaller` : `${Math.round((1 - blob.size / gifSize) * 100)}% smaller`} than the GIF`);
  }
  recording = false;
  vidBtn.disabled = false;
});


// ---- Getting a video in ----
fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f) openVideo(f, f.name);
  fileInput.value = '';
});
drop.addEventListener('dragover', () => drop.classList.add('over'));
for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, () => drop.classList.remove('over'));
// Dropping a video anywhere on the page works too, also after one is loaded.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  if (e.target === fileInput) return;
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f) openVideo(f, f.name);
});

resetBtn.addEventListener('click', () => {
  stopRender();
  video.pause();
  work.hidden = true;
  startBox.hidden = false;
  gifImg.hidden = true;
  showError('');
  clearVideoOut();
});

window.addEventListener('resize', () => {
  if (!work.hidden && !rendering && !recording) drawStrip();
});

// A made-up 4 second screen recording: a cursor clicks Save on a little app and a toast pops up.
// Recorded in real time from a canvas, so a first visit has something to play with.
sampleBtn.addEventListener('click', async () => {
  if (!videoType || !('captureStream' in HTMLCanvasElement.prototype)) {
    showError('Your browser can’t make the sample. Drop in one of your own videos instead.');
    return;
  }
  sampleBtn.disabled = true;
  const label = sampleBtn.textContent;
  const W = 960;
  const H = 540;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const rec = new MediaRecorder(c.captureStream(30), { mimeType: videoType, videoBitsPerSecond: 2_500_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise<void>((res) => { rec.onstop = () => res(); });
  const LEN = 4000;
  drawSample(ctx, 0);
  rec.start();
  const t0 = performance.now();
  await new Promise<void>((res) => {
    const step = () => {
      const t = performance.now() - t0;
      drawSample(ctx, Math.min(t, LEN));
      sampleBtn.textContent = `Making a sample recording… ${Math.max(0, Math.ceil((LEN - t) / 1000))} s`;
      if (t >= LEN) return res();
      requestAnimationFrame(step);
    };
    step();
  });
  rec.stop();
  await stopped;
  sampleBtn.textContent = label;
  sampleBtn.disabled = false;
  await openVideo(new Blob(chunks, { type: videoType.split(';')[0] }), `sample-recording.${videoExt}`);
});

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

const ease = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

function drawSample(ctx: CanvasRenderingContext2D, t: number) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.fillStyle = '#E9F0F3';
  ctx.fillRect(0, 0, W, H);
  // Window
  roundRect(ctx, 40, 30, W - 80, H - 60, 14, '#FFFFFF');
  roundRect(ctx, 40, 30, W - 80, 40, 14, '#F3F6F8');
  ctx.fillStyle = '#F3F6F8';
  ctx.fillRect(40, 56, W - 80, 14);
  for (const [i, col] of ['#FF5F57', '#FEBC2E', '#28C840'].entries()) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(64 + i * 20, 50, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  roundRect(ctx, 200, 40, W - 400, 20, 10, '#FFFFFF');
  ctx.fillStyle = '#5A7180';
  ctx.font = '13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('my-app.vercel.app/settings', W / 2, 55);
  ctx.textAlign = 'left';
  // Sidebar
  ctx.fillStyle = '#0B2230';
  ctx.fillRect(40, 70, 180, H - 100);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 18px system-ui, sans-serif';
  ctx.fillText('my app', 64, 108);
  ctx.font = '15px system-ui, sans-serif';
  for (const [i, s] of ['Home', 'Projects', 'Settings', 'Billing'].entries()) {
    if (i === 2) roundRect(ctx, 54, 132 + i * 40, 152, 30, 8, '#0593C6');
    ctx.fillStyle = i === 2 ? '#FFFFFF' : '#9FC3D3';
    ctx.fillText(s, 68, 152 + i * 40);
  }
  // Form
  ctx.fillStyle = '#0B2230';
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.fillText('Settings', 260, 124);
  const typed = 'Acme studio'.slice(0, Math.max(0, Math.floor((t - 300) / 70)));
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillStyle = '#5A7180';
  ctx.fillText('Project name', 260, 168);
  ctx.strokeStyle = t > 300 && t < 1600 ? '#0593C6' : '#D7E9F0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(260, 178, 380, 42, 8);
  ctx.stroke();
  ctx.fillStyle = '#0B2230';
  ctx.font = '16px system-ui, sans-serif';
  ctx.fillText(typed + (t > 300 && t < 1600 && Math.floor(t / 400) % 2 ? '|' : ''), 274, 205);
  ctx.fillStyle = '#5A7180';
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillText('Plan', 260, 254);
  roundRect(ctx, 260, 264, 380, 42, 8, '#F3F6F8');
  ctx.fillStyle = '#0B2230';
  ctx.font = '16px system-ui, sans-serif';
  ctx.fillText('Pro, monthly', 274, 291);
  // Save button
  const pressed = t > 2050 && t < 2250;
  const bx = 260;
  const by = 336;
  roundRect(ctx, bx, by + (pressed ? 2 : 0), 120, 44, 22, pressed ? '#047FAB' : '#0593C6');
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 16px system-ui, sans-serif';
  ctx.fillText('Save', bx + 42, by + 28 + (pressed ? 2 : 0));
  // Toast
  if (t > 2250) {
    const a = ease((t - 2250) / 300);
    ctx.globalAlpha = a;
    roundRect(ctx, W - 340, H - 110 + (1 - a) * 20, 260, 52, 12, '#11795A');
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.fillText('✓  Saved. Looking good!', W - 316, H - 78 + (1 - a) * 20);
    ctx.globalAlpha = 1;
  }
  // Cursor: from the name field to the Save button.
  const m = ease((t - 1500) / 500);
  const cx = 600 + (bx + 64 - 600) * m;
  const cy = 200 + (by + 24 - 200) * m;
  if (pressed) {
    ctx.fillStyle = 'rgba(216, 57, 149, 0.35)';
    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = '#0B2230';
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 22);
  ctx.lineTo(6, 17);
  ctx.lineTo(10, 26);
  ctx.lineTo(14, 24);
  ctx.lineTo(10, 15);
  ctx.lineTo(17, 15);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}
