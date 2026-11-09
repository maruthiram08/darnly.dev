import type { LogEntry } from '@/lib/logs';
import { findRecordShape, type SeenResponse } from '@/lib/record-shape';
import { sourceInfo } from '@/lib/source-info';
import { addStep, AUTO_STEPS, watchSteps, type Step } from '@/lib/steps';

/**
 * Page recorder. Runs inside the page itself (MAIN world), before the page's own code,
 * because only code there can see console calls and fetch/XHR.
 *
 * It only collects, and never decides or writes: the page can see this code, so redaction
 * happens later in the walled-off picker. It keeps the last 60 seconds or 200 entries in memory;
 * nothing is stored, and it clears when the tab closes.
 * Never recorded: request bodies, headers (so no cookies or Authorization).
 * A failed response keeps a 300-character snippet, which the picker redacts.
 * It also keeps the last 20 JSON responses (under 200 KB each, in memory only) so that at capture it can
 * describe the record behind the picked element by its shape. Only that shape (field names, kinds, lengths,
 * ages, the record id) is handed over; the values never leave the page.
 * It also keeps the user's last few actions (clicked "Save", typed in "Email", opened /settings), never what they typed,
 * so the report can say how they got to the bug.
 */
export default defineContentScript({
  matches: ['http://localhost/*', 'http://127.0.0.1/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const w = window as unknown as { __darnlyRecorder?: boolean };
    if (w.__darnlyRecorder) return;
    w.__darnlyRecorder = true;
    record();
  },
});


const MAX_AGE = 60_000;
const MAX_ENTRIES = 200;
const SNIPPET = 300;
const MAX_JSON = 20;
const MAX_JSON_SIZE = 200_000;

const isJson = (type: string | null) => !!type && /\bjson\b/i.test(type) && !/ndjson|jsonl|event-stream|seq/i.test(type);

/** The text the user saw in the picked element (and, failing that, the row or card around it). */
function textsAround(el: Element): string[] {
  const texts: string[] = [];
  let node: Element | null = el;
  for (let i = 0; node && node !== document.body && i < 5; i++, node = node.parentElement) {
    const own = (node as HTMLElement).innerText ?? node.textContent ?? '';
    // Form fields filled from the record count too (never password or card fields).
    const values = Array.from(node.querySelectorAll('input:not([type=password]):not([type=hidden]),textarea'))
      .filter((f) => !/cc-|card|cvc|cvv|password/i.test(`${f.getAttribute('name')} ${f.getAttribute('autocomplete')} ${f.id}`))
      .map((f) => (f as HTMLInputElement).value)
      .slice(0, 30);
    const text = [own, ...values].join('\n');
    // Past this size it's a whole table or page, and any record would match.
    if (text.length > 2000) break;
    if (texts.at(-1) !== text) texts.push(text);
  }
  return texts;
}

