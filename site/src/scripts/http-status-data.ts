// HTTP status codes in plain English, with the usual causes in a vibecoder's setup and how to fix them.
// Static data that ships in the page bundle. Nothing is fetched.

export type Hop = 'browser' | 'edge' | 'app' | 'upstream';
export type Tag = 'Next.js' | 'Vercel' | 'Supabase' | 'Cloudflare' | 'Netlify' | 'Any';
export type Group = '1xx' | '2xx' | '3xx' | '4xx' | '5xx' | 'Cloudflare' | 'Vercel' | 'Netlify';
export type Tone = 'info' | 'ok' | 'redirect' | 'client' | 'server';

export interface Cause { tag: Tag; text: string }
export interface StatusCode {
  id: string; // anchor, e.g. "404" or "FUNCTION_INVOCATION_TIMEOUT"
  status: number; // the HTTP number the browser sees
  name: string;
  group: Group;
  hop: Hop | null; // where the problem most likely is; null when nothing is wrong
  means: string;
  causes: Cause[];
  fixes: string[];
  aka?: string[]; // extra search words
  common?: boolean;
}

export const HOPS: { id: Hop; label: string; sub: string }[] = [
  { id: 'browser', label: 'Browser', sub: 'the request' },
  { id: 'edge', label: 'Host / CDN', sub: 'Vercel, Cloudflare, Netlify' },
  { id: 'app', label: 'Your app', sub: 'your server code' },
  { id: 'upstream', label: 'Database / API', sub: 'Supabase, Stripe, OpenAI…' },
];

export const GROUPS: { id: Group; label: string }[] = [
  { id: '4xx', label: '4xx · Request problems' },
  { id: '5xx', label: '5xx · Server problems' },
  { id: 'Cloudflare', label: 'Cloudflare errors' },
  { id: 'Vercel', label: 'Vercel errors' },
  { id: 'Netlify', label: 'Netlify errors' },
  { id: '3xx', label: '3xx · Redirects' },
  { id: '2xx', label: '2xx · It worked' },
  { id: '1xx', label: '1xx · Hold on' },
];

export const TAGS: Tag[] = ['Next.js', 'Vercel', 'Supabase', 'Cloudflare', 'Netlify'];

export function toneOf(c: { status: number; group: Group }): Tone {
  const s = c.status;
  if (s < 200) return 'info';
  if (s < 300) return 'ok';
  if (s < 400) return 'redirect';
  if (s < 500) return 'client';
  return 'server';
}

export const VERDICT: Record<Tone, string> = {
  info: 'Nothing is wrong. The server is just saying “hold on”.',
  ok: 'It worked. This is not an error.',
  redirect: 'Not an error. The page lives at another address.',
  client: 'Request problem: the server is up, but it refused this request.',
  server: 'Server problem: the request was fine, something broke on the server side.',
};

const c = (tag: Tag, text: string): Cause => ({ tag, text });

