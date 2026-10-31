import { describeElement, failedRequestsFromHistory, isSensitiveField, smallestElementAt, withCursor, type ElementInfo } from '@/lib/element-info';
import type { LogEntry } from '@/lib/logs';
import { redactLog } from '@/lib/logs';
import { redactText, redactUrl } from '@/lib/redact';

/** Asks the page recorder (if it runs on this site) for its last 60 seconds, and the React component of the picked element. */
function askRecorder(el: Element | null): Promise<{ logs: LogEntry[]; component?: string; recorder: boolean }> {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    el?.setAttribute('data-darnly-picked', '');
    const done = (r: { logs: LogEntry[]; component?: string; recorder: boolean }) => {
      removeEventListener('message', onMessage);
      el?.removeAttribute('data-darnly-picked');
      resolve(r);
    };
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { darnly?: string; id?: string; logs?: LogEntry[]; component?: string } | null;
      if (e.source === window && d?.darnly === 'logs' && d.id === id) {
        done({ logs: Array.isArray(d.logs) ? d.logs.slice(-200) : [], component: typeof d.component === 'string' ? d.component : undefined, recorder: true });
      }
    };
    addEventListener('message', onMessage);
    window.postMessage({ darnly: 'get-logs', id }, '*');
    setTimeout(() => done({ logs: [], recorder: false }), 300);
  });
}

function redactElement(info: ElementInfo): ElementInfo {
  return {
    ...info,
    text: redactText(info.text),
    html: redactText(info.html),
    atCursor: info.atCursor && { ...info.atCursor, text: redactText(info.atCursor.text), html: redactText(info.atCursor.html) },
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

function start(): () => void {
  const host = document.createElement('darnly-picker');
  host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      .box { position: fixed; border: 2px solid #e11d48; background: rgba(225,29,72,.08); border-radius: 2px; pointer-events: none; transition: all 40ms; }
      .label { position: fixed; background: #e11d48; color: #fff; font: 600 11px/1.6 system-ui, sans-serif; padding: 0 6px; border-radius: 3px; pointer-events: none; white-space: nowrap; }
      .hint { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); background: #111827; color: #fff; font: 13px/1.4 system-ui, sans-serif; padding: 8px 14px; border-radius: 999px; pointer-events: none; box-shadow: 0 4px 16px rgba(0,0,0,.25); }
    </style>
    <div class="box"></div><div class="label"></div>
    <div class="hint">Click the broken part · ↑ ↓ bigger or smaller · Esc for the whole page</div>`;
  document.documentElement.appendChild(host);
  const box = shadow.querySelector<HTMLDivElement>('.box')!;
  const label = shadow.querySelector<HTMLDivElement>('.label')!;

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

  const finish = async (el: Element | null) => {
    stop();
    // Let the overlay disappear from the screen before the screenshot is taken.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const element = el ? withCursor(describeElement(el), el, pointer, document) : undefined;
    // Cover password and card fields for the moment the screenshot is taken.
    const masked = Array.from(document.querySelectorAll('input')).filter(isSensitiveField) as HTMLElement[];
    const before = masked.map((m) => m.style.filter);
    masked.forEach((m) => (m.style.filter = 'blur(8px)'));
    const fromPage = await askRecorder(el);
    if (element && fromPage.component) element.component = fromPage.component;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await chrome.runtime.sendMessage({
      type: 'element-picked',
      element: element && redactElement(element),
      // Without the recorder, failed requests still come from the browser's request history.
      pageLogs: (fromPage.recorder ? fromPage.logs : failedRequestsFromHistory(window)).map(redactLog),
      recorder: fromPage.recorder,
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
    finish(current ?? smallestElementAt(document, e.clientX, e.clientY, host));
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
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

  const opts = { capture: true } as const;
  addEventListener('mousemove', onMove, opts);
  addEventListener('click', onClick, opts);
  addEventListener('mousedown', swallow, opts);
  addEventListener('mouseup', swallow, opts);
  addEventListener('keydown', onKey, opts);

  function stop() {
    removeEventListener('mousemove', onMove, opts);
    removeEventListener('click', onClick, opts);
    removeEventListener('mousedown', swallow, opts);
    removeEventListener('mouseup', swallow, opts);
    removeEventListener('keydown', onKey, opts);
    host.remove();
    delete (window as unknown as { __darnlyPicker?: unknown }).__darnlyPicker;
  }
  return stop;
}
