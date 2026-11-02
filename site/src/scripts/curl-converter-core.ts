// curl converter: a small curl parser and code writers. Runs in the browser; nothing is sent anywhere.

export type Header = { name: string; value: string };
export type FormField = { name: string; value: string; file: boolean };
export type Body =
  | { kind: 'none' }
  | { kind: 'json'; text: string; value: unknown }
  | { kind: 'urlencoded'; text: string; fields: [string, string][] }
  | { kind: 'raw'; text: string }
  | { kind: 'multipart'; fields: FormField[] };

export type Request = {
  method: string;
  url: string;
  headers: Header[];
  body: Body;
  basic: { user: string; pass: string } | null;
  insecure: boolean;
  notes: string[]; // things to tell the visitor (ignored flags, files, guesses)
};

export class CurlError extends Error {}

// ---------- Shell words ----------

// Splits a pasted command into words the way a shell would: quotes, escapes and line continuations
// (\ on Mac/Linux, ^ in Windows cmd, ` in PowerShell).
export function shellWords(input: string): string[] {
  let s = input.replace(/\r\n?/g, '\n');
  s = s.replace(/^\s*\$\s+/, ''); // "$ curl ..." copied from docs
  s = s.replace(/[\\^`][ \t]*\n/g, ' ');
  // Chrome's "Copy as cURL (cmd)" escapes with ^: ^" is a quote and ^\^" a quote inside a quote.
  if (/\^"/.test(s)) s = s.replace(/\^(.)/g, '$1');
  const words: string[] = [];
  let cur = '';
  let has = false;
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\n') {
      if (has) words.push(cur);
      cur = '';
      has = false;
      i++;
      continue;
    }
    has = true;
    if (c === "'") {
      const end = s.indexOf("'", i + 1);
      if (end < 0) throw new CurlError('A single quote (\') is never closed. Check that every \' has a partner.');
      cur += s.slice(i + 1, end);
      i = end + 1;
    } else if (c === '$' && s[i + 1] === "'") {
      // $'...' with \n, \t, \', \\ escapes
      i += 2;
      while (i < n && s[i] !== "'") {
        if (s[i] === '\\' && i + 1 < n) {
          const e = s[i + 1];
          cur += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e;
          i += 2;
        } else cur += s[i++];
      }
      if (i >= n) throw new CurlError("A $' quote is never closed.");
      i++;
    } else if (c === '"') {
      i++;
      while (i < n && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < n && '"\\$`\n'.includes(s[i + 1])) {
          if (s[i + 1] !== '\n') cur += s[i + 1];
          i += 2;
        } else cur += s[i++];
      }
      if (i >= n) throw new CurlError('A double quote (") is never closed. Check that every " has a partner.');
      i++;
    } else if (c === '\\' && i + 1 < n) {
      cur += s[i + 1];
      i += 2;
    } else {
      cur += c;
      i++;
    }
  }
  if (has) words.push(cur);
  return words;
}

// ---------- curl options ----------

const WITH_VALUE: Record<string, string> = {
  '-X': 'request', '--request': 'request',
  '-H': 'header', '--header': 'header',
  '-d': 'data', '--data': 'data', '--data-ascii': 'data', '--data-binary': 'data-binary', '--data-raw': 'data-raw',
  '--data-urlencode': 'data-urlencode', '--json': 'json',
  '-F': 'form', '--form': 'form', '--form-string': 'form-string',
  '-u': 'user', '--user': 'user',
  '-b': 'cookie', '--cookie': 'cookie',
  '-A': 'user-agent', '--user-agent': 'user-agent',
  '-e': 'referer', '--referer': 'referer',
  '--url': 'url', '--oauth2-bearer': 'bearer',
  // Ones we read but don't turn into code:
  '-o': 'skip', '--output': 'skip', '-m': 'skip', '--max-time': 'skip', '--connect-timeout': 'skip',
  '-w': 'skip', '--write-out': 'skip', '--retry': 'skip', '-x': 'skip', '--proxy': 'skip', '--cacert': 'skip',
  '--cert': 'skip', '--key': 'skip', '-c': 'skip', '--cookie-jar': 'skip', '-r': 'skip', '--range': 'skip',
  '-T': 'upload', '--upload-file': 'upload', '--resolve': 'skip', '--limit-rate': 'skip', '-K': 'skip', '--config': 'skip',
};
const FLAGS: Record<string, string> = {
  '-G': 'get', '--get': 'get', '-I': 'head', '--head': 'head', '-k': 'insecure', '--insecure': 'insecure',
  '-L': 'ok', '--location': 'ok', '-s': 'ok', '--silent': 'ok', '-S': 'ok', '--show-error': 'ok', '-v': 'ok',
  '--verbose': 'ok', '-i': 'ok', '--include': 'ok', '--compressed': 'ok', '-f': 'ok', '--fail': 'ok',
  '--fail-with-body': 'ok', '-N': 'ok', '--no-buffer': 'ok', '-O': 'ok', '--remote-name': 'ok', '-#': 'ok',
  '--progress-bar': 'ok', '--http1.1': 'ok', '--http2': 'ok', '-g': 'ok', '--globoff': 'ok', '-n': 'ok', '--netrc': 'ok',
};

