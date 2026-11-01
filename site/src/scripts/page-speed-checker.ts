// Page speed checker: asks /api/speed (Google PageSpeed Insights, run by the Worker) to test a
// page on a phone and a laptop, then shows the result visually: scores on device mockups, the
// loading filmstrip, Core Web Vitals in plain words, and the top three fixes as prompts.

type Grade = 'good' | 'ok' | 'poor';
type Fix = { key: string; title: string; plain: string; savingsMs: number; files: string[]; prompt: string; tool?: { href: string; name: string } };
type Report = {
  score: number;
  frames: { t: number; src: string }[];
  final: string | null;
  lcp: { ms: number; grade: Grade; kind: 'image' | 'text' | 'video' | 'block' | null; label: string | null };
  cls: { value: number; grade: Grade };
  tbt: { ms: number; grade: Grade };
  fcp: { ms: number };
  si: { ms: number };
  fixes: Fix[];
};
type Field = {
  scope: 'page' | 'site';
  lcp: { ms: number; grade: Grade } | null;
  cls: { value: number; grade: Grade } | null;
  inp: { ms: number; grade: Grade } | null;
} | null;
type Side = Report | { error: string };
type Result = { url: string; finalUrl: string; mobile: Side; desktop: Side; field: Field; error?: string };
type Dev = 'mobile' | 'desktop';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('ps-form');
const input = $<HTMLInputElement>('ps-url');
const button = $<HTMLButtonElement>('ps-go');
const error = $<HTMLParagraphElement>('ps-error');
const stage = $<HTMLElement>('ps-stage');
const eyebrow = $<HTMLParagraphElement>('ps-eyebrow');
const verdict = $<HTMLParagraphElement>('ps-verdict');
const wait = $<HTMLDivElement>('ps-wait');
const waitText = $<HTMLParagraphElement>('ps-wait-text');
const body = $<HTMLDivElement>('ps-body');
const filmH = $<HTMLHeadingElement>('ps-film-h');
const film = $<HTMLOListElement>('ps-film');
const vitals = $<HTMLUListElement>('ps-vitals');
const fieldNote = $<HTMLParagraphElement>('ps-field-note');
const fixesH = $<HTMLHeadingElement>('ps-fixes-h');
const fixesList = $<HTMLOListElement>('ps-fixes');
const noFix = $<HTMLParagraphElement>('ps-nofix');
const allBtn = $<HTMLButtonElement>('ps-all');
const table = $<HTMLTableSectionElement>('ps-table');
const detailsNote = $<HTMLParagraphElement>('ps-details-note');
const linkBtn = $<HTMLButtonElement>('ps-link');
const google = $<HTMLAnchorElement>('ps-google');
const status = $<HTMLParagraphElement>('ps-status');
const devButtons: Record<Dev, HTMLButtonElement> = { mobile: $('ps-dev-mobile'), desktop: $('ps-dev-desktop') };
const shots: Record<Dev, HTMLImageElement> = { mobile: $('ps-shot-mobile'), desktop: $('ps-shot-desktop') };
const gauges: Record<Dev, HTMLSpanElement> = { mobile: $('ps-gauge-mobile'), desktop: $('ps-gauge-desktop') };

const ALL_LABEL = 'Copy prompt to fix all three';
const DEV_WORD: Record<Dev, string> = { mobile: 'phone', desktop: 'laptop' };
let current: Result | null = null;
let dev: Dev = 'mobile';
let isExample = true;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string | null) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};
const secs = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
const scoreGrade = (s: number): Grade => (s >= 90 ? 'good' : s >= 50 ? 'ok' : 'poor');
const report = (s: Side | undefined): Report | null => (s && 'score' in s ? s : null);

async function copyText(text: string, btn: HTMLButtonElement, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = 'Couldn’t copy';
  }
  setTimeout(() => (btn.textContent = label), 1500);
}

