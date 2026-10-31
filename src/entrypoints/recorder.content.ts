import type { LogEntry } from '@/lib/logs';

/**
 * Page recorder. Runs inside the page itself (MAIN world), before the page's own code,
 * because only code there can see console calls and fetch/XHR.
 *
 * It only collects, and never decides or writes: the page can see this code, so redaction
 * happens later in the walled-off picker. It keeps the last 60 seconds or 200 entries in memory;
 * nothing is stored, and it clears when the tab closes.
 * Never recorded: request bodies, headers (so no cookies or Authorization).
 * A failed response keeps a 300-character snippet, which the picker redacts.
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

function record() {
  const buffer: LogEntry[] = [];
  const push = (e: Omit<LogEntry, 't'>) => {
    buffer.push({ t: Date.now(), ...e });
    if (buffer.length > MAX_ENTRIES) buffer.shift();
  };
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

  // The picker asks for the buffer (and the React component of the picked element) with a one-time id.
  addEventListener('message', (e) => {
    const d = e.data as { darnly?: string; id?: string } | null;
    if (e.source !== window || d?.darnly !== 'get-logs' || !d.id) return;
    const picked = document.querySelector('[data-darnly-picked]');
    const info = picked ? componentInfo(picked) : undefined;
    window.postMessage({ darnly: 'logs', id: d.id, logs: fresh(), component: info?.chain.at(-1), components: info?.chain, source: info?.source }, '*');
  });
}

type Fiber = { type?: unknown; return?: Fiber; _debugSource?: { fileName?: string; lineNumber?: number }; _debugStack?: { stack?: string } };

function fiberName(f: Fiber): string | undefined {
  const t = f.type as { displayName?: string; name?: string } | string | undefined;
  const name = t && typeof t !== 'string' ? t.displayName || t.name : undefined;
  return name && /^[A-Z]/.test(name) && !/^(Fragment|Suspense|StrictMode|Provider|Consumer|Context|ErrorBoundary|Router|Layout(Router)?|InnerLayoutRouter|OuterLayoutRouter|RenderFromTemplateContext|ScrollAndFocusHandler|RedirectBoundary|NotFoundBoundary|LoadingBoundary|HTTPAccessFallbackBoundary)/.test(name) ? name : undefined;
}

/** A path inside the user's own code, from React's dev info (React 18: _debugSource, React 19: _debugStack). */
function sourceOf(f: Fiber): string | undefined {
  const ds = f._debugSource;
  if (ds?.fileName) return `${ds.fileName.replace(/^.*?\/(src|app|components|pages)\//, '$1/')}${ds.lineNumber ? `:${ds.lineNumber}` : ''}`;
  for (const line of (f._debugStack?.stack ?? '').split('\n').slice(1)) {
    if (/node_modules|react-dom|react-server|next\/dist|chunk-/.test(line)) continue;
    const m = line.match(/((?:src|app|components|pages|lib)\/[\w./@\[\]()-]+\.(?:tsx|jsx|ts|js))(?:\?[^:)]*)?(?::(\d+))?/);
    if (m) return m[2] ? `${m[1]}:${m[2]}` : m[1];
  }
  return undefined;
}

/**
 * In React dev builds: the components that drew the element (outermost first, at most 4)
 * and the file of the nearest one. Production builds strip all of this, so it is simply absent there.
 */
function componentInfo(el: Element): { chain: string[]; source?: string } | undefined {
  // Some dev tools (react-dev-inspector, LocatorJS-style plugins) write the file path on the element itself.
  const attr = el.closest('[data-inspector-relative-path],[data-source-file]');
  const attrSource = attr
    ? `${attr.getAttribute('data-inspector-relative-path') ?? attr.getAttribute('data-source-file')}${attr.getAttribute('data-inspector-line') ? `:${attr.getAttribute('data-inspector-line')}` : ''}`
    : undefined;
  let node: Element | null = el;
  for (let i = 0; node && i < 10; i++, node = node.parentElement) {
    const key = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
    if (!key) continue;
    let fiber = (node as unknown as Record<string, Fiber>)[key] as Fiber | undefined;
    const chain: string[] = [];
    let source: string | undefined;
    for (let guard = 0; fiber && guard < 200 && chain.length < 4; guard++, fiber = fiber.return) {
      const name = fiberName(fiber);
      if (!name) continue;
      if (chain[0] !== name) chain.unshift(name);
      source ??= sourceOf(fiber);
    }
    return chain.length ? { chain, source: attrSource ?? source } : attrSource ? { chain: [], source: attrSource } : undefined;
  }
  return attrSource ? { chain: [], source: attrSource } : undefined;
}