function headerOf(line: string): Header | null {
  const at = line.indexOf(':');
  if (at <= 0) return null;
  return { name: line.slice(0, at).trim(), value: line.slice(at + 1).trim() };
}

const findHeader = (h: Header[], name: string) => h.find((x) => x.name.toLowerCase() === name.toLowerCase());
function setHeader(h: Header[], name: string, value: string, replace = true) {
  const found = findHeader(h, name);
  if (found) {
    if (replace) found.value = value;
  } else h.push({ name, value });
}

export function parseCurl(input: string): Request {
  const words = shellWords(input.trim());
  if (!words.length) throw new CurlError('Paste a curl command to start.');
  let k = 0;
  if (/^(Invoke-WebRequest|Invoke-RestMethod|iwr|irm)$/i.test(words[0]))
    throw new CurlError('This is a PowerShell command, not curl. In Chrome DevTools, right-click the request and pick Copy > Copy as cURL (bash).');
  if (/^curl(\.exe)?$/i.test(words[0])) k = 1;
  else if (words[0].startsWith('-') || /^https?:/i.test(words[0])) k = 0;
  else throw new CurlError(`This doesn't look like a curl command: it starts with "${words[0].slice(0, 30)}". Paste the whole line, starting with curl.`);

  let method = '';
  let url = '';
  const headers: Header[] = [];
  const data: { text: string; how: 'data' | 'raw' | 'binary' | 'encode' }[] = [];
  const form: FormField[] = [];
  let json = false;
  let get = false;
  let head = false;
  let insecure = false;
  let basic: Request['basic'] = null;
  const notes: string[] = [];
  const unknown: string[] = [];
  const cookies: string[] = [];
  let upload = '';

  const apply = (kind: string, v: string, flag: string) => {
    switch (kind) {
      case 'request': method = v.toUpperCase(); break;
      case 'header': {
        const h = headerOf(v);
        if (h) {
          if (h.value === '' && v.trim().endsWith(':')) {
            // "-H 'Accept:'" removes a header in curl; nothing to send.
            const i = headers.findIndex((x) => x.name.toLowerCase() === h.name.toLowerCase());
            if (i >= 0) headers.splice(i, 1);
          } else headers.push(h);
        } else if (v.trim().endsWith(';')) headers.push({ name: v.trim().slice(0, -1), value: '' });
        else notes.push(`Skipped the header "${v}": a header needs a name, a colon and a value.`);
        break;
      }
      case 'data': data.push({ text: v, how: 'data' }); break;
      case 'data-raw': data.push({ text: v, how: 'raw' }); break;
      case 'data-binary': data.push({ text: v, how: 'binary' }); break;
      case 'data-urlencode': data.push({ text: v, how: 'encode' }); break;
      case 'json': json = true; data.push({ text: v, how: 'raw' }); break;
      case 'form':
      case 'form-string': {
        const at = v.indexOf('=');
        if (at <= 0) { notes.push(`Skipped the form field "${v}": it needs name=value.`); break; }
        const name = v.slice(0, at);
        let value = v.slice(at + 1);
        const file = kind === 'form' && (value.startsWith('@') || value.startsWith('<'));
        if (file) value = value.slice(1).split(';')[0];
        form.push({ name, value, file });
        break;
      }
      case 'user': {
        const at = v.indexOf(':');
        basic = at < 0 ? { user: v, pass: '' } : { user: v.slice(0, at), pass: v.slice(at + 1) };
        break;
      }
      case 'cookie':
        if (v.includes('=')) cookies.push(v);
        else notes.push(`curl reads cookies from the file "${v}". Add a Cookie header by hand if you need them.`);
        break;
      case 'user-agent': setHeader(headers, 'User-Agent', v); break;
      case 'referer': setHeader(headers, 'Referer', v); break;
      case 'url': url = v; break;
      case 'bearer': setHeader(headers, 'Authorization', `Bearer ${v}`); break;
      case 'upload': upload = v; break;
      case 'get': get = true; break;
      case 'head': head = true; break;
      case 'insecure': insecure = true; break;
      case 'skip': notes.push(`Left out ${flag}: it changes how curl saves or times the request, not what is sent.`); break;
      case 'ok': break;
    }
  };

  for (; k < words.length; k++) {
    const w = words[k];
    if (w === '--') { if (words[k + 1] && !url) url = words[++k]; continue; }
    if (w.startsWith('--')) {
      const eq = w.indexOf('=');
      const name = eq > 0 ? w.slice(0, eq) : w;
      if (WITH_VALUE[name]) {
        const v = eq > 0 ? w.slice(eq + 1) : words[++k];
        if (v === undefined) throw new CurlError(`${name} needs a value after it.`);
        apply(WITH_VALUE[name], v, name);
      } else if (FLAGS[name]) apply(FLAGS[name], '', name);
      else unknown.push(name);
      continue;
    }
    if (w.startsWith('-') && w.length > 1) {
      // Short flags can be joined (-sSL) and a value can be stuck on (-XPOST, -H'Accept: x').
      for (let j = 1; j < w.length; j++) {
        const f = '-' + w[j];
        if (WITH_VALUE[f]) {
          const rest = w.slice(j + 1);
          const v = rest !== '' ? rest : words[++k];
          if (v === undefined) throw new CurlError(`${f} needs a value after it.`);
          apply(WITH_VALUE[f], v, f);
          break;
        }
        if (FLAGS[f]) apply(FLAGS[f], '', f);
        else unknown.push(f);
      }
      continue;
    }
    if (!url) url = w;
    else notes.push(`Only the first address is used; "${w.slice(0, 60)}" was left out.`);
  }

  if (!url) throw new CurlError('There is no address (URL) in this command. Add one, like https://api.example.com/v1/items.');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    url = 'https://' + url;
    notes.push('The address had no http:// or https://, so https:// was added.');
  }
  try { new URL(url); } catch { throw new CurlError(`"${url.slice(0, 80)}" isn't a valid address.`); }
  if (unknown.length) notes.push(`Ignored options this tool doesn't turn into code: ${[...new Set(unknown)].join(', ')}.`);
  if (cookies.length) setHeader(headers, 'Cookie', cookies.join('; '));
  if (insecure) notes.push('-k turns off HTTPS certificate checks. The code below keeps them on, which is what you want outside local testing.');
  if (upload) notes.push(`-T uploads the file "${upload}". Read that file in your code and send it as the body.`);

  // Body
  let body: Body = { kind: 'none' };
  const fileData = data.filter((d) => d.how !== 'raw' && d.text.startsWith('@'));
  if (fileData.length) notes.push(`The body comes from the file ${fileData.map((d) => `"${d.text.slice(1)}"`).join(', ')}. Replace the placeholder with that file's contents.`);
  const parts = data.map((d) => {
    if (d.how === 'encode') {
      const at = d.text.indexOf('=');
      if (at < 0) return encodeURIComponent(d.text);
      return (at > 0 ? d.text.slice(0, at) + '=' : '') + encodeURIComponent(d.text.slice(at + 1));
    }
    if (d.how !== 'raw' && d.text.startsWith('@')) return `<contents of ${d.text.slice(1)}>`;
    return d.how === 'data' ? d.text.replace(/[\r\n]/g, '') : d.text;
  });

  if (json) {
    setHeader(headers, 'Content-Type', 'application/json', false);
    setHeader(headers, 'Accept', 'application/json', false);
  }

  if (get && parts.length) {
    const u = new URL(url);
    u.search = (u.search ? u.search.slice(1) + '&' : '') + parts.join('&');
    url = u.toString();
  } else if (form.length) {
    body = { kind: 'multipart', fields: form };
    if (data.length) notes.push('Both -d and -F were given; curl refuses that, so only the -F form fields are used.');
  } else if (parts.length) {
    const text = parts.join(data.some((d) => d.how === 'raw' || d.how === 'binary') && parts.length === 1 ? '' : '&');
    const ct = findHeader(headers, 'Content-Type')?.value.toLowerCase() ?? '';
    const looksJson = /^\s*[[{]/.test(text);
    let parsed: unknown;
    let ok = false;
    if (ct.includes('json') || (!ct && looksJson)) {
      try { parsed = JSON.parse(text); ok = true; } catch { /* keep as raw text */ }
    }
    if (ok) {
      body = { kind: 'json', text, value: parsed };
      if (!ct) {
        setHeader(headers, 'Content-Type', 'application/json');
        notes.push('The body is JSON but the command has no Content-Type header. curl would send it as a form, which most APIs reject, so Content-Type: application/json was added.');
      }
    } else if ((!ct || ct.includes('x-www-form-urlencoded')) && /^[^=&\s]+=/.test(text) && !looksJson) {
      const fields: [string, string][] = text.split('&').filter(Boolean).map((p) => {
        const at = p.indexOf('=');
        const dec = (x: string) => { try { return decodeURIComponent(x.replace(/\+/g, ' ')); } catch { return x; } };
        return at < 0 ? [dec(p), ''] : [dec(p.slice(0, at)), dec(p.slice(at + 1))];
      });
      body = { kind: 'urlencoded', text, fields };
      if (!ct) setHeader(headers, 'Content-Type', 'application/x-www-form-urlencoded');
    } else {
      body = { kind: 'raw', text };
      if (ct.includes('json')) notes.push("The body says it's JSON but isn't valid JSON. It's sent as plain text, exactly as written.");
    }
  }

  if (!method) method = head ? 'HEAD' : body.kind !== 'none' ? 'POST' : upload ? 'PUT' : 'GET';
  return { method, url, headers, body, basic, insecure, notes };
}

// ---------- Secrets ----------

const SECRET_NAME = /^(authorization|proxy-authorization|cookie|x-api-key|api-key|apikey|x-auth-token|x-access-token|x-token|x-secret|x-api-secret|x-client-secret|private-token|x-goog-api-key|x-functions-key|ocp-apim-subscription-key)$|(api[-_]?key|secret|token|password|passwd)/i;
const SECRET_QUERY = /^(api[-_]?key|apikey|key|token|access[-_]?token|auth|secret|client[-_]?secret|password|sig|signature)$/i;
const SECRET_VALUE = /^(sk|rk|pk)_(live|test)_|^sk-[A-Za-z0-9_-]{10,}|^gh[pousr]_|^github_pat_|^xox[abpr]-|^AIza[0-9A-Za-z_-]{20,}|^eyJ[A-Za-z0-9_-]+\.|^SG\.|^re_[A-Za-z0-9]{10,}|^glpat-/;

// Public keys that are fine in browser code by design.
const PUBLIC_VALUE = /^pk_(live|test)_|^sb_publishable_/;

export function isSecretHeader(h: Header): boolean {
  const bare = h.value.replace(/^(Bearer|Token|Basic|Bot)\s+/i, '');
  if (PUBLIC_VALUE.test(bare)) return false;
  if (h.name.toLowerCase() === 'apikey' && bare.startsWith('eyJ') && /anon/i.test(atobSafe(bare.split('.')[1] ?? ''))) return false;
  return SECRET_NAME.test(h.name) || SECRET_VALUE.test(bare);
}

function atobSafe(s: string) {
  try { return atob(s.replace(/-/g, '+').replace(/_/g, '/')); } catch { return ''; }
}

export function secretQuery(url: string): string[] {
  try {
    return [...new URL(url).searchParams].filter(([k, v]) => v && (SECRET_QUERY.test(k) || SECRET_VALUE.test(v))).map(([k]) => k);
  } catch {
    return [];
  }
}

// e.g. "api.openai.com" -> "OPENAI"
export function servicePrefix(url: string): string {
  try {
    const parts = new URL(url).hostname.split('.').filter((p) => !/^(www|api|api\d*|v\d+|rest|app|gateway)$/i.test(p));
    let name = parts.length >= 2 ? parts[parts.length - 2] : parts[0] ?? 'API';
    if (/^(co|com|org|net|gov|ac)$/.test(name) && parts.length >= 3) name = parts[parts.length - 3];
    if (/^\d+$/.test(name) || name === 'localhost' || !name) return 'API';
    return name.replace(/[^a-z0-9]+/gi, '_').toUpperCase();
  } catch {
    return 'API';
  }
}

// ---------- Code writers ----------

export type Lang = 'fetch' | 'axios' | 'node' | 'python' | 'next';
export type Env = { name: string; value: string };
type Plan = {
  req: Request;
  env: Env[];
  // header value -> code expression parts
  headers: { name: string; value: string; env?: string; prefix?: string }[];
  url: string;
  urlEnv: { key: string; env: string }[];
  basic: { user: string; pass: string; userEnv?: string; passEnv?: string } | null;
};

// Works out which values become environment variables.
export function plan(req: Request, useEnv: boolean): Plan {
  const prefix = servicePrefix(req.url);
  const env: Env[] = [];
  const add = (suffix: string, value: string) => {
    const existing = env.find((e) => e.value === value);
    if (existing) return existing.name;
    let name = `${prefix}_${suffix}`;
    for (let i = 2; env.some((e) => e.name === name); i++) name = `${prefix}_${suffix}_${i}`;
    env.push({ name, value });
    return name;
  };
  const headers = req.headers.map((h) => {
    if (!useEnv || !isSecretHeader(h) || !h.value) return { ...h };
    const m = /^(Bearer|Token|Basic|Bot)\s+(.+)$/i.exec(h.value);
    const lower = h.name.toLowerCase();
    if (m && lower === 'authorization') {
      const v = add(m[1].toLowerCase() === 'basic' ? 'BASIC_AUTH' : 'API_KEY', m[2]);
      return { ...h, env: v, prefix: m[1] + ' ' };
    }
    const suffix = lower === 'cookie' ? 'COOKIE' : /secret/.test(lower) ? 'SECRET' : /token/.test(lower) ? 'TOKEN' : 'API_KEY';
    return { ...h, env: add(suffix, h.value) };
  });
  const urlEnv: Plan['urlEnv'] = [];
  let url = req.url;
  if (useEnv) {
    for (const key of secretQuery(req.url)) {
      const value = new URL(req.url).searchParams.get(key) ?? '';
      urlEnv.push({ key, env: add(/secret/i.test(key) ? 'SECRET' : /token/i.test(key) ? 'TOKEN' : 'API_KEY', value) });
    }
    if (urlEnv.length) {
      const u = new URL(req.url);
      for (const q of urlEnv) u.searchParams.delete(q.key);
      url = u.toString();
    }
  }
  let basic: Plan['basic'] = null;
  if (req.basic) {
    basic = { ...req.basic };
    if (useEnv) {
      if (req.basic.pass) {
        basic.userEnv = add('USER', req.basic.user);
        basic.passEnv = add('PASSWORD', req.basic.pass);
      } else basic.userEnv = add('API_KEY', req.basic.user);
    }
  }
  return { req, env, headers, url, urlEnv, basic };
}

const q = (s: string) => JSON.stringify(s);
const sq = (s: string) =>
  s.includes("'") && !s.includes('"')
    ? JSON.stringify(s)
    : "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
const tmpl = (s: string) => '`' + s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${') + '`';
const isIdent = (s: string) => /^[A-Za-z_$][\w$]*$/.test(s);
const jsKey = (s: string) => (isIdent(s) ? s : sq(s));

// JS value literal for JSON bodies, indented like Prettier would.
function jsValue(v: unknown, ind: string): string {
  if (v === null || typeof v !== 'object') return typeof v === 'string' ? sq(v) : JSON.stringify(v);
  const next = ind + '  ';
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    const items = v.map((x) => jsValue(x, next));
    const flat = `[${items.join(', ')}]`;
    if (flat.length < 60 && !flat.includes('\n')) return flat;
    return `[\n${items.map((x) => next + x).join(',\n')},\n${ind}]`;
  }
  const entries = Object.entries(v as Record<string, unknown>);
  if (!entries.length) return '{}';
  return `{\n${entries.map(([k, x]) => `${next}${jsKey(k)}: ${jsValue(x, next)}`).join(',\n')},\n${ind}}`;
}

function pyValue(v: unknown, ind: string): string {
  if (v === null) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v !== 'object') return JSON.stringify(v);
  const next = ind + '    ';
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    const items = v.map((x) => pyValue(x, next));
    const flat = `[${items.join(', ')}]`;
    if (flat.length < 60 && !flat.includes('\n')) return flat;
    return `[\n${items.map((x) => next + x).join(',\n')},\n${ind}]`;
  }
  const entries = Object.entries(v as Record<string, unknown>);
  if (!entries.length) return '{}';
  return `{\n${entries.map(([k, x]) => `${next}${JSON.stringify(k)}: ${pyValue(x, next)}`).join(',\n')},\n${ind}}`;
}

const jsEnv = (name: string, _browser: boolean) => `process.env.${name}`;

// The URL as a JS expression.
function jsUrl(p: Plan, browser: boolean): string {
  if (!p.urlEnv.length) return sq(p.url);
  const u = new URL(p.url);
  const sep = u.search ? '&' : '?';
  const extra = p.urlEnv.map((x, i) => `${i ? '&' : sep}${x.key}=\${${jsEnv(x.env, browser)}}`).join('');
  return '`' + p.url.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${') + extra + '`';
}