// ---- The example shown before anyone tests: a made-up page, drawn as simple shapes. ----
function sketch(step: number, wide: boolean): string {
  const [w, h] = wide ? [400, 250] : [160, 320];
  const parts: string[] = [`<rect width="${w}" height="${h}" fill="#fff"/>`];
  const pad = wide ? 24 : 12;
  if (step >= 1) parts.push(`<rect x="0" y="0" width="${w}" height="${wide ? 28 : 26}" fill="#0B2230"/><rect x="${pad}" y="9" width="${wide ? 60 : 36}" height="10" rx="3" fill="#4FC3F7"/>`);
  if (step >= 2) {
    parts.push(`<rect x="${pad}" y="${wide ? 50 : 44}" width="${wide ? 190 : 120}" height="${wide ? 18 : 14}" rx="4" fill="#0B2230"/>`);
    parts.push(`<rect x="${pad}" y="${wide ? 76 : 64}" width="${wide ? 150 : 96}" height="${wide ? 18 : 14}" rx="4" fill="#0B2230"/>`);
  }
  if (step >= 3) {
    for (let i = 0; i < 3; i++) parts.push(`<rect x="${pad}" y="${(wide ? 106 : 90) + i * 12}" width="${(wide ? 170 : 130) - i * 18}" height="6" rx="3" fill="#B8C4CC"/>`);
    parts.push(`<rect x="${pad}" y="${wide ? 150 : 132}" width="${wide ? 90 : 70}" height="${wide ? 26 : 22}" rx="11" fill="#0593C6"/>`);
  }
  if (step >= 4) parts.push(wide
    ? `<rect x="230" y="48" width="146" height="128" rx="10" fill="#FFB74D"/><circle cx="270" cy="92" r="16" fill="#FFF3E0"/><path d="M240 168l40-44 30 30 22-20 44 34z" fill="#E65100"/>`
    : `<rect x="${pad}" y="168" width="${w - pad * 2}" height="120" rx="10" fill="#FFB74D"/><circle cx="52" cy="210" r="14" fill="#FFF3E0"/><path d="M${pad} 288l50-50 30 30 24-22 44 42z" fill="#E65100"/>`);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${parts.join('')}</svg>`)}`;
}

function example(): Result {
  const steps = [0, 0, 1, 1, 2, 3, 3, 3, 4, 4];
  const make = (wide: boolean, every: number, score: number, lcp: number, cls: number, tbt: number): Report => ({
    score,
    frames: steps.map((s, i) => ({ t: (i + 1) * every, src: sketch(s, wide) })),
    final: sketch(4, wide),
    lcp: { ms: lcp, grade: lcp <= 2500 ? 'good' : lcp > 4000 ? 'poor' : 'ok', kind: 'image', label: 'Hero image' },
    cls: { value: cls, grade: cls <= 0.1 ? 'good' : cls > 0.25 ? 'poor' : 'ok' },
    tbt: { ms: tbt, grade: tbt <= 200 ? 'good' : tbt > 600 ? 'poor' : 'ok' },
    fcp: { ms: lcp * 0.45 },
    si: { ms: lcp * 0.8 },
    fixes: [
      { key: 'images', title: 'Shrink and resize your images', plain: 'Some images are bigger than they’re shown, or in an old heavy format. Phones download every extra byte.', savingsMs: 2100, files: [], prompt: 'Make the images on this page lighter: serve them as WebP or AVIF, at the size they are actually displayed, and lazy-load images below the fold.', tool: { href: '/tools/image-compressor/', name: 'image compressor' } },
      { key: 'js', title: 'Send less JavaScript', plain: 'The page downloads and runs more JavaScript than it uses, which keeps the phone busy and slow to respond.', savingsMs: 900, files: [], prompt: 'Reduce the JavaScript this page loads.' },
      { key: 'shifts', title: 'Stop the page from jumping', plain: 'Things move around while the page loads, so people tap the wrong thing.', savingsMs: 600, files: [], prompt: 'Stop layout shifts on this page.' },
    ],
  });
  return {
    url: 'https://your-app.example/',
    finalUrl: 'https://your-app.example/',
    mobile: make(false, 480, 46, 4200, 0.18, 640),
    desktop: make(true, 160, 88, 1400, 0.04, 90),
    field: null,
  };
}