export const CODES: StatusCode[] = [
  // ---------- 1xx ----------
  {
    id: '100', status: 100, name: 'Continue', group: '1xx', hop: null,
    means: 'The server got the start of a big upload and says “go ahead, send the rest”. You almost never see this yourself.',
    causes: [c('Any', 'A client sent an “Expect: 100-continue” header before uploading a large body. Normal and harmless.')],
    fixes: ['Nothing to fix. If an upload hangs here, the server or proxy may not support 100-continue: try the upload without that header.'],
  },
  {
    id: '101', status: 101, name: 'Switching Protocols', group: '1xx', hop: null,
    means: 'The connection is switching to another protocol, almost always a WebSocket. This is what success looks like for a live connection.',
    causes: [c('Any', 'Your app opened a WebSocket (live chat, Supabase Realtime, a dev server’s hot reload).')],
    fixes: ['Nothing to fix. If the WebSocket then drops, look at the close code in the browser’s Network tab, under the WS filter.'],
    aka: ['websocket', 'ws'],
  },
  {
    id: '103', status: 103, name: 'Early Hints', group: '1xx', hop: null,
    means: 'The server sends hints (like “start loading this font”) before the real answer, so the page loads faster.',
    causes: [c('Cloudflare', 'Cloudflare’s Early Hints setting is on, or your host sends Link preload headers.')],
    fixes: ['Nothing to fix. It is a speed feature.'],
  },

  // ---------- 2xx ----------
  {
    id: '200', status: 200, name: 'OK', group: '2xx', hop: null,
    means: 'Everything worked and the server sent back what was asked for.',
    causes: [
      c('Any', 'A normal, successful request.'),
      c('Next.js', 'If the page still looks broken with a 200, the bug is in what the page shows (data, layout or JavaScript), not in the request.'),
    ],
    fixes: ['Nothing to fix in the request. If something looks wrong, open the browser console for JavaScript errors, or check that the response holds the data you expected.'],
    aka: ['ok', 'success'],
  },
  {
    id: '201', status: 201, name: 'Created', group: '2xx', hop: null,
    means: 'It worked, and something new was created, like a new row, user or file.',
    causes: [
      c('Supabase', 'An insert through the Supabase client or REST API succeeded.'),
      c('Any', 'Your API route saved something new and says so.'),
    ],
    fixes: ['Nothing to fix. If the new thing doesn’t show up on screen, the page probably isn’t re-fetching after the save.'],
  },
  {
    id: '204', status: 204, name: 'No Content', group: '2xx', hop: null,
    means: 'It worked, and there is deliberately nothing to send back.',
    causes: [
      c('Supabase', 'An update or delete succeeded without asking for the rows back (no .select() after it).'),
      c('Any', 'A CORS preflight (OPTIONS) request was approved.'),
    ],
    fixes: [
      'Nothing to fix. If your code then crashes with “Unexpected end of JSON input”, it is calling res.json() on an empty answer: check the status first, or add .select() in Supabase to get the rows back.',
    ],
    aka: ['empty', 'unexpected end of json input'],
  },
  {
    id: '206', status: 206, name: 'Partial Content', group: '2xx', hop: null,
    means: 'The server sent only part of a file, because only part was asked for. This is how videos and big downloads stream.',
    causes: [c('Any', 'A video, audio file or resumable download is loading in pieces.')],
    fixes: ['Nothing to fix. It is how streaming works.'],
  },

  // ---------- 3xx ----------
  {
    id: '301', status: 301, name: 'Moved Permanently', group: '3xx', hop: 'edge',
    means: 'This page has moved to a new address for good. Browsers and Google remember the move.',
    causes: [
      c('Cloudflare', 'A redirect rule sends www to the bare domain (or the other way round), or http to https.'),
      c('Vercel', 'A domain in your project settings is set to redirect to another one.'),
      c('Next.js', 'A redirect in next.config with permanent: true.'),
    ],
    fixes: [
      'If it goes where it should, nothing to fix.',
      'If it goes to the wrong place, find the rule: Cloudflare Rules, Vercel domain settings, next.config redirects, or vercel.json / _redirects.',
      'Browsers cache 301s hard. After fixing, test in a private window.',
    ],
    aka: ['redirect', 'moved'],
  },
  {
    id: '302', status: 302, name: 'Found (temporary redirect)', group: '3xx', hop: 'app',
    means: 'The page is somewhere else for now. Often used to send people to a login page.',
    causes: [
      c('Next.js', 'Middleware or redirect() sends logged-out visitors to /login.'),
      c('Supabase', 'The auth callback redirects back to your site after sign in.'),
      c('Any', 'An API call gets redirected to a login page, so your code receives HTML instead of JSON.'),
    ],
    fixes: [
      'If a fetch gets a login page back, the request is missing the session cookie or token.',
      'Check your middleware’s matcher: it should skip API routes, static files and the login page itself.',
    ],
    aka: ['redirect', 'login redirect'],
  },
  {
    id: '304', status: 304, name: 'Not Modified', group: '3xx', hop: null,
    means: 'Nothing changed since the browser last loaded this, so it used its saved copy. Faster, not an error.',
    causes: [c('Any', 'Normal browser caching of a file that hasn’t changed.')],
    fixes: ['Nothing to fix. If you see an old version after deploying, do a hard reload (Cmd/Ctrl + Shift + R) or check your cache headers.'],
    aka: ['cache', 'cached'],
  },
  {
    id: '307', status: 307, name: 'Temporary Redirect', group: '3xx', hop: 'edge',
    means: 'Go to another address for now, and keep the same method (a POST stays a POST).',
    causes: [
      c('Next.js', 'Next.js redirects with 307 by default, including trailing-slash and middleware redirects.'),
      c('Vercel', 'Vercel redirects http to https with a 307 or 308.'),
    ],
    fixes: ['Usually fine. If it loops, see 508 / “too many redirects”: two rules are sending visitors back and forth.'],
    aka: ['redirect', 'trailing slash'],
  },
  {
    id: '308', status: 308, name: 'Permanent Redirect', group: '3xx', hop: 'edge',
    means: 'Moved for good, and keep the same method. The modern version of 301.',
    causes: [
      c('Next.js', 'Redirects with permanent: true, and trailing-slash fixes, use 308.'),
      c('Vercel', 'Vercel redirects http to https or your domain redirects.'),
    ],
    fixes: ['If it goes to the wrong place, check next.config redirects, trailingSlash, and your host’s domain settings. Test in a private window after fixing.'],
    aka: ['redirect'],
  },

  // ---------- 4xx ----------
  {
    id: '400', status: 400, name: 'Bad Request', group: '4xx', hop: 'browser', common: true,
    means: 'The server couldn’t make sense of what was sent: the data is missing, the wrong shape, or broken.',
    causes: [
      c('Any', 'The request body isn’t valid JSON, or the Content-Type header doesn’t say application/json.'),
      c('Any', 'A required field is missing or has the wrong type, and your validation (like Zod) rejected it.'),
      c('Supabase', 'PostgREST got a filter or column it doesn’t understand: look for a PGRST code in the response.'),
      c('Cloudflare', 'A cookie or header got too big, often from piling up auth cookies.'),
    ],
    fixes: [
      'Open the browser’s Network tab, click the failed request and read the Response: the server usually says which field is wrong.',
      'Compare what was sent (Payload) with what the API expects.',
      'If it only happens for you, clear cookies for the site and try again.',
    ],
    aka: ['bad request', 'invalid', 'validation'],
  },
  {
    id: '401', status: 401, name: 'Unauthorized', group: '4xx', hop: 'browser', common: true,
    means: 'The server doesn’t know who you are. You’re not logged in, or the login (token or key) is missing, wrong or expired.',
    causes: [
      c('Supabase', 'The JWT expired (“JWT expired”), or the request was sent without the session, so it ran as anon.'),
      c('Supabase', 'The anon or service key is wrong, or the env var is empty in production.'),
      c('Next.js', 'A server component or route handler can’t see the auth cookie, so it treats the user as logged out.'),
      c('Any', 'An API key for OpenAI, Stripe or another service is missing or wrong in your production env vars.'),
    ],
    fixes: [
      'Log out and back in. If that fixes it, the token refresh isn’t working.',
      'Check that the env vars (API keys, Supabase URL and key) are set in your host’s settings for production, not only in .env.local, then redeploy.',
      'In the Network tab, check that the failing request carries an Authorization header or the auth cookie.',
    ],
    aka: ['unauthorized', 'not logged in', 'jwt expired', 'invalid api key', 'unauthenticated'],
  },
  {
    id: '402', status: 402, name: 'Payment Required', group: '4xx', hop: 'upstream',
    means: 'A paid service refused because of billing: out of credits, an unpaid invoice, or a plan limit.',
    causes: [
      c('Any', 'An AI or API provider account ran out of credits or has a failed payment.'),
      c('Vercel', 'The deployment is disabled for exceeding plan limits (DEPLOYMENT_DISABLED).'),
    ],
    fixes: ['Check the billing page of the service that answered (the response usually names it), add credits or update the card, then retry.'],
    aka: ['payment', 'billing', 'credits', 'quota'],
  },
  {
    id: '403', status: 403, name: 'Forbidden', group: '4xx', hop: 'app', common: true,
    means: 'The server knows who you are (or doesn’t need to) and still says no. You’re not allowed to see or do this.',
    causes: [
      c('Supabase', 'A Row Level Security policy blocks this user (“new row violates row-level security policy”, code 42501).'),
      c('Cloudflare', 'A firewall or bot rule blocked the visitor (Cloudflare error 1020, Access denied).'),
      c('Vercel', 'Deployment Protection is on, so preview links need a Vercel login.'),
      c('Any', 'A storage bucket or file is private, or a signed URL expired.'),
      c('Any', 'CSRF or origin checks rejected a form post from another domain.'),
    ],
    fixes: [
      'Read the response body: it usually says which rule blocked it.',
      'For Supabase, check the table’s policies for this action (select, insert, update or delete) and this role. Test the policy in the SQL editor as that user.',
      'For Cloudflare, look in Security, then Events, to see which rule blocked the request.',
    ],
    aka: ['forbidden', 'access denied', 'permission denied', 'rls', 'row level security', 'not allowed'],
  },
  {
    id: '404', status: 404, name: 'Not Found', group: '4xx', hop: 'app', common: true,
    means: 'The server is up, but there’s nothing at this address. The page, file or API route doesn’t exist, or it isn’t where the link points.',
    causes: [
      c('Next.js', 'The file is in the wrong folder, misnamed, or uses the wrong router: app/about/page.tsx and pages/about.tsx make different routes.'),
      c('Next.js', 'A dynamic page called notFound(), or generateStaticParams didn’t build this page.'),
      c('Vercel', 'The page works locally but not after deploy: a file name differs only by case (About.tsx vs about.tsx), or the build output folder is wrong.'),
      c('Netlify', 'A single-page app (Vite, React) refreshes on /dashboard and 404s because there’s no rewrite to index.html.'),
      c('Supabase', 'A storage file path is wrong, or a table or function name isn’t found (PGRST205 / PGRST202).'),
      c('Any', 'A typo in the link, or a page was moved without a redirect.'),
    ],
    fixes: [
      'Copy the exact URL that 404s and find the file that should serve it. Check spelling and capital letters.',
      'For a Vite or React app on Netlify or Cloudflare Pages, add a rewrite so every path serves index.html.',
      'If a page moved, add a redirect from the old address to the new one.',
      'If it only fails after deploying, read the build log for the list of routes that were built.',
    ],
    aka: ['not found', 'page not found', 'missing', 'broken link'],
  },
  {
    id: '405', status: 405, name: 'Method Not Allowed', group: '4xx', hop: 'app',
    means: 'The address exists, but not for this kind of request. For example a POST was sent where only GET is handled.',
    causes: [
      c('Next.js', 'The route.ts file doesn’t export a function for this method (e.g. it has GET but not POST).'),
      c('Netlify', 'A form posts to a static page or an API path that isn’t a function.'),
      c('Any', 'The fetch uses the wrong method, or a redirect turned a POST into a GET.'),
    ],
    fixes: [
      'Check the method in the Network tab, then make sure your route exports that exact name in capitals: export async function POST().',
      'Make sure the URL has no missing or extra trailing slash that triggers a redirect.',
    ],
    aka: ['method not allowed', 'wrong method'],
  },
  {
    id: '406', status: 406, name: 'Not Acceptable', group: '4xx', hop: 'upstream',
    means: 'The server can’t answer in the format that was asked for.',
    causes: [
      c('Supabase', 'Very common with Supabase: .single() was used but the query returned zero rows or more than one (PGRST116).'),
      c('Any', 'The Accept header asks for a format the server doesn’t produce.'),
    ],
    fixes: ['In Supabase, use .maybeSingle() when the row might not exist, or fix the filter so exactly one row matches.'],
    aka: ['pgrst116', 'single', 'not acceptable'],
  },
  {
    id: '408', status: 408, name: 'Request Timeout', group: '4xx', hop: 'browser',
    means: 'The server waited too long for the browser to finish sending the request, and gave up.',
    causes: [c('Any', 'A slow connection, or a large upload that took too long to send.')],
    fixes: ['Retry on a better connection. For big files, upload straight to storage (like a Supabase signed upload URL) instead of through your API.'],
    aka: ['timeout'],
  },
  {
    id: '409', status: 409, name: 'Conflict', group: '4xx', hop: 'upstream',
    means: 'The request clashes with what’s already there, like creating something that already exists.',
    causes: [
      c('Supabase', 'An insert broke a unique rule (“duplicate key value violates unique constraint”, code 23505), or a foreign key points to a missing row (23503).'),
      c('Any', 'Two edits to the same thing at once, or signing up with an email that’s already taken.'),
    ],
    fixes: [
      'Use upsert instead of insert when the row may already exist.',
      'Show a friendly message (“that email is already registered”) instead of a crash.',
    ],
    aka: ['conflict', 'duplicate', 'unique constraint', '23505'],
  },
  {
    id: '410', status: 410, name: 'Gone', group: '4xx', hop: 'app',
    means: 'This used to exist and was removed on purpose. Unlike 404, it isn’t coming back.',
    causes: [c('Any', 'A page or API version was deleted deliberately.')],
    fixes: ['If it should exist, restore it or redirect to the replacement. If it’s an outside API, move to its newer version.'],
    aka: ['gone', 'removed', 'deprecated'],
  },
  {
    id: '411', status: 411, name: 'Length Required', group: '4xx', hop: 'browser',
    means: 'The server wants to know how big the request body is before accepting it.',
    causes: [c('Any', 'A POST or PUT was sent without a Content-Length header, often with a streamed body.')],
    fixes: ['Send the body as a string or Blob (not a stream) so the length is set automatically.'],
  },
  {
    id: '413', status: 413, name: 'Content Too Large', group: '4xx', hop: 'edge',
    means: 'What was sent is bigger than the server accepts. Usually an upload that’s too big.',
    causes: [
      c('Vercel', 'Vercel Functions have a request body limit of a few MB (FUNCTION_PAYLOAD_TOO_LARGE).'),
      c('Next.js', 'Server Actions accept 1 MB by default (bodySizeLimit).'),
      c('Supabase', 'The file is over the bucket’s upload size limit.'),
      c('Any', 'An image is sent as base64 inside JSON, which makes it about a third bigger.'),
    ],
    fixes: [
      'Upload files straight from the browser to storage (Supabase Storage, S3, R2) with a signed URL, and send only the file’s path to your API.',
      'Shrink images in the browser before uploading.',
      'For Server Actions, raise serverActions.bodySizeLimit in next.config if you really need bigger bodies.',
    ],
    aka: ['too large', 'payload too large', 'file too big', 'entity too large'],
  },
  {
    id: '414', status: 414, name: 'URI Too Long', group: '4xx', hop: 'browser',
    means: 'The web address itself is too long for the server.',
    causes: [c('Any', 'Lots of data (or a whole list of IDs) was put in the query string.')],
    fixes: ['Send the data in a POST body instead of the URL. In Supabase, avoid huge .in() lists in one request.'],
    aka: ['url too long'],
  },
  {
    id: '415', status: 415, name: 'Unsupported Media Type', group: '4xx', hop: 'browser',
    means: 'The server doesn’t accept data in this format.',
    causes: [c('Any', 'JSON was sent without Content-Type: application/json, or a form was sent where JSON was expected.')],
    fixes: ['Set the Content-Type header to match the body, e.g. headers: { "Content-Type": "application/json" } with JSON.stringify(body).'],
    aka: ['content type', 'media type'],
  },
  {
    id: '418', status: 418, name: 'I’m a teapot', group: '4xx', hop: 'app',
    means: 'An old April Fools’ joke code. Some sites use it to turn away bots.',
    causes: [c('Any', 'A server or bot filter is joking, or is blocking automated requests.')],
    fixes: ['If you hit it from a script, the site doesn’t want automated traffic: use its official API.'],
    aka: ['teapot'],
  },
  {
    id: '422', status: 422, name: 'Unprocessable Content', group: '4xx', hop: 'browser',
    means: 'The data arrived in the right format, but the values don’t pass the rules (like an invalid email or a password that’s too short).',
    causes: [
      c('Supabase', 'Supabase Auth rejected the sign up: weak password, invalid email, or the user already exists.'),
      c('Any', 'Form validation on the server failed for one or more fields.'),
    ],
    fixes: ['Read the response body for the field and the reason, and show that message next to the field in your form.'],
    aka: ['validation', 'unprocessable', 'invalid email', 'weak password'],
  },
  {
    id: '426', status: 426, name: 'Upgrade Required', group: '4xx', hop: 'browser',
    means: 'The server wants a newer protocol, usually HTTPS or a WebSocket, before it answers.',
    causes: [c('Any', 'A plain http request hit an https-only endpoint, or a normal request hit a WebSocket-only endpoint.')],
    fixes: ['Use https:// (or wss:// for WebSockets) in the URL.'],
  },
  {
    id: '428', status: 428, name: 'Precondition Required', group: '4xx', hop: 'browser',
    means: 'The server wants proof you have the latest version before you change it, to avoid overwriting someone else’s edit.',
    causes: [c('Any', 'An API needs an If-Match header (an ETag) on updates.')],
    fixes: ['Fetch the item first, then send its ETag in an If-Match header with your update.'],
  },
  {
    id: '429', status: 429, name: 'Too Many Requests', group: '4xx', hop: 'upstream', common: true,
    means: 'Slow down: too many requests were sent in a short time, so the server is refusing for a while.',
    causes: [
      c('Any', 'An AI API (OpenAI, Anthropic, Gemini) hit its rate limit or your account’s usage tier.'),
      c('Next.js', 'A useEffect without the right dependencies fetches in a loop on every render.'),
      c('Supabase', 'Auth rate limits were hit, e.g. too many sign-up or magic-link emails per hour.'),
      c('Cloudflare', 'A rate limiting rule fired (Cloudflare error 1015).'),
    ],
    fixes: [
      'Look for a Retry-After header in the response and wait that long.',
      'Check the Network tab: if the same request fires over and over, fix the loop (often a useEffect).',
      'Retry with a growing pause (1s, 2s, 4s), cache results, and batch requests.',
      'For AI APIs, check your usage tier and limits in the provider’s dashboard.',
    ],
    aka: ['rate limit', 'rate limited', 'too many requests', 'throttled', 'quota'],
  },
  {
    id: '431', status: 431, name: 'Request Header Fields Too Large', group: '4xx', hop: 'browser',
    means: 'The request’s headers, usually the cookies, are too big.',
    causes: [
      c('Supabase', 'Auth cookies are split into many chunks and keep piling up, often on localhost where several projects share cookies.'),
      c('Any', 'Too many or too big cookies for this domain.'),
    ],
    fixes: ['Clear cookies for the site (or for localhost) and reload. Then make sure your app doesn’t store big data in cookies.'],
    aka: ['header too large', 'cookie too large', 'cookies'],
  },
  {
    id: '451', status: 451, name: 'Unavailable For Legal Reasons', group: '4xx', hop: 'edge',
    means: 'The content is blocked for legal reasons, often in certain countries.',
    causes: [c('Any', 'Geo-blocking, a legal takedown, or a sanctions rule.')],
    fixes: ['Nothing to fix in code. If it’s your site, check your host’s or CDN’s geo rules.'],
    aka: ['legal', 'blocked country', 'geo'],
  },
  {
    id: '499', status: 499, name: 'Client Closed Request', group: '4xx', hop: 'browser',
    means: 'Not an official code: the browser gave up and closed the connection before the server answered. You’ll see it in server logs.',
    causes: [
      c('Any', 'The user navigated away or closed the tab while the request was still running.'),
      c('Any', 'A fetch was cancelled (AbortController) or a slow request ran past the browser’s patience.'),
    ],
    fixes: ['If it happens a lot on one route, that route is too slow: see 504.'],
    aka: ['client closed', 'aborted', 'cancelled'],
  },

  // ---------- 5xx ----------
  {
    id: '500', status: 500, name: 'Internal Server Error', group: '5xx', hop: 'app', common: true,
    means: 'Your server code crashed while handling the request. The message is vague on purpose; the real error is in your server logs.',
    causes: [
      c('Any', 'An env var is missing in production, so a key or URL is undefined.'),
      c('Next.js', 'A server component, route handler or Server Action threw: reading a property of undefined, a failed fetch, or bad data.'),
      c('Supabase', 'A database call failed and the code didn’t handle the error (wrong column name, RLS returned nothing, connection limit).'),
      c('Vercel', 'The build works locally, but production uses a different Node version or is missing a package (FUNCTION_INVOCATION_FAILED).'),
    ],
    fixes: [
      'Open the logs: Vercel, then your project, then Logs (or Netlify Functions logs, or Cloudflare Workers logs). Find the request and read the stack trace.',
      'Compare production env vars with your .env.local. A missing one is the top cause.',
      'Wrap the failing call in try/catch and return a clear error, so next time you see what went wrong.',
    ],
    aka: ['internal server error', 'server error', 'crash', 'something went wrong', 'application error'],
  },
  {
    id: '501', status: 501, name: 'Not Implemented', group: '5xx', hop: 'app',
    means: 'The server doesn’t support what was asked for at all, often the request method.',
    causes: [c('Any', 'An unusual method (like PATCH or PROPFIND) was sent to a server that doesn’t handle it.')],
    fixes: ['Use a method the API supports, or add a handler for this method.'],
  },
  {
    id: '502', status: 502, name: 'Bad Gateway', group: '5xx', hop: 'app', common: true,
    means: 'The host or proxy in front of your app asked your app for the page and got a broken answer, or no answer. The middleman is fine; what’s behind it isn’t.',
    causes: [
      c('Vercel', 'The function crashed or returned nothing (NO_RESPONSE_FROM_FUNCTION), often right at start-up.'),
      c('Netlify', 'A function timed out or crashed (“Task timed out” or an uncaught error).'),
      c('Cloudflare', 'Your origin server is down or restarting behind Cloudflare.'),
      c('Any', 'Your server listens on the wrong port or host (localhost instead of 0.0.0.0) on Railway, Render or Fly.'),
      c('Any', 'An outside API you depend on is down.'),
    ],
    fixes: [
      'Check that the app is running: open your host’s logs for crashes at start-up.',
      'On Railway, Render or Fly, make sure the server listens on process.env.PORT and 0.0.0.0.',
      'Redeploy the last version that worked to confirm it’s a code change.',
      'If an outside service is down, check its status page and show a friendly message meanwhile.',
    ],
    aka: ['bad gateway', 'gateway', 'proxy error', 'upstream'],
  },
  {
    id: '503', status: 503, name: 'Service Unavailable', group: '5xx', hop: 'app', common: true,
    means: 'The server is there but can’t take requests right now: overloaded, starting up, paused, or in maintenance.',
    causes: [
      c('Supabase', 'A free project paused after a week of no activity, or the database ran out of connections.'),
      c('Vercel', 'The deployment is paused (DEPLOYMENT_PAUSED) or there are too many requests at once.'),
      c('Any', 'A free-tier server is asleep and waking up (Render, Railway), or it’s overloaded.'),
      c('Any', 'An outside API is having an outage.'),
    ],
    fixes: [
      'Supabase: open the dashboard and restore the paused project.',
      'Wait a minute and retry. If it keeps happening, check your host’s status page and usage limits.',
      'For “too many connections”, use Supabase’s pooled connection string (port 6543).',
    ],
    aka: ['unavailable', 'maintenance', 'overloaded', 'paused', 'down'],
  },
  {
    id: '504', status: 504, name: 'Gateway Timeout', group: '5xx', hop: 'app', common: true,
    means: 'The host waited for your app to answer and gave up. Your code took too long.',
    causes: [
      c('Vercel', 'The function ran past its time limit (FUNCTION_INVOCATION_TIMEOUT), often waiting on an AI API or a slow query.'),
      c('Netlify', 'The function ran past its limit (“Task timed out after 10.00 seconds”).'),
      c('Supabase', 'A query without an index scans a big table, or a statement timeout fired.'),
      c('Cloudflare', 'Your origin took over 100 seconds (shown as 524 instead).'),
    ],
    fixes: [
      'Find the slow step in the logs. Most often it’s an AI call or a database query.',
      'Stream AI responses instead of waiting for the whole answer.',
      'Move long jobs to a background task or queue and let the page check back.',
      'On Vercel, raise maxDuration for that route if your plan allows it. Add database indexes for slow queries.',
    ],
    aka: ['timeout', 'timed out', 'gateway timeout', 'too slow'],
  },
  {
    id: '505', status: 505, name: 'HTTP Version Not Supported', group: '5xx', hop: 'edge',
    means: 'The server doesn’t speak the HTTP version the request used.',
    causes: [c('Any', 'A very old or very unusual client, or a misconfigured proxy.')],
    fixes: ['Use a normal browser or a standard HTTP library. If it’s your server, check the proxy’s HTTP version settings.'],
  },
  {
    id: '507', status: 507, name: 'Insufficient Storage', group: '5xx', hop: 'upstream',
    means: 'The server is out of space to save what was sent.',
    causes: [
      c('Supabase', 'The project hit its database or storage size limit.'),
      c('Any', 'A disk or bucket is full.'),
    ],
    fixes: ['Free up space or upgrade the plan. Check the usage page of the database or storage service.'],
    aka: ['disk full', 'storage full'],
  },
  {
    id: '508', status: 508, name: 'Loop Detected', group: '5xx', hop: 'edge',
    means: 'The request went round in a circle: something redirects or rewrites back to itself.',
    causes: [
      c('Vercel', 'A rewrite or middleware sends the request back to itself (INFINITE_LOOP_DETECTED).'),
      c('Cloudflare', 'SSL mode “Flexible” plus an https redirect on your server keeps bouncing visitors (“too many redirects”).'),
      c('Next.js', 'Middleware redirects to /login, and /login is also matched by that middleware.'),
    ],
    fixes: [
      'Exclude the target page from the middleware matcher.',
      'On Cloudflare, set SSL/TLS to “Full (strict)” when your host already serves https.',
      'List every redirect and rewrite (host, CDN, next.config, middleware) and look for two that point at each other.',
    ],
    aka: ['loop', 'too many redirects', 'redirect loop', 'err_too_many_redirects'],
  },
  {
    id: '511', status: 511, name: 'Network Authentication Required', group: '5xx', hop: 'browser',
    means: 'The Wi-Fi network wants you to log in first, like a hotel or airport sign-in page.',
    causes: [c('Any', 'You’re on a captive-portal Wi-Fi that hasn’t been accepted yet.')],
    fixes: ['Open any http page to get the Wi-Fi login screen, accept it, and try again.'],
    aka: ['wifi', 'captive portal'],
  },

  // ---------- Cloudflare ----------
  {
    id: '520', status: 520, name: 'Web server returned an unknown error', group: 'Cloudflare', hop: 'app',
    means: 'Cloudflare reached your server, but the answer was empty or broken.',
    causes: [
      c('Cloudflare', 'Your server crashed or closed the connection mid-answer.'),
      c('Cloudflare', 'The response headers are too big (often huge cookies), or the response is malformed.'),
    ],
    fixes: ['Check your server’s own logs at the time of the error. Load the server directly (without Cloudflare) to see the real error.'],
    aka: ['unknown error', 'cloudflare'],
  },
  {
    id: '521', status: 521, name: 'Web server is down', group: 'Cloudflare', hop: 'app',
    means: 'Cloudflare tried to connect to your server and was refused. The server is off, or blocking Cloudflare.',
    causes: [
      c('Cloudflare', 'The app or server isn’t running.'),
      c('Cloudflare', 'A firewall on the server blocks Cloudflare’s IP addresses.'),
    ],
    fixes: ['Start or restart the server. Make sure its firewall allows Cloudflare’s IP ranges.'],
    aka: ['server down', 'cloudflare'],
  },
  {
    id: '522', status: 522, name: 'Connection timed out', group: 'Cloudflare', hop: 'app',
    means: 'Cloudflare couldn’t even open a connection to your server in time.',
    causes: [
      c('Cloudflare', 'The DNS record points to the wrong IP address, or an old server.'),
      c('Cloudflare', 'The server is overloaded or a firewall silently drops Cloudflare.'),
    ],
    fixes: ['Check the A / CNAME record in Cloudflare DNS points at your current host. If your host gives a CNAME target, use exactly that.'],
    aka: ['connection timed out', 'cloudflare'],
  },
  {
    id: '523', status: 523, name: 'Origin is unreachable', group: 'Cloudflare', hop: 'edge',
    means: 'Cloudflare can’t find a route to your server at all.',
    causes: [c('Cloudflare', 'The DNS record points to an address that doesn’t exist any more, e.g. after moving hosts.')],
    fixes: ['Update the DNS record to your host’s current address or CNAME target.'],
    aka: ['unreachable', 'cloudflare'],
  },
  {
    id: '524', status: 524, name: 'A timeout occurred', group: 'Cloudflare', hop: 'app',
    means: 'Cloudflare connected to your server, but the server took over 100 seconds to answer.',
    causes: [c('Cloudflare', 'A long job (AI generation, export, big query) runs inside the request.')],
    fixes: ['Stream the response, or move the work to a background job and let the page check back for the result.'],
    aka: ['timeout', 'cloudflare'],
  },
  {
    id: '525', status: 525, name: 'SSL handshake failed', group: 'Cloudflare', hop: 'edge',
    means: 'Cloudflare and your server couldn’t agree on a secure (https) connection.',
    causes: [c('Cloudflare', 'SSL mode is “Full” or “Full (strict)” but your server has no working https.')],
    fixes: ['Set up a certificate on your server (most hosts do this for you once the domain is added), or check the SSL/TLS mode in Cloudflare.'],
    aka: ['ssl', 'https', 'handshake', 'cloudflare'],
  },
  {
    id: '526', status: 526, name: 'Invalid SSL certificate', group: 'Cloudflare', hop: 'edge',
    means: 'Your server’s https certificate is expired, self-signed, or for another domain, and Cloudflare is set to check it.',
    causes: [c('Cloudflare', 'SSL mode “Full (strict)” with a certificate that doesn’t match the domain, often right after adding the domain to a host.')],
    fixes: ['Add the domain in your host so it issues a certificate, wait for it to be ready, then retry. Avoid switching to “Flexible”, which hides the problem.'],
    aka: ['ssl', 'certificate', 'cloudflare'],
  },
  {
    id: '530', status: 530, name: 'Origin DNS error', group: 'Cloudflare', hop: 'edge',
    means: 'Shown with a second number (often 1016): Cloudflare can’t look up your server’s address.',
    causes: [c('Cloudflare', 'The CNAME points at a host name that no longer exists, e.g. a deleted Pages or Railway project.')],
    fixes: ['Fix the DNS record so it points at a live host name. The second error number on the page says which kind of problem it is.'],
    aka: ['1016', 'dns', 'cloudflare'],
  },
  {
    id: '1020', status: 403, name: 'Access denied (Cloudflare 1020)', group: 'Cloudflare', hop: 'edge',
    means: 'A Cloudflare firewall rule blocked this visitor.',
    causes: [c('Cloudflare', 'A WAF custom rule, a country block, or Bot Fight Mode matched this request.')],
    fixes: ['If it’s your site, open Security, then Events, in Cloudflare and find the rule that matched. If not, the site owner has blocked you.'],
    aka: ['access denied', 'firewall', 'cloudflare'],
  },
  {
    id: '1015', status: 429, name: 'You are being rate limited (Cloudflare 1015)', group: 'Cloudflare', hop: 'edge',
    means: 'A Cloudflare rate limiting rule stopped this visitor for sending too many requests.',
    causes: [c('Cloudflare', 'A rate limiting rule’s threshold is too low, or a script or loop is hammering the site.')],
    fixes: ['Find the loop sending the requests, or raise the rule’s threshold in Security, then WAF, then Rate limiting rules.'],
    aka: ['rate limit', 'cloudflare'],
  },

  // ---------- Vercel ----------
  {
    id: 'FUNCTION_INVOCATION_FAILED', status: 500, name: 'Function crashed', group: 'Vercel', hop: 'app',
    means: 'Your server code (an API route, server component or Server Action) threw an error that nothing caught.',
    causes: [
      c('Vercel', 'A missing env var in production.'),
      c('Next.js', 'Code that only works in the browser (window, localStorage) ran on the server.'),
      c('Supabase', 'A database call failed and the error wasn’t handled.'),
    ],
    fixes: ['Open the project’s Logs in Vercel, filter by Errors, and read the stack trace for this request.', 'Check production env vars and redeploy.'],
    aka: ['500', 'vercel', 'crash'],
  },
  {
    id: 'FUNCTION_INVOCATION_TIMEOUT', status: 504, name: 'Function timed out', group: 'Vercel', hop: 'app',
    means: 'Your server code ran longer than the time limit Vercel allows, so Vercel stopped it.',
    causes: [
      c('Vercel', 'Waiting for a full AI response, a slow outside API, or a slow database query.'),
      c('Vercel', 'A promise that never resolves, e.g. a missing await or a request with no timeout.'),
    ],
    fixes: ['Stream AI responses. Raise maxDuration for the route if your plan allows. Move long jobs to a background task.'],
    aka: ['504', 'vercel', 'timeout'],
  },
  {
    id: 'NO_RESPONSE_FROM_FUNCTION', status: 502, name: 'Function sent nothing back', group: 'Vercel', hop: 'app',
    means: 'The function ended without returning a response.',
    causes: [c('Next.js', 'A route handler has a code path that returns nothing, or the process crashed.')],
    fixes: ['Make sure every path in the route returns a Response (including errors), then check the logs for crashes.'],
    aka: ['502', 'vercel'],
  },
  {
    id: 'FUNCTION_PAYLOAD_TOO_LARGE', status: 413, name: 'Request body too big', group: 'Vercel', hop: 'edge',
    means: 'The data sent to the function is bigger than Vercel accepts (a few MB).',
    causes: [c('Vercel', 'A file upload or a base64 image is sent through an API route.')],
    fixes: ['Upload files straight to storage from the browser with a signed URL, and send only the path to your API.'],
    aka: ['413', 'vercel', 'upload'],
  },
  {
    id: 'MIDDLEWARE_INVOCATION_FAILED', status: 500, name: 'Middleware crashed', group: 'Vercel', hop: 'edge',
    means: 'Your middleware threw an error, so every page it runs on fails.',
    causes: [
      c('Next.js', 'Middleware uses a Node-only package that doesn’t run on the Edge runtime.'),
      c('Supabase', 'The Supabase URL or key env var is missing, so creating the client throws.'),
    ],
    fixes: ['Check Vercel logs for the middleware error. Keep middleware small, use Edge-safe packages, and check env vars.'],
    aka: ['500', 'vercel', 'middleware'],
  },
  {
    id: 'EDGE_FUNCTION_INVOCATION_TIMEOUT', status: 504, name: 'Edge function timed out', group: 'Vercel', hop: 'app',
    means: 'An Edge function didn’t start sending a response in time.',
    causes: [c('Vercel', 'Waiting on a slow API before sending the first byte.')],
    fixes: ['Start streaming the response right away, or move the route to the Node runtime with a longer maxDuration.'],
    aka: ['504', 'vercel', 'edge'],
  },
  {
    id: 'DEPLOYMENT_NOT_FOUND', status: 404, name: 'Deployment not found', group: 'Vercel', hop: 'edge',
    means: 'Vercel has no deployment at this address. The domain or preview link doesn’t point at a live deployment.',
    causes: [
      c('Vercel', 'The deployment was deleted, or the domain isn’t added to the project.'),
      c('Vercel', 'An old preview URL or a typo in the address.'),
    ],
    fixes: ['In Vercel, open the project’s Domains settings and check the domain is listed and valid. Use the latest deployment’s URL.'],
    aka: ['404', 'vercel'],
  },
  {
    id: 'NOT_FOUND', status: 404, name: 'Not found (Vercel)', group: 'Vercel', hop: 'app',
    means: 'The deployment is live, but nothing in it matches this path.',
    causes: [
      c('Vercel', 'A Vite or React single-page app with no rewrite to index.html, so refreshing a sub-page 404s.'),
      c('Vercel', 'The wrong output folder or framework preset, so the built files aren’t where Vercel looks.'),
    ],
    fixes: ['Check the Framework Preset and Output Directory in project settings. For single-page apps, add a rewrite of every path to /index.html in vercel.json.'],
    aka: ['404', 'vercel'],
  },
  {
    id: 'INFINITE_LOOP_DETECTED', status: 508, name: 'Infinite loop', group: 'Vercel', hop: 'edge',
    means: 'A rewrite, redirect or middleware keeps sending the request back to itself.',
    causes: [c('Next.js', 'Middleware rewrites or redirects to a path that it also matches.')],
    fixes: ['Exclude the target path from the middleware matcher, and check vercel.json rewrites for circles.'],
    aka: ['508', 'vercel', 'loop'],
  },
  {
    id: 'DEPLOYMENT_PAUSED', status: 503, name: 'Deployment paused', group: 'Vercel', hop: 'edge',
    means: 'The project is paused, so Vercel isn’t serving it.',
    causes: [c('Vercel', 'The project was paused by hand or hit a spend limit.')],
    fixes: ['Open the project in Vercel and resume it, or check your spend management settings.'],
    aka: ['503', 'vercel', 'paused'],
  },
  {
    id: 'DEPLOYMENT_DISABLED', status: 402, name: 'Deployment disabled', group: 'Vercel', hop: 'edge',
    means: 'The deployment is turned off, usually because the account went over its plan’s usage limits.',
    causes: [c('Vercel', 'Hobby plan usage limits were exceeded, or a payment failed.')],
    fixes: ['Check Usage and Billing in your Vercel account.'],
    aka: ['402', 'vercel'],
  },

  // ---------- Netlify ----------
  {
    id: 'netlify-404', status: 404, name: 'Page not found (Netlify)', group: 'Netlify', hop: 'edge',
    means: '“Looks like you’ve followed a broken link”: Netlify has no file for this path.',
    causes: [
      c('Netlify', 'A Vite or React single-page app with no _redirects rule, so refreshing on a sub-page 404s.'),
      c('Netlify', 'The publish directory is wrong (e.g. build instead of dist), so nothing was deployed.'),
    ],
    fixes: ['Add a file public/_redirects with the line /*  /index.html  200. Check the publish directory in Site configuration, then Build & deploy.'],
    aka: ['404', 'netlify', 'broken link'],
  },
  {
    id: 'netlify-function-timeout', status: 502, name: 'Function timed out (Netlify)', group: 'Netlify', hop: 'app',
    means: '“Task timed out after 10.00 seconds”: a Netlify Function ran past its time limit.',
    causes: [c('Netlify', 'The function waits on an AI call, a slow API or a slow query.')],
    fixes: ['Stream the response or use a Background Function for long work, and add timeouts to outside calls.'],
    aka: ['502', 'netlify', 'timeout', 'task timed out', 'sandbox.timedout'],
  },
  {
    id: 'netlify-function-crash', status: 502, name: 'Function crashed (Netlify)', group: 'Netlify', hop: 'app',
    means: 'A Netlify Function threw an error, so Netlify returned a 502 with the error in the body.',
    causes: [
      c('Netlify', 'A missing env var or package in the deployed function.'),
      c('Netlify', 'The function doesn’t return a valid response object.'),
    ],
    fixes: ['Open Logs, then Functions in Netlify, pick the function, and read the error. Check env vars are set for the right deploy context.'],
    aka: ['502', 'netlify', 'function invocation failed'],
  },
];