function jsHeaderValue(h: Plan['headers'][number], browser: boolean): string {
  if (!h.env) return sq(h.value);
  const e = jsEnv(h.env, browser);
  return h.prefix ? `\`${h.prefix}\${${e}}\`` : e;
}

function jsHeaders(p: Plan, ind: string, browser: boolean, skipContentType = false): string[] {
  const out = p.headers
    .filter((h) => !(skipContentType && h.name.toLowerCase() === 'content-type'))
    .map((h) => `${ind}${jsKey(h.name)}: ${jsHeaderValue(h, browser)},`);
  if (p.basic) {
    const u = p.basic.userEnv ? `\${${jsEnv(p.basic.userEnv, browser)}}` : p.basic.user.replace(/[`\\$]/g, '\\$&');
    const pw = p.basic.passEnv ? `\${${jsEnv(p.basic.passEnv, browser)}}` : p.basic.pass.replace(/[`\\$]/g, '\\$&');
    out.push(`${ind}Authorization: \`Basic \${btoa(\`${u}:${pw}\`)}\`,`);
  }
  return out;
}

// fetch() options body for JSON / form / raw / multipart.
function fetchBody(p: Plan, ind: string): { pre: string[]; line: string | null } {
  const b = p.req.body;
  if (b.kind === 'none') return { pre: [], line: null };
  if (b.kind === 'json') return { pre: [], line: `${ind}body: JSON.stringify(${jsValue(b.value, ind)}),` };
  if (b.kind === 'urlencoded') {
    const pairs = b.fields.map(([k, v]) => `${ind}  ${jsKey(k)}: ${sq(v)},`).join('\n');
    return { pre: [], line: `${ind}body: new URLSearchParams({\n${pairs}\n${ind}}),` };
  }
  if (b.kind === 'raw') return { pre: [], line: `${ind}body: ${b.text.includes('\n') ? tmpl(b.text) : sq(b.text)},` };
  const pre = ['const form = new FormData();'];
  for (const f of b.fields) {
    pre.push(f.file ? `form.append(${sq(f.name)}, fileInput.files[0]); // the file "${f.value}"` : `form.append(${sq(f.name)}, ${sq(f.value)});`);
  }
  pre.push('');
  return { pre, line: `${ind}body: form,` };
}