// ---- Rendering ----
function setGauge(d: Dev, r: Report | null) {
  const g = gauges[d];
  g.className = `gauge ${r ? scoreGrade(r.score) : ''}`;
  g.style.setProperty('--p', String(r?.score ?? 0));
  g.querySelector('b')!.textContent = r ? String(r.score) : '–';
  g.querySelector('small')!.textContent = r ? (r.score >= 90 ? 'Fast' : r.score >= 50 ? 'OK' : 'Slow') : 'No result';
  const shot = r?.final ?? r?.frames.at(-1)?.src ?? '';
  if (shot) shots[d].src = shot;
  else shots[d].removeAttribute('src');
  shots[d].alt = r ? `The page as it finished loading on a ${DEV_WORD[d]}` : '';
}

function headline(r: Result): string {
  const name = isExample ? 'An example site' : host(r.finalUrl);
  const m = report(r.mobile);
  const d = report(r.desktop);
  if (!m && d) return `${name} scored ${d.score} on a laptop. The phone test didn’t finish.`;
  if (m && !d) return `${name} scored ${m.score} on a phone. The laptop test didn’t finish.`;
  if (!m || !d) return '';
  if (m.score >= 90 && d.score >= 90) return `${name} is fast on phones and laptops.`;
  if (m.score < 50) return `${name} is slow on phones (${m.score}/100)${d.score >= 90 ? ' but fast on laptops' : ''}.`;
  if (m.score < 90) return `${name} is OK on phones (${m.score}/100)${d.score >= 90 ? ' and fast on laptops' : ''}, with room to speed up.`;
  return `${name} is fast on phones, and ${d.score >= 50 ? 'OK' : 'slow'} on laptops (${d.score}/100).`;
}

function renderFilm(r: Report) {
  filmH.textContent = `How it loads on a ${DEV_WORD[dev]}`;
  film.classList.toggle('wide', dev === 'desktop');
  const lcpAt = r.frames.findIndex((f) => f.t >= r.lcp.ms);
  film.replaceChildren(
    ...r.frames.map((f, i) => {
      const li = el('li', i === lcpAt ? 'lcp' : '');
      const img = el('img');
      img.src = f.src;
      img.alt = `The page after ${secs(f.t)}`;
      img.loading = 'lazy';
      li.append(img, el('span', '', secs(f.t)));
      return li;
    }),
  );
}

const GRADE_WORD: Record<Grade, string> = { good: 'Good', ok: 'Needs work', poor: 'Slow' };
function vital(cls: Grade, name: string, big: string, word = GRADE_WORD[cls]) {
  const li = el('li', cls);
  li.append(el('p', 'v-name', name), el('p', 'v-big', big), el('span', 'v-grade', word));
  return li;
}

function renderVitals(r: Report, f: Field) {
  const what = r.lcp.kind === 'image' ? 'biggest image' : r.lcp.kind === 'text' ? 'main headline' : r.lcp.kind === 'video' ? 'main video' : 'main content';
  const lcp = vital(r.lcp.grade, 'Main content appears (LCP)', `Your ${what} takes ${secs(r.lcp.ms)} to appear.`);
  const shift =
    r.cls.grade === 'good' ? 'The page stays still while it loads.' :
    r.cls.grade === 'ok' ? 'The page jumps a little while it loads.' : 'The page jumps around a lot while it loads.';
  const cls = vital(r.cls.grade, 'Page jumping (CLS)', `${shift} (${r.cls.value})`, r.cls.grade === 'poor' ? 'Jumpy' : GRADE_WORD[r.cls.grade]);
  const inp = f?.inp && dev === 'mobile'
    ? vital(f.inp.grade, 'Taps answer (INP)', `Taps and clicks answer in ${secs(f.inp.ms)} for real visitors.`)
    : vital(
        r.tbt.grade,
        'Taps answer (INP, estimated)',
        r.tbt.grade === 'good'
          ? `Taps should answer right away: the page is busy for only ${secs(r.tbt.ms)}.`
          : `Early taps may lag: the page is busy for ${secs(r.tbt.ms)} after it appears.`,
      );
  vitals.replaceChildren(lcp, cls, inp);

  const parts: string[] = [];
  if (f) {
    if (f.lcp) parts.push(`main content in ${secs(f.lcp.ms)}`);
    if (f.cls) parts.push(`page jumping ${f.cls.value}`);
    if (f.inp) parts.push(`taps answer in ${secs(f.inp.ms)}`);
  }
  fieldNote.textContent = isExample
    ? 'These numbers are an example. Test your own site above.'
    : parts.length
      ? `Real Chrome visitors to this ${f!.scope === 'page' ? 'page' : 'site'} over the last 28 days: ${parts.join(', ')}.`
      : 'Google doesn’t have enough real visitors to this site yet, so these come from its test.';
}

