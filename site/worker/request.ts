// POST /api/request: sends one API request for the API tester at /tools/api-tester/.
//
// The visitor's browser posts { method, url, headers: [[name, value]], body } as JSON. We send it on
// and hand back the status, timing, size, headers and (text) body. Guards:
// - public http(s) addresses only, checked again on every redirect (up to 5);
// - its own rate limit, a 10 second timeout, a 1 MB response limit and a 200 KB request body limit;
// - Cookie and proxy/forwarding headers are dropped, and the visitor's own cookies never reach us
//   (the page sends credentials: 'omit');
// - nothing is cached, logged or stored.

export type RequestDeps = {
  checkTarget(raw: string): URL | string;
  isOwnHost(target: URL): boolean;
  ownPage(target: URL): Promise<Response>;
  limit?: { limit(o: { key: string }): Promise<{ success: boolean }> };
};

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const MAX_IN = 200_000;
const MAX_OUT = 1_000_000;
const TIMEOUT_MS = 10_000;
const UA = 'DarnlyAPITester/1.0 (+https://darnly.dev/tools/api-tester/)';

// Headers we never pass on: cookies, hop-by-hop headers and anything that could spoof who is asking.
const BLOCKED = new Set([
  'cookie', 'cookie2', 'host', 'content-length', 'connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer',
  'upgrade', 'forwarded', 'x-real-ip', 'true-client-ip', 'cdn-loop', 'via', 'expect',
]);
const BLOCKED_PREFIX = ['proxy-', 'cf-', 'x-forwarded-', 'sec-'];

export function isBlockedHeader(name: string): boolean {
  const n = name.toLowerCase();
  return BLOCKED.has(n) || BLOCKED_PREFIX.some((p) => n.startsWith(p));
}

type Input = { method?: unknown; url?: unknown; headers?: unknown; body?: unknown };

export async function sendRequest(req: Request, deps: RequestDeps): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) return json({ error: 'Send JSON' }, 415);

  const raw = await readBytes(req, MAX_IN + 20_000);
  if (raw.truncated) return json({ error: 'The request body is too big. The limit here is 200 KB.' }, 413);
  let input: Input;
  try {
    input = JSON.parse(new TextDecoder().decode(raw.bytes));
  } catch {
    return json({ error: 'Bad request' }, 400);
  }

  const method = String(input.method ?? 'GET').toUpperCase();
  if (!METHODS.includes(method)) return json({ error: `Pick one of ${METHODS.join(', ')}.` }, 400);

  const target = deps.checkTarget(String(input.url ?? ''));
  if (typeof target === 'string') return json({ error: target }, 400);

  const body = typeof input.body === 'string' && input.body !== '' && method !== 'GET' && method !== 'HEAD' ? input.body : null;
  if (body && new TextEncoder().encode(body).length > MAX_IN) return json({ error: 'The request body is too big. The limit here is 200 KB.' }, 413);

  const headers = new Headers();
  const dropped: string[] = [];
  if (Array.isArray(input.headers)) {
    for (const pair of input.headers.slice(0, 50)) {
      if (!Array.isArray(pair)) continue;
      const name = String(pair[0] ?? '').trim();
      const value = String(pair[1] ?? '');
      if (!name) continue;
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n\0]/.test(value)) {
        return json({ error: `The header “${name.slice(0, 40)}” has characters that aren’t allowed.` }, 400);
      }
      if (isBlockedHeader(name)) {
        if (!dropped.includes(name.toLowerCase())) dropped.push(name.toLowerCase());
        continue;
      }
      try {
        headers.append(name, value);
      } catch {
        return json({ error: `The header “${name.slice(0, 40)}” has a value that isn’t allowed.` }, 400);
      }
    }
  }
  if (!headers.has('user-agent')) headers.set('user-agent', UA);
  if (!headers.has('accept')) headers.set('accept', '*/*');

  if (deps.limit) {
    const { success } = await deps.limit.limit({ key: req.headers.get('cf-connecting-ip') ?? 'unknown' });
    if (!success) return json({ error: 'You can send 20 requests a minute. Wait a moment and try again.' }, 429);
  }

  const started = Date.now();
  const redirects: { status: number; url: string }[] = [];
  let url = target;
  let m = method;
  let b = body;
  let res: Response;
  try {
    for (let hop = 0; ; hop++) {
      if (deps.isOwnHost(url)) {
        if (m !== 'GET' && m !== 'HEAD') return json({ error: 'darnly.dev itself only answers GET requests here.' }, 400);
        res = await deps.ownPage(url);
        break;
      }
      res = await fetch(url.href, { method: m, headers, body: b, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!loc || hop >= 5) break;
      let next: URL | string;
      try {
        next = deps.checkTarget(new URL(loc, url).href);
      } catch {
        break;
      }
      if (typeof next === 'string') break; // show the redirect itself rather than follow it somewhere private
      res.body?.cancel().catch(() => {});
      redirects.push({ status: res.status, url: url.href });
      // Like browsers: 303 always becomes GET, and 301/302 turn a POST into GET.
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && m === 'POST')) {
        m = m === 'HEAD' ? 'HEAD' : 'GET';
        b = null;
        headers.delete('content-type');
      }
      // Don't send credentials to a different host.
      if (next.host !== url.host) headers.delete('authorization');
      url = next;
    }
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return json(
      {
        error: timedOut
          ? 'The API didn’t answer within 10 seconds.'
          : 'We couldn’t reach that address. Check the spelling, and that the API is public on the internet.',
        kind: timedOut ? 'timeout' : 'network',
        ms: Date.now() - started,
      },
      200, // the tool itself worked; the page shows this as a failed request without a console error
    );
  }
  const ttfb = Date.now() - started;
  const out = m === 'HEAD' ? { bytes: new Uint8Array(), truncated: false, size: 0 } : await readBytes(res, MAX_OUT);
  const ms = Date.now() - started;

  const type = res.headers.get('content-type') ?? '';
  const text = isText(type, out.bytes);
  const resHeaders: [string, string][] = [];
  res.headers.forEach((v, k) => resHeaders.push([k, v]));

  return json({
    method: m,
    url: url.href,
    redirects,
    status: res.status,
    statusText: res.statusText,
    ms,
    ttfb,
    size: out.size,
    truncated: out.truncated,
    contentType: type,
    headers: resHeaders,
    body: text ? new TextDecoder().decode(out.bytes) : null,
    binary: !text,
    dropped,
  });
}

function isText(type: string, bytes: Uint8Array): boolean {
  if (/json|text\/|xml|javascript|html|csv|yaml|x-www-form-urlencoded|graphql/i.test(type)) return true;
  if (type && !/octet-stream/i.test(type)) return false;
  // No useful type: look for zero bytes in the start.
  return !bytes.subarray(0, 2000).includes(0);
}

async function readBytes(res: Request | Response, max: number): Promise<{ bytes: Uint8Array; truncated: boolean; size: number }> {
  if (!res.body) return { bytes: new Uint8Array(), truncated: false, size: 0 };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (size > max) {
      truncated = true;
      break;
    }
  }
  reader.cancel().catch(() => {});
  const out = new Uint8Array(Math.min(size, max));
  let at = 0;
  for (const c of chunks) {
    const part = c.subarray(0, out.length - at);
    out.set(part, at);
    at += part.length;
    if (at >= out.length) break;
  }
  return { bytes: out, truncated, size: Math.min(size, max) };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}