function fetchCode(p: Plan, browser: boolean, node: boolean): string {
  const ind = '  ';
  const skipCT = p.req.body.kind === 'multipart';
  const headers = jsHeaders(p, ind + '  ', browser, skipCT);
  const body = fetchBody(p, ind);
  const pre = [...body.pre];
  if (node && p.req.body.kind === 'multipart') {
    pre.splice(0, pre.length, "import { openAsBlob } from 'node:fs';", '', 'const form = new FormData();');
    for (const f of (p.req.body as { fields: FormField[] }).fields)
      pre.push(f.file ? `form.append(${sq(f.name)}, await openAsBlob(${sq(f.value)}), ${sq(f.value.split('/').pop() || f.value)});` : `form.append(${sq(f.name)}, ${sq(f.value)});`);
    pre.push('');
  }
  const opts: string[] = [];
  if (p.req.method !== 'GET') opts.push(`${ind}method: ${sq(p.req.method)},`);
  if (headers.length) opts.push(`${ind}headers: {\n${headers.join('\n')}\n${ind}},`);
  if (body.line) opts.push(body.line);
  const call = opts.length ? `await fetch(${jsUrl(p, browser)}, {\n${opts.join('\n')}\n});` : `await fetch(${jsUrl(p, browser)});`;
  const read = p.req.method === 'HEAD' ? 'console.log(res.status, Object.fromEntries(res.headers));' : wantsJson(p) ? 'const data = await res.json();\nconsole.log(data);' : 'const text = await res.text();\nconsole.log(text);';
  return `${pre.join('\n')}${pre.length ? '\n' : ''}const res = ${call}\nif (!res.ok) throw new Error(\`Request failed: \${res.status}\`);\n${read}\n`;
}