function renderFixes(r: Report) {
  fixesH.textContent = r.fixes.length >= 3 ? 'Top 3 fixes' : r.fixes.length ? 'What to fix' : 'What to fix';
  allBtn.textContent = r.fixes.length > 1 ? (r.fixes.length === 3 ? ALL_LABEL : 'Copy prompt to fix them all') : 'Copy prompt';
  allBtn.dataset.label = allBtn.textContent;
  allBtn.hidden = !r.fixes.length || isExample;
  noFix.hidden = !!r.fixes.length;
  fixesList.replaceChildren(
    ...r.fixes.map((x) => {
      const li = el('li');
      li.append(el('p', 'f-title', x.title), el('p', 'f-plain', x.plain));
      if (x.savingsMs >= 100) li.append(el('p', 'f-save', `Could save about ${secs(x.savingsMs)}`));
      const actions = el('div', 'f-actions');
      if (!isExample) {
        const b = el('button', '', 'Copy prompt');
        b.type = 'button';
        b.addEventListener('click', () => copyText(fixPrompt(x), b, 'Copy prompt'));
        actions.append(b);
      }
      if (x.tool) {
        const a = el('a', '', `Open the ${x.tool.name}`);
        a.href = x.tool.href;
        actions.append(a);
      }
      if (actions.childElementCount) li.append(actions);
      return li;
    }),
  );
}

function context(r: Report): string {
  const site = current ? current.finalUrl : '';
  return `My page ${site} scored ${r.score}/100 in a Google PageSpeed test on a ${DEV_WORD[dev]} (largest contentful paint ${secs(r.lcp.ms)}, layout shift ${r.cls.value}, total blocking time ${secs(r.tbt.ms)}).`;
}
const CLOSE = 'Fix it the way this project is already set up (framework, hosting, file layout). Don’t change how the page looks, and tell me about any step I have to do myself, like a setting at my host.';
const fixPrompt = (x: Fix) => {
  const r = current && report(current[dev]);
  return [r ? context(r) : '', `${x.title}. ${x.prompt}`, '', CLOSE].filter(Boolean).join('\n\n');
};
function allPrompt(r: Report): string {
  const lines = [`Make my site load faster. ${context(r)} Fix these ${r.fixes.length} things, biggest win first:`, ''];
  r.fixes.forEach((x, i) => lines.push(`${i + 1}. ${x.title}. ${x.prompt}`, ''));
  lines.push(CLOSE);
  return lines.join('\n');
}