function record() {
  const buffer: LogEntry[] = [];
  const push = (e: Omit<LogEntry, 't'>) => {
    buffer.push({ t: Date.now(), ...e });
    if (buffer.length > MAX_ENTRIES) buffer.shift();
  };
  const responses: SeenResponse[] = [];
  const keep = (method: string, url: string, body: unknown) => {
    responses.push({ t: Date.now(), method, url, body });
    if (responses.length > MAX_JSON) responses.shift();
  };
  let steps: Step[] = [];
  watchSteps(window, (st) => {
    steps = addStep(steps, { t: Date.now(), ...st }, AUTO_STEPS * 2);
  });
  const fresh = () => {
    const cutoff = Date.now() - MAX_AGE;
    return buffer.filter((e) => e.t >= cutoff);
  };

  const str = (v: unknown): string => {
    if (v instanceof Error) return `${v.name}: ${v.message}`;
    if (typeof v === 'string') return v;
    try {
      return JSON.stringify(v)?.slice(0, 500) ?? String(v);
    } catch {
      return String(v);
    }
  };

  for (const level of ['error', 'warn'] as const) {
    const original = console[level];
    console[level] = function (...args: unknown[]) {
      try {
        const err = args.find((a) => a instanceof Error) as Error | undefined;
        push({ kind: 'console', level, message: args.map(str).join(' ').slice(0, 1000), stack: err?.stack?.slice(0, 1500) });
      } catch {
        /* never break the page */
      }
      return original.apply(this, args);
    };
  }

  addEventListener('error', (e) => {
    if (e instanceof ErrorEvent) {
      push({ kind: 'error', message: e.message, stack: (e.error as Error | undefined)?.stack?.slice(0, 1500) ?? `${e.filename}:${e.lineno}:${e.colno}` });
    }
  });
  addEventListener('unhandledrejection', (e) => {
    const r = e.reason as unknown;
    push({ kind: 'rejection', message: `Unhandled promise rejection: ${str(r)}`.slice(0, 1000), stack: (r as Error)?.stack?.slice(0, 1500) });
  });

  const originalFetch = window.fetch;
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    const start = performance.now();
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const url = input instanceof Request ? input.url : String(input);
    try {
      const res = await originalFetch.call(this, input, init);
      try {
        const size = Number(res.headers.get('content-length') ?? 0);
        if (res.ok && res.body && isJson(res.headers.get('content-type')) && size <= MAX_JSON_SIZE) {
          const href = new URL(url, location.href).href;
          res.clone().text().then(
            (text) => {
              if (text.length <= MAX_JSON_SIZE) keep(method, href, JSON.parse(text));
            },
            () => {},
          ).catch(() => {});
        }
      } catch {
        /* never break the page */
      }
      if (res.status >= 400) {
        const entry = { kind: 'request' as const, method, url: new URL(url, location.href).href, status: res.status, ms: Math.round(performance.now() - start) };
        res.clone().text().then(
          (body) => push({ ...entry, snippet: body.slice(0, SNIPPET) }),
          () => push(entry),
        );
      }
      return res;
    } catch (err) {
      push({ kind: 'request', method, url: new URL(url, location.href).href, status: 0, ms: Math.round(performance.now() - start), message: str(err) });
      throw err;
    }
  };

  const XHR = XMLHttpRequest.prototype;
  const open = XHR.open;
  const send = XHR.send;
  XHR.open = function (this: XMLHttpRequest & { __d?: { method: string; url: string } }, method: string, url: string | URL, ...rest: unknown[]) {
    this.__d = { method: method.toUpperCase(), url: new URL(String(url), location.href).href };
    return (open as (...a: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof XHR.open;
  XHR.send = function (this: XMLHttpRequest & { __d?: { method: string; url: string } }, body?: Document | XMLHttpRequestBodyInit | null) {
    const start = performance.now();
    this.addEventListener('loadend', () => {
      try {
        if (this.__d && this.status >= 200 && this.status < 300 && isJson(this.getResponseHeader('content-type'))) {
          if (this.responseType === 'json' && this.response && JSON.stringify(this.response).length <= MAX_JSON_SIZE) keep(this.__d.method, this.__d.url, this.response);
          else if ((this.responseType === '' || this.responseType === 'text') && this.responseText.length <= MAX_JSON_SIZE) keep(this.__d.method, this.__d.url, JSON.parse(this.responseText));
        }
      } catch {
        /* not JSON after all */
      }
      if (!this.__d || (this.status > 0 && this.status < 400)) return;
      let snippet: string | undefined;
      try {
        snippet = (this.responseType === '' || this.responseType === 'text' ? this.responseText : '').slice(0, SNIPPET) || undefined;
      } catch {
        /* binary response */
      }
      push({ kind: 'request', ...this.__d, status: this.status, ms: Math.round(performance.now() - start), snippet });
    });
    return send.call(this, body);
  };

  // The picker asks for the buffer (and the component and file that drew the picked element: React, Vue or Svelte dev info) with a one-time id.
  addEventListener('message', (e) => {
    const d = e.data as { darnly?: string; id?: string } | null;
    if (e.source !== window || d?.darnly !== 'get-logs' || !d.id) return;
    const picked = document.querySelector('[data-darnly-picked]');
    const info = picked ? sourceInfo(picked) : undefined;
    // More elements marked for the same bug (Shift+click), in their marked order.
    const also = Array.from(document.querySelectorAll('[data-darnly-also]'))
      .sort((x, y) => Number(x.getAttribute('data-darnly-also')) - Number(y.getAttribute('data-darnly-also')))
      .slice(0, 8)
      .map((x) => {
        const i = sourceInfo(x);
        return { components: i?.chain, source: i?.source, parts: i?.parts, framework: i?.framework };
      });
    let record;
    try {
      record = picked && responses.length ? findRecordShape(responses, textsAround(picked)) : undefined;
    } catch {
      /* never break the capture */
    }
    window.postMessage({ darnly: 'logs', id: d.id, logs: fresh(), component: info?.chain.at(-1), components: info?.chain, source: info?.source, parts: info?.parts, framework: info?.framework, also, record, steps }, '*');
  });
}