function wantsJson(p: Plan): boolean {
  const acc = findHeader(p.req.headers, 'accept')?.value ?? '';
  if (/json/i.test(acc)) return true;
  if (acc && !/\*\/\*/.test(acc)) return false;
  return p.req.body.kind === 'json' || /\/(api|v\d+)\b|^https?:\/\/api\./i.test(p.req.url) || /\.json(\?|$)/.test(p.req.url);
}

function axiosCode(p: Plan, browser: boolean): string {
  const ind = '  ';
  const b = p.req.body;
  const skipCT = b.kind === 'multipart' || (b.kind === 'json' && /^application\/json$/i.test(findHeader(p.req.headers, 'content-type')?.value ?? ''));
  const headers = jsHeaders({ ...p, basic: null }, ind + '  ', browser, skipCT);
  const pre: string[] = ["import axios from 'axios';", ''];
  const lines = [`${ind}method: ${sq(p.req.method.toLowerCase())},`, `${ind}url: ${jsUrl(p, browser)},`];
  if (headers.length) lines.push(`${ind}headers: {\n${headers.join('\n')}\n${ind}},`);
  if (p.basic) {
    const u = p.basic.userEnv ? jsEnv(p.basic.userEnv, browser) : sq(p.basic.user);
    const pw = p.basic.passEnv ? jsEnv(p.basic.passEnv, browser) : sq(p.basic.pass);
    lines.push(`${ind}auth: { username: ${u}, password: ${pw} },`);
  }
  if (b.kind === 'json') lines.push(`${ind}data: ${jsValue(b.value, ind)},`);
  else if (b.kind === 'urlencoded') lines.push(`${ind}data: new URLSearchParams({\n${b.fields.map(([k, v]) => `${ind}  ${jsKey(k)}: ${sq(v)},`).join('\n')}\n${ind}}),`);
  else if (b.kind === 'raw') lines.push(`${ind}data: ${b.text.includes('\n') ? tmpl(b.text) : sq(b.text)},`);
  else if (b.kind === 'multipart') {
    pre.push('const form = new FormData();');
    for (const f of b.fields) pre.push(f.file ? `form.append(${sq(f.name)}, fileInput.files[0]); // the file "${f.value}"` : `form.append(${sq(f.name)}, ${sq(f.value)});`);
    pre.push('');
    lines.push(`${ind}data: form,`);
  }
  if (b.kind === 'raw' || (!wantsJson(p) && p.req.method !== 'HEAD')) lines.push(`${ind}responseType: 'text',`);
  return `${pre.join('\n')}\nconst { data } = await axios({\n${lines.join('\n')}\n});\nconsole.log(data);\n`;
}

