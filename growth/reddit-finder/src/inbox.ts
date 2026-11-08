import type { Env } from './env';
import { judgedToday } from './run';

export interface Row {
  id: string;
  source: string;
  url: string;
  title: string;
  body: string;
  community: string;
  author: string;
  posted_at: number;
  status: string;
  fit: number | null;
  why: string | null;
  mention: number | null;
  draft: string | null;
}

interface RunRow {
  at: number;
  source: string;
  ok: number;
  found: number;
  judged: number;
  error: string | null;
}

export const TABS = {
  reply: { label: 'To reply', where: `status = 'judged' AND fit >= 6` },
  maybe: { label: 'Maybe', where: `status = 'judged' AND fit BETWEEN 4 AND 5` },
  done: { label: 'Done', where: `status IN ('replied', 'dismissed')` },
} as const;
export type Tab = keyof typeof TABS;

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

function ago(unix: number): string {
  const s = Math.max(0, Date.now() / 1000 - unix);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

const CSS = `
:root{--sky:#0593C6;--pink:#D83995;--bg:#FCFFFF;--card:#fff;--ink:#0B2230;--soft:#4A6472;--line:#D7E9F0;--wash:#EEF8FB;--ok:#1F8A4C;--bad:#B3261E}
@media (prefers-color-scheme:dark){:root{--bg:#0B1A22;--card:#10252F;--ink:#E6F3F8;--soft:#9DB6C2;--line:#21414F;--wash:#132D39;--ok:#5BC98A;--bad:#F08A80}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:860px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:22px;margin:0 0 4px}.sub{color:var(--soft);margin:0 0 20px}
.status{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 20px;align-items:center}
.pill{border:1px solid var(--line);border-radius:999px;padding:4px 12px;font-size:13px;background:var(--wash)}
.pill.ok b{color:var(--ok)}.pill.bad b{color:var(--bad)}
nav{display:flex;gap:4px;border-bottom:1px solid var(--line);margin-bottom:16px}
nav a{padding:8px 14px;text-decoration:none;color:var(--soft);border-bottom:2px solid transparent;margin-bottom:-1px}
nav a.on{color:var(--ink);border-color:var(--sky);font-weight:600}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:0 0 14px}
.meta{font-size:13px;color:var(--soft);display:flex;gap:10px;flex-wrap:wrap}
.fit{font-weight:700;color:var(--sky)}.fit.hi{color:var(--pink)}
.card h2{font-size:17px;margin:6px 0}.card h2 a{color:inherit}
.why{margin:6px 0 10px;color:var(--soft)}
details{margin:0 0 10px}summary{cursor:pointer;color:var(--soft);font-size:13px}
.post{white-space:pre-wrap;font-size:14px;background:var(--wash);padding:10px;border-radius:8px;max-height:240px;overflow:auto}
textarea{width:100%;min-height:120px;font:inherit;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink)}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
button,.btn{font:inherit;font-size:14px;padding:7px 14px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer;text-decoration:none}
.primary{background:var(--sky);border-color:var(--sky);color:#fff}
form.inline{display:inline}
.tag{font-size:12px;border-radius:6px;padding:1px 6px;background:var(--wash);border:1px solid var(--line)}
.empty{color:var(--soft);text-align:center;padding:40px 0}
.note{background:var(--wash);border:1px solid var(--line);border-radius:10px;padding:10px 14px;margin:0 0 16px;font-size:14px}
`;

export function page(title: string, body: string): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${CSS}</style></head><body><main>${body}</main></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin' } },
  );
}

export function loginPage(error = false): Response {
  return page(
    'Thread finder',
    `<h1>Darnly thread finder</h1><p class="sub">Private. Enter the inbox key you set with <code>wrangler secret put INBOX_KEY</code>.</p>
    ${error ? '<p class="note">That key didn\'t match. Try again.</p>' : ''}
    <form method="post" action="/login" class="card"><input type="password" name="key" autocomplete="current-password" required style="width:100%;padding:10px;font:inherit;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink)"><div class="row"><button class="primary">Open inbox</button></div></form>`,
  );
}