const BY_ID = new Map(CODES.map((x) => [x.id.toLowerCase(), x]));

export function findById(id: string): StatusCode | undefined {
  return BY_ID.get(id.trim().toLowerCase());
}

// Codes nobody wrote an entry for (e.g. 299) still get a plain-English class explanation.
export function fallback(status: number): StatusCode | undefined {
  if (!Number.isInteger(status) || status < 100 || status > 599) return undefined;
  const group = `${Math.floor(status / 100)}xx` as Group;
  const generic: Record<string, Omit<StatusCode, 'id' | 'status' | 'group'>> = {
    '1xx': { name: 'Informational', hop: null, means: 'A “hold on” message before the real answer. Not an error.', causes: [], fixes: ['Nothing to fix.'] },
    '2xx': { name: 'Success', hop: null, means: 'Some kind of success. Not an error.', causes: [], fixes: ['Nothing to fix.'] },
    '3xx': { name: 'Redirect', hop: 'edge', means: 'Some kind of redirect: the thing lives at another address.', causes: [], fixes: ['Check where it redirects with the Network tab.'] },
    '4xx': { name: 'Request problem', hop: 'browser', means: 'Not a standard code, but every 4xx means the server refused this request: something about the request is wrong.', causes: [], fixes: ['Read the response body in the Network tab; the service that sent it usually explains.'] },
    '5xx': { name: 'Server problem', hop: 'app', means: 'Not a standard code, but every 5xx means something broke on the server side.', causes: [], fixes: ['Check the server’s logs, or the status page of the service that answered.'] },
  };
  return { id: String(status), status, group, ...generic[group] };
}

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[_\-.]/g, ' ').trim();