function pythonCode(p: Plan): string {
  const ind = '    ';
  const b = p.req.body;
  const imports = ['import requests'];
  if (p.env.length) imports.unshift('import os');
  const envExpr = (n: string) => `os.environ[${q(n)}]`;
  const args: string[] = [];
  let pre = '';

  const hdrs = p.headers
    .filter((h) => !(b.kind === 'multipart' && h.name.toLowerCase() === 'content-type'))
    .filter((h) => !(b.kind === 'json' && /^content-type$/i.test(h.name) && /^application\/json$/i.test(h.value)))
    .filter((h) => !(b.kind === 'urlencoded' && /^content-type$/i.test(h.name) && /^application\/x-www-form-urlencoded$/i.test(h.value)))
    .map((h) => `${ind}${q(h.name)}: ${h.env ? (h.prefix ? `f${q(h.prefix + '{' + envExpr(h.env).replace(/"/g, "'") + '}')}` : envExpr(h.env)) : q(h.value)},`);
  if (hdrs.length) pre += `headers = {\n${hdrs.join('\n')}\n}\n\n`;

  let url = q(p.url);
  if (p.urlEnv.length) {
    const params = p.urlEnv.map((x) => `${ind}${q(x.key)}: ${envExpr(x.env)},`).join('\n');
    pre += `params = {\n${params}\n}\n\n`;
  }
  args.push(url);
  if (p.urlEnv.length) args.push('params=params');
  if (hdrs.length) args.push('headers=headers');
  if (p.basic) {
    const u = p.basic.userEnv ? envExpr(p.basic.userEnv) : q(p.basic.user);
    const pw = p.basic.passEnv ? envExpr(p.basic.passEnv) : q(p.basic.pass);
    args.push(`auth=(${u}, ${pw})`);
  }
  if (b.kind === 'json') {
    pre += `payload = ${pyValue(b.value, '')}\n\n`;
    args.push('json=payload');
  } else if (b.kind === 'urlencoded') {
    pre += `data = {\n${b.fields.map(([k, v]) => `${ind}${q(k)}: ${q(v)},`).join('\n')}\n}\n\n`;
    args.push('data=data');
  } else if (b.kind === 'raw') {
    pre += `data = ${b.text.includes('\n') ? `"""${b.text.replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"')}"""` : q(b.text)}\n\n`;
    args.push('data=data');
  } else if (b.kind === 'multipart') {
    const files = b.fields.filter((f) => f.file);
    const data = b.fields.filter((f) => !f.file);
    if (data.length) {
      pre += `data = {\n${data.map((f) => `${ind}${q(f.name)}: ${q(f.value)},`).join('\n')}\n}\n`;
      args.push('data=data');
    }
    if (files.length) {
      pre += `files = {\n${files.map((f) => `${ind}${q(f.name)}: open(${q(f.value)}, "rb"),`).join('\n')}\n}\n`;
      args.push('files=files');
    }
    pre += '\n';
  }
  if (p.req.insecure) args.push('verify=True  # curl used -k; keep certificate checks on');
  const m = p.req.method.toLowerCase();
  const fn = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(m) ? `requests.${m}(` : `requests.request(${q(p.req.method)}, `;
  const call = `response = ${fn}\n${args.map((a) => `${ind}${a},`).join('\n')}\n${ind}timeout=30,\n)`;
  const read = p.req.method === 'HEAD' ? 'print(response.status_code, response.headers)' : wantsJson(p) ? 'print(response.json())' : 'print(response.text)';
  return `${imports.join('\n')}\n\n${pre}${call}\nresponse.raise_for_status()\n${read}\n`;
}

function routeName(url: string): string {
  try {
    const segs = new URL(url).pathname.split('/').filter((s) => s && !/^v\d+$/.test(s) && !/^\d+$/.test(s) && !/^[0-9a-f-]{16,}$/i.test(s));
    const last = segs[segs.length - 1] ?? servicePrefix(url).toLowerCase();
    return last.replace(/\.[a-z]+$/i, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'proxy';
  } catch {
    return 'proxy';
  }
}

function nextCode(p: Plan): string {
  const route = routeName(p.req.url);
  const b = p.req.body;
  const method = p.req.method === 'HEAD' ? 'GET' : p.req.method;
  const ind = '  ';
  const headers = jsHeaders(p, ind + '  ', false, b.kind === 'multipart');
  const opts: string[] = [];
  if (p.req.method !== 'GET') opts.push(`${ind}method: ${sq(p.req.method)},`);
  if (headers.length) opts.push(`${ind}headers: {\n${headers.join('\n')}\n${ind}},`);
  const takesInput = !['GET', 'HEAD', 'DELETE', 'OPTIONS'].includes(method);
  let pre = '';
  let clientBody = '';
  if (b.kind === 'json') {
    pre = `  // The browser sends the JSON body; the secret stays on the server.\n  const input = await request.json();\n\n`;
    opts.push(`${ind}body: JSON.stringify(input),`);
    clientBody = `\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify(${jsValue(b.value, '  ')}),`;
  } else if (b.kind === 'multipart') {
    pre = `  // The browser sends the form (and files); the secret stays on the server.\n  const form = await request.formData();\n\n`;
    opts.push(`${ind}body: form,`);
    clientBody = '\n  body: form, // a FormData with the same fields';
  } else if (b.kind === 'urlencoded') {
    opts.push(`${ind}body: new URLSearchParams({\n${b.fields.map(([k, v]) => `${ind}  ${jsKey(k)}: ${sq(v)},`).join('\n')}\n${ind}}),`);
  } else if (b.kind === 'raw') {
    pre = '  const input = await request.text();\n\n';
    opts.push(`${ind}body: input,`);
    clientBody = `\n  body: ${b.text.includes('\n') ? tmpl(b.text) : sq(b.text)},`;
  }
  const call = opts.length ? `await fetch(${jsUrl(p, false)}, {\n${opts.join('\n')}\n})` : `await fetch(${jsUrl(p, false)})`;
  const json = wantsJson(p);
  const reply = json
    ? `  const data = await res.json();\n  return Response.json(data, { status: res.status });`
    : `  return new Response(await res.text(), {\n    status: res.status,\n    headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'text/plain' },\n  });`;
  const sig = pre || takesInput ? `export async function ${method}(request: Request) {` : `export async function ${method}() {`;
  const clientOpts = method === 'GET' ? '' : `, {\n  method: ${sq(method)},${clientBody}\n}`;
  const client = `\n// Call it from your page (no secret in the browser):\n// const res = await fetch('/api/${route}'${clientOpts.replace(/\n/g, '\n// ')});\n// const data = await res.${json ? 'json' : 'text'}();\n`;
  return `// app/api/${route}/route.ts\n${sig}\n${pre}  const res = ${call.replace(/\n/g, '\n  ')};\n\n${reply}\n}\n${client}`;
}

export function generate(req: Request, lang: Lang, useEnv: boolean): { code: string; env: Env[] } {
  const p = plan(req, useEnv);
  let code = '';
  if (lang === 'fetch') code = fetchCode(p, true, false);
  else if (lang === 'axios') code = axiosCode(p, false);
  else if (lang === 'node') code = fetchCode(p, false, true);
  else if (lang === 'python') code = pythonCode(p);
  else code = nextCode(p);
  return { code, env: p.env };
}

export const EXAMPLES: Record<string, { label: string; curl: string }> = {
  openai: {
    label: 'OpenAI chat',
    curl: `curl https://api.openai.com/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-proj-4f9aZ1ExampleKeyDoNotUse8c2" \\
  -d '{
    "model": "gpt-4.1-mini",
    "messages": [
      { "role": "user", "content": "Write a haiku about bugs" }
    ]
  }'`,
  },
  stripe: {
    label: 'Stripe (form + -u)',
    curl: `curl https://api.stripe.com/v1/customers \\
  -u sk_test_51ExampleKeyDoNotUse: \\
  -d email="ada@example.com" \\
  -d name="Ada Lovelace" \\
  -d "metadata[plan]=pro"`,
  },
  github: {
    label: 'GitHub GET',
    curl: `curl -L \\
  -H "Accept: application/vnd.github+json" \\
  -H "X-GitHub-Api-Version: 2022-11-28" \\
  "https://api.github.com/repos/withastro/astro/issues?state=open&per_page=5"`,
  },
  upload: {
    label: 'File upload (-F)',
    curl: `curl -X POST https://api.example.com/v1/files \\
  -H "x-api-key: demo_9f8e7d6c5b4a" \\
  -F purpose=avatar \\
  -F file=@./photo.png`,
  },
};
