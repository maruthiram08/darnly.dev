import { describeElement, failedRequestsFromHistory, slowRequestsFromHistory, isSensitiveField, smallestElementAt, withCursor, type ElementInfo } from '@/lib/element-info';
import type { LogEntry } from '@/lib/logs';
import { redactLog } from '@/lib/logs';
import { redactText, redactUrl } from '@/lib/redact';
import { cleanRecordShape, type RecordShape } from '@/lib/record-shape';
import { cleanSteps, recentSteps, type Step } from '@/lib/steps';

/** Asks the page recorder (if it runs on this site) for its last 60 seconds, and the React component of the picked element. */
/** Code info for one extra marked element. */
type AlsoFromPage = { components?: string[]; source?: string; parts?: ElementInfo['parts']; framework?: string };
type FromPage = { also?: AlsoFromPage[]; logs: LogEntry[]; component?: string; components?: string[]; source?: string; parts?: ElementInfo['parts']; framework?: string; record?: RecordShape; steps?: Step[]; recorder: boolean };
const shortString = (v: unknown, max = 120) => (typeof v === 'string' && v.length <= max ? v : undefined);

/** At most this many elements in one bug (the first click plus Shift+clicks). */
const MAX_MARKED = 8;
const FRAMEWORKS = ['react', 'vue', 'svelte', 'attribute'];
const cleanComponents = (v: unknown) => (Array.isArray(v) ? v.map((c) => shortString(c, 60)).filter((c): c is string => !!c).slice(-4) : undefined);

function askRecorder(el: Element | null, also: Element[] = []): Promise<FromPage> {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    el?.setAttribute('data-darnly-picked', '');
    also.forEach((a, i) => a.setAttribute('data-darnly-also', String(i)));
    const done = (r: FromPage) => {
      removeEventListener('message', onMessage);
      el?.removeAttribute('data-darnly-picked');
      also.forEach((a) => a.removeAttribute('data-darnly-also'));
      resolve(r);
    };
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { darnly?: string; id?: string; logs?: LogEntry[]; component?: string; components?: unknown; source?: string; parts?: unknown; framework?: unknown; record?: unknown; steps?: unknown; also?: unknown } | null;
      if (e.source === window && d?.darnly === 'logs' && d.id === id) {
        // The page could send anything here, so keep only short strings.
        const components = cleanComponents(d.components);
        const alsoInfo = Array.isArray(d.also)
          ? d.also.slice(0, MAX_MARKED).map((x) => {
              const o = (x ?? {}) as Record<string, unknown>;
              return { components: cleanComponents(o.components), source: shortString(o.source, 200), parts: cleanParts(o.parts), framework: FRAMEWORKS.find((f) => f === o.framework) };
            })
          : undefined;
        done({ logs: Array.isArray(d.logs) ? d.logs.slice(-200) : [], component: shortString(d.component, 60), components, source: shortString(d.source, 200), parts: cleanParts(d.parts), framework: FRAMEWORKS.find((f) => f === d.framework), also: alsoInfo, record: cleanRecordShape(d.record), steps: recentSteps(cleanSteps(d.steps)), recorder: true });
      }
    };
    addEventListener('message', onMessage);
    window.postMessage({ darnly: 'get-logs', id }, '*');
    setTimeout(() => done({ logs: [], recorder: false }), 300);
  });
}

/** The page can send anything: keep at most 4 parts, each a short name and short paths. */
function cleanParts(v: unknown): ElementInfo['parts'] {
  if (!Array.isArray(v)) return undefined;
  const out = v.slice(-4).flatMap((p) => {
    const o = (p ?? {}) as Record<string, unknown>;
    const name = shortString(o.name, 60);
    if (!name) return [];
    const at = shortString(o.at, 200);
    const file = shortString(o.file, 200);
    return [{ name, ...(at ? { at } : {}), ...(file ? { file } : {}) }];
  });
  return out.length ? out : undefined;
}

function redactElement(info: ElementInfo): ElementInfo {
  return {
    ...info,
    text: redactText(info.text),
    html: redactText(info.html),
    labels: info.labels?.map(redactText),
    container: info.container && { ...info.container, label: info.container.label && redactText(info.container.label) },
    also: info.also?.map(redactElement),
    atCursor: info.atCursor && { ...info.atCursor, text: redactText(info.atCursor.text), html: redactText(info.atCursor.html), labels: info.atCursor.labels?.map(redactText) },
  };
}

/**
 * The element picker. Injected into the page only when the hotkey is pressed.
 * Its overlay lives in a Shadow DOM so the site's CSS can't change how it looks.
 * Hover highlights, arrow up/down moves to the parent/child, click picks, Esc captures the whole page.
 */