// Search by number, name, Vercel/Cloudflare code or plain words like "timeout".
export function search(q: string): StatusCode[] {
  const n = norm(q);
  if (!n) return [];
  const words = n.split(/\s+/);
  const scored: { x: StatusCode; s: number }[] = [];
  for (const x of CODES) {
    const id = norm(x.id);
    const hay = [x.name, ...(x.aka ?? [])].map(norm).join(' | ');
    let s = 0;
    if (id === n) s = 100;
    else if (String(x.status) === n) s = 80;
    else if (id.startsWith(n)) s = 60;
    else if (/^\d+$/.test(n) && String(x.status).startsWith(n)) s = 40;
    else if (words.every((w) => hay.includes(w) || id.includes(w))) s = 20 + (x.common ? 5 : 0);
    else if (words.every((w) => norm(x.means).includes(w))) s = 5;
    if (s) scored.push({ x, s: s + (x.group.endsWith('xx') ? 1 : 0) });
  }
  return scored.sort((a, b) => b.s - a.s).map((r) => r.x);
}

// The prompt a vibecoder pastes into Claude Code, Cursor or Codex.
export function buildPrompt(x: StatusCode, tags: Tag[]): string {
  const label = x.group === 'Netlify' ? `HTTP ${x.status} on Netlify: ${x.name.replace(' (Netlify)', '')}`
    : x.id === String(x.status) ? `HTTP ${x.status} ${x.name}${x.group === 'Cloudflare' ? ' (a Cloudflare error)' : ''}`
    : `HTTP ${x.status}, ${x.group} error ${x.id} (${x.name})`;
  const causes = x.causes.filter((k) => !tags.length || k.tag === 'Any' || tags.includes(k.tag));
  const lines = [
    `My app returns ${label}.`,
    '',
    `What it means: ${x.means}`,
  ];
  if (tags.length) lines.push('', `My stack: ${tags.join(', ')}.`);
  if (causes.length) {
    lines.push('', 'Usual causes in a setup like mine:');
    for (const k of causes) lines.push(`- ${k.tag === 'Any' ? '' : `(${k.tag}) `}${k.text}`);
  }
  if (x.fixes.length) {
    lines.push('', 'Things to check:');
    for (const f of x.fixes) lines.push(`- ${f}`);
  }
  lines.push(
    '',
    'Please:',
    '1. Find which request returns this code and which of these causes applies. Look at the code, the config and the server logs; don’t guess.',
    '2. Fix it in the code or config.',
    '3. Tell me in plain words what was wrong, what you changed, and how I can check it works.',
  );
  return lines.join('\n');
}