function card(r: Row, tab: Tab): string {
  const fit = r.fit ?? 0;
  const where = r.source === 'hn' ? 'Hacker News' : `r/${esc(r.community)}`;
  const back = `<input type="hidden" name="tab" value="${tab}">`;
  const actions =
    tab === 'done'
      ? `<form class="inline" method="post" action="/post/${encodeURIComponent(r.id)}/undo">${back}<button>Move back</button></form>`
      : `<form class="inline" method="post" action="/post/${encodeURIComponent(r.id)}/replied">${back}<button class="primary">I replied</button></form>
         <form class="inline" method="post" action="/post/${encodeURIComponent(r.id)}/dismiss">${back}<button>Skip</button></form>`;
  return `<article class="card">
    <div class="meta"><span class="fit${fit >= 8 ? ' hi' : ''}">Fit ${fit}/10</span><span>${where}</span><span>${ago(r.posted_at)}</span>${r.author ? `<span>u/${esc(r.author)}</span>` : ''}${r.mention ? '<span class="tag">mentions Darnly</span>' : '<span class="tag">no Darnly mention</span>'}${tab === 'done' ? `<span class="tag">${r.status === 'replied' ? 'replied' : 'skipped'}</span>` : ''}</div>
    <h2><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a></h2>
    <p class="why">${esc(r.why ?? '')}</p>
    ${r.body ? `<details><summary>Read the post</summary><div class="post">${esc(r.body)}</div></details>` : ''}
    ${r.draft ? `<textarea aria-label="Draft reply">${esc(r.draft)}</textarea>` : ''}
    <div class="row">
      ${r.draft ? '<button type="button" class="copy">Copy reply</button>' : ''}
      <a class="btn" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">Open thread</a>
      ${actions}
    </div>
  </article>`;
}

function statusPills(runs: RunRow[], today: number, env: Env): string {
  const latest = (source: string) => runs.find((r) => r.source === source);
  const pill = (label: string, r?: RunRow) =>
    !r
      ? `<span class="pill">${label}: <b>not run yet</b></span>`
      : r.ok
        ? `<span class="pill ok">${label}: <b>working</b>, ${r.found} new, ${ago(r.at)}</span>`
        : `<span class="pill bad" title="${esc(r.error ?? '')}">${label}: <b>failing</b> (${esc(r.error ?? 'error')}), ${ago(r.at)}</span>`;
  const claude = env.ANTHROPIC_API_KEY
    ? `<span class="pill">Claude: ${today}/${env.MAX_JUDGE_PER_DAY} posts checked today</span>`
    : `<span class="pill bad">Claude: <b>no API key yet</b></span>`;
  return `<div class="status">${pill('Reddit', latest('reddit'))}${pill('Hacker News', latest('hn'))}${claude}
    <form class="inline" method="post" action="/run"><button>Search now</button></form></div>`;
}

const COPY_JS = `<script>document.addEventListener('click',async e=>{const b=e.target.closest('.copy');if(!b)return;const t=b.closest('.card').querySelector('textarea');try{await navigator.clipboard.writeText(t.value)}catch{t.select();document.execCommand('copy')}const o=b.textContent;b.textContent='Copied';setTimeout(()=>b.textContent=o,1500)})</script>`;

export async function inboxPage(env: Env, tab: Tab, notice?: string): Promise<Response> {
  const [{ results: rows }, { results: runs }, today, counts] = await Promise.all([
    env.DB.prepare(`SELECT * FROM posts WHERE ${TABS[tab].where} ORDER BY ${tab === 'done' ? 'judged_at DESC' : 'fit DESC, posted_at DESC'} LIMIT 50`).all<Row>(),
    env.DB.prepare('SELECT * FROM runs ORDER BY at DESC, rowid DESC LIMIT 20').all<RunRow>(),
    judgedToday(env),
    Promise.all((Object.keys(TABS) as Tab[]).map(async (t) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM posts WHERE ${TABS[t].where}`).first<{ n: number }>())?.n ?? 0)),
  ]);
  const nav = (Object.keys(TABS) as Tab[])
    .map((t, i) => `<a href="/?tab=${t}" class="${t === tab ? 'on' : ''}">${TABS[t].label} (${counts[i]})</a>`)
    .join('');
  const empty =
    tab === 'reply'
      ? 'Nothing to reply to right now. The finder searches every hour.'
      : tab === 'maybe'
        ? 'No borderline posts.'
        : 'Nothing marked yet.';
  return page(
    'Thread finder',
    `<h1>Darnly thread finder</h1>
    <p class="sub">Posts where a reply from you could help. Read the post, edit the draft, post it yourself, then press I replied. Check each community's self-promotion rules first.</p>
    ${notice ? `<p class="note">${esc(notice)}</p>` : ''}
    ${statusPills(runs, today, env)}
    <nav>${nav}</nav>
    ${rows.length ? rows.map((r) => card(r, tab)).join('') : `<p class="empty">${empty}</p>`}
    ${COPY_JS}`,
  );
}