export default defineContentScript({
  // Injected on demand with chrome.scripting; this list only keeps WXT from asking for every site.
  matches: ['http://localhost/*'],
  registration: 'runtime',
  main() {
    const w = window as unknown as { __darnlyPicker?: () => void };
    w.__darnlyPicker?.(); // pressing the hotkey twice restarts the picker
    w.__darnlyPicker = start();
  },
});

const HINT = 'Click the broken part · Shift+click to mark several · ↑ ↓ bigger or smaller · W for the whole page · Esc to cancel';

function start(): () => void {
  const host = document.createElement('darnly-picker');
  host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      .box { position: fixed; border: 2px solid #e11d48; background: rgba(225,29,72,.08); border-radius: 2px; pointer-events: none; transition: all 40ms; }
      .label { position: fixed; background: #e11d48; color: #fff; font: 600 11px/1.6 system-ui, sans-serif; padding: 0 6px; border-radius: 3px; pointer-events: none; white-space: nowrap; }
      .mark { position: fixed; border: 2px solid #e11d48; border-radius: 2px; pointer-events: none; }
      .num { position: fixed; min-width: 18px; height: 18px; background: #e11d48; color: #fff; font: 700 11px/18px system-ui, sans-serif; text-align: center; border-radius: 999px; pointer-events: none; box-shadow: 0 0 0 2px #fff; }
      .hint { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); background: #111827; color: #fff; font: 13px/1.4 system-ui, sans-serif; padding: 8px 14px; border-radius: 999px; pointer-events: none; white-space: nowrap; box-shadow: 0 4px 16px rgba(0,0,0,.25); }
    </style>
    <div class="marks"></div><div class="box"></div><div class="label"></div>
    <div class="hint">${HINT}</div>`;
  document.documentElement.appendChild(host);
  const box = shadow.querySelector<HTMLDivElement>('.box')!;
  const label = shadow.querySelector<HTMLDivElement>('.label')!;
  const hint = shadow.querySelector<HTMLDivElement>('.hint')!;
  const marksLayer = shadow.querySelector<HTMLDivElement>('.marks')!;

  // Elements marked with Shift+click, in order. The first one is the main element of the bug.
  const marked: { el: Element; point: { x: number; y: number } | null }[] = [];
  const drawMarks = () => {
    marksLayer.replaceChildren(
      ...marked.flatMap(({ el }, i) => {
        const r = el.getBoundingClientRect();
        const m = document.createElement('div');
        m.className = 'mark';
        Object.assign(m.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
        const n = document.createElement('div');
        n.className = 'num';
        n.textContent = String(i + 1);
        Object.assign(n.style, { left: `${Math.max(0, r.left - 9)}px`, top: `${Math.max(0, r.top - 9)}px` });
        return [m, n];
      }),
    );
    hint.textContent = marked.length
      ? `${marked.length} marked · Click the last one (or Enter) to finish · Shift+click to mark more or unmark · Esc to cancel`
      : HINT;
  };
  const toggleMark = (el: Element, point: { x: number; y: number } | null) => {
    const i = marked.findIndex((m) => m.el === el);
    if (i >= 0) marked.splice(i, 1);
    else if (marked.length < MAX_MARKED) marked.push({ el, point });
    drawMarks();
  };
  const onScroll = () => marked.length && drawMarks();

  let current: Element | null = null;
  const trail: Element[] = []; // for moving back down after ↑

  const show = (el: Element | null) => {
    current = el;
    if (!el) {
      box.style.display = label.style.display = 'none';
      return;
    }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    label.textContent = `${el.tagName.toLowerCase()} · ${Math.round(r.width)}×${Math.round(r.height)}`;
    Object.assign(label.style, { display: 'block', left: `${Math.max(0, r.left)}px`, top: `${r.top > 22 ? r.top - 20 : r.bottom + 4}px` });
  };

  let pointer: { x: number; y: number } | null = null;
  const onMove = (e: MouseEvent) => {
    pointer = { x: e.clientX, y: e.clientY };
    const el = smallestElementAt(document, e.clientX, e.clientY, host);
    if (el && el !== current) {
      trail.length = 0;
      show(el);
    }
  };

  const finish = async (last: Element | null) => {
    // The whole page (last = null) ignores marks; otherwise the marked elements and then the one clicked last.
    const list = last ? [...marked.filter((m) => m.el !== last), { el: last, point: pointer }].slice(0, MAX_MARKED) : [];
    const el = list[0]?.el ?? null;
    const extra = list.slice(1).map((m) => m.el);
    stop();
    // Let the overlay disappear from the screen before the screenshot is taken.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const element = el ? withCursor(describeElement(el), el, list[0]!.point, document) : undefined;
    if (element && extra.length) element.also = extra.map((x) => describeElement(x));
    // Cover password and card fields for the moment the screenshot is taken.
    const masked = Array.from(document.querySelectorAll('input')).filter(isSensitiveField) as HTMLElement[];
    const before = masked.map((m) => m.style.filter);
    masked.forEach((m) => (m.style.filter = 'blur(8px)'));
    const fromPage = await askRecorder(el, extra);
    element?.also?.forEach((a, i) => {
      const f = fromPage.also?.[i];
      if (f?.components?.length) a.components = f.components;
      if (f?.source) a.source = f.source;
      if (f?.parts?.length) a.parts = f.parts;
      if (f?.framework) a.framework = f.framework;
    });
    if (element && fromPage.component) element.component = fromPage.component;
    if (element && fromPage.components?.length) element.components = fromPage.components;
    if (element && fromPage.source) element.source = fromPage.source;
    if (element && fromPage.parts?.length) element.parts = fromPage.parts;
    if (element && fromPage.framework) element.framework = fromPage.framework;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await chrome.runtime.sendMessage({
      type: 'element-picked',
      element: element && redactElement(element),
      // Without the recorder, failed requests still come from the browser's request history.
      // Slow requests that did work come from the history on every site (a "too slow" bug has no error).
      pageLogs: [...(fromPage.recorder ? fromPage.logs : failedRequestsFromHistory(window)), ...slowRequestsFromHistory(window)].map(redactLog),
      recorder: fromPage.recorder,
      // Only the record's shape, rebuilt from fixed patterns; the page's real values never get here.
      record: el ? fromPage.record : undefined,
      // The user's last few actions on this page (only where the recorder runs).
      pageSteps: fromPage.steps ?? [],
      page: {
        url: redactUrl(location.href),
        title: redactText(document.title),
        viewport: { width: innerWidth, height: innerHeight },
      },
    }).catch(() => {});
    masked.forEach((m, i) => (m.style.filter = before[i] ?? ''));
  };

  const swallow = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };

  const onClick = (e: MouseEvent) => {
    swallow(e);
    pointer = { x: e.clientX, y: e.clientY };
    const el = current ?? smallestElementAt(document, e.clientX, e.clientY, host);
    // Shift+click marks one more element for the same note (like a batch), and keeps picking.
    if (e.shiftKey && el) toggleMark(el, pointer);
    else finish(el);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      swallow(e);
      cancel();
    } else if ((e.key === 'w' || e.key === 'W') && !e.metaKey && !e.ctrlKey && !e.altKey) {
      swallow(e);
      finish(null);
    } else if (e.key === 'ArrowUp' && current?.parentElement && current.parentElement !== document.documentElement) {
      swallow(e);
      trail.push(current);
      show(current.parentElement);
    } else if (e.key === 'ArrowDown' && current) {
      swallow(e);
      show(trail.pop() ?? current.firstElementChild ?? current);
    } else if (e.key === 'Enter' && current) {
      swallow(e);
      finish(current);
    }
  };

  const cancel = () => {
    stop();
    chrome.runtime.sendMessage({ type: 'picker-cancelled' }).catch(() => {});
  };

  // The side panel's "Whole page" and "Cancel" buttons.
  const onPanel = (msg: { type?: string; action?: string }) => {
    if (msg?.type !== 'picker-command') return;
    if (msg.action === 'cancel') cancel();
    else if (msg.action === 'whole') finish(null);
  };
  chrome.runtime.onMessage.addListener(onPanel);

  const opts = { capture: true } as const;
  addEventListener('mousemove', onMove, opts);
  addEventListener('click', onClick, opts);
  addEventListener('mousedown', swallow, opts);
  addEventListener('mouseup', swallow, opts);
  addEventListener('keydown', onKey, opts);
  addEventListener('scroll', onScroll, { capture: true, passive: true });

  function stop() {
    removeEventListener('mousemove', onMove, opts);
    removeEventListener('click', onClick, opts);
    removeEventListener('mousedown', swallow, opts);
    removeEventListener('mouseup', swallow, opts);
    removeEventListener('keydown', onKey, opts);
    removeEventListener('scroll', onScroll, { capture: true });
    host.remove();
    chrome.runtime.onMessage.removeListener(onPanel);
    delete (window as unknown as { __darnlyPicker?: unknown }).__darnlyPicker;
  }
  return stop;
}