function renderTable(r: Result) {
  const m = report(r.mobile);
  const d = report(r.desktop);
  const row = (name: string, f: (x: Report) => string) => {
    const tr = el('tr');
    tr.append(el('td', '', name), el('td', '', m ? f(m) : '–'), el('td', '', d ? f(d) : '–'));
    return tr;
  };
  table.replaceChildren(
    row('Performance score', (x) => `${x.score}/100`),
    row('First content appears (FCP)', (x) => secs(x.fcp.ms)),
    row('Main content appears (LCP)', (x) => secs(x.lcp.ms)),
    row('Page jumping (CLS)', (x) => String(x.cls.value)),
    row('Busy time (TBT)', (x) => secs(x.tbt.ms)),
    row('Speed Index', (x) => secs(x.si.ms)),
  );
  const notes: string[] = [];
  const lcpEl = (m ?? d)?.lcp.label;
  if (lcpEl) notes.push(`The main content Google timed: “${lcpEl}”.`);
  if (!m && 'error' in r.mobile) notes.push(`Phone test: ${r.mobile.error}`);
  if (!d && 'error' in r.desktop) notes.push(`Laptop test: ${r.desktop.error}`);
  if (!isExample && host(r.url) !== host(r.finalUrl)) notes.push(`${host(r.url)} redirected to ${host(r.finalUrl)}, so that’s what was tested.`);
  notes.push('Tested by Google PageSpeed Insights on a mid-range phone over slow 4G, and on a laptop over a fast connection. Results are kept for an hour.');
  detailsNote.textContent = notes.join(' ');
}

function showDevice() {
  if (!current) return;
  for (const d of ['mobile', 'desktop'] as Dev[]) devButtons[d].setAttribute('aria-pressed', String(d === dev));
  const r = report(current[dev]);
  if (!r) return;
  renderFilm(r);
  renderVitals(r, current.field);
  renderFixes(r);
}

function render(r: Result) {
  current = r;
  eyebrow.textContent = isExample ? 'Example result' : `Tested ${host(r.finalUrl)}`;
  verdict.textContent = headline(r);
  setGauge('mobile', report(r.mobile));
  setGauge('desktop', report(r.desktop));
  dev = report(r.mobile) ? 'mobile' : 'desktop';
  showDevice();
  renderTable(r);
  google.href = `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(r.finalUrl)}`;
  google.hidden = isExample;
  linkBtn.hidden = isExample;
}

for (const d of ['mobile', 'desktop'] as Dev[]) {
  devButtons[d].addEventListener('click', () => {
    if (!current || !report(current[d]) || stage.classList.contains('loading')) return;
    dev = d;
    showDevice();
  });
}

// ---- Running a test ----
let timer: number | undefined;
function loading(on: boolean) {
  stage.classList.toggle('loading', on);
  wait.hidden = !on;
  body.hidden = on;
  button.disabled = on;
  button.textContent = on ? 'Testing…' : 'Test my speed';
  clearInterval(timer);
  if (on) {
    const start = Date.now();
    const tick = () => {
      const s = Math.round((Date.now() - start) / 1000);
      waitText.textContent = s < 25
        ? `Google is loading your page on a phone and a laptop… ${s} s`
        : `Still testing. Slow pages take longer… ${s} s`;
    };
    tick();
    timer = window.setInterval(tick, 1000);
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = input.value.trim();
  if (!url) return;
  error.hidden = true;
  loading(true);
  try {
    const res = await fetch(`/api/speed?url=${encodeURIComponent(url)}`);
    const data: Result = await res.json().catch(() => ({ error: 'Something went wrong. Try again.' }) as Result);
    if (!res.ok || data.error) throw new Error(data.error ?? 'Something went wrong. Try again.');
    isExample = false;
    render(data);
    history.replaceState(null, '', `?url=${encodeURIComponent(url)}`);
  } catch (err) {
    error.textContent = (err as Error).message;
    error.hidden = false;
  } finally {
    loading(false);
  }
});

allBtn.addEventListener('click', () => {
  const r = current && report(current[dev]);
  if (r) copyText(allPrompt(r), allBtn, allBtn.dataset.label ?? ALL_LABEL);
});
linkBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    status.textContent = 'Link copied.';
  } catch {
    status.textContent = 'Couldn’t copy. Copy the address bar instead.';
  }
  setTimeout(() => (status.textContent = ''), 2000);
});

render(example());

// Shared links like /tools/page-speed-checker/?url=example.com run straight away.
const preset = new URLSearchParams(location.search).get('url');
if (preset) {
  input.value = preset;
  form.requestSubmit();
}
