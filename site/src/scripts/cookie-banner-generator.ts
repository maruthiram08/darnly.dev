// Cookie banner generator: everything runs in the visitor's browser. Nothing is uploaded.
// It builds a small copy-paste snippet (HTML + CSS + JS, no dependency) and shows it live on a mock page.

export {};

type Style = 'bar' | 'corner' | 'modal';
type State = {
  style: Style;
  place: 'bottom' | 'top' | 'left' | 'right';
  bg: string;
  fg: string;
  accent: string;
  radius: number;
  title: string;
  message: string;
  policy: string;
  accept: string;
  reject: string;
  custom: string;
  analytics: boolean;
  marketing: boolean;
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const PRESETS: Record<string, Pick<State, 'bg' | 'fg' | 'accent'>> = {
  light: { bg: '#FFFFFF', fg: '#1F2937', accent: '#111827' },
  dark: { bg: '#111827', fg: '#F9FAFB', accent: '#38BDF8' },
  sky: { bg: '#EEF8FB', fg: '#0B2230', accent: '#0593C6' },
  warm: { bg: '#FFF7ED', fg: '#431407', accent: '#EA580C' },
};

const state: State = {
  style: 'bar',
  place: 'bottom',
  ...PRESETS.light,
  radius: 10,
  title: '',
  message: 'We use cookies to keep this site working and, if you agree, to see how it’s used. You can change your mind any time.',
  policy: '/privacy',
  accept: 'Accept all',
  reject: 'Reject all',
  custom: 'Customize',
  analytics: true,
  marketing: false,
};

// ---------- Building the snippet ----------

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function hex(v: string, fallback: string): string {
  const t = v.trim();
  if (/^#[0-9a-f]{6}$/i.test(t)) return t.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(t)) return ('#' + t.slice(1).split('').map((c) => c + c).join('')).toUpperCase();
  return fallback;
}

// Text color that reads best on a button of the given color.
function onColor(h: string): string {
  const n = parseInt(h.slice(1), 16);
  const lin = (c: number) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return (1.05 / (L + 0.05)) >= ((L + 0.05) / 0.05) ? '#FFFFFF' : '#111111';
}

function safeUrl(u: string): string {
  const t = u.trim();
  if (!t) return '';
  // Only plain links: a path, a #anchor or an http(s) address.
  return /^(\/|#|https?:\/\/)/i.test(t) ? t : '';
}

const cats = (s: State) => [s.analytics && 'analytics', s.marketing && 'marketing'].filter(Boolean) as string[];
const label = (c: string) => c[0].toUpperCase() + c.slice(1);

function html(s: State): string {
  const list = cats(s);
  const policy = safeUrl(s.policy);
  const title = s.title.trim() ? `<p class="ckb-title">${esc(s.title.trim())}</p>` : '';
  const link = policy ? ` <a href="${esc(policy)}">Privacy policy</a>` : '';
  const boxes = list.length
    ? `\n    <div class="ckb-cats" hidden>\n      <label><input type="checkbox" checked disabled> Necessary</label>\n${list
        .map((c) => `      <label><input type="checkbox" data-ckb="${c}"> ${label(c)}</label>`)
        .join('\n')}\n    </div>`
    : '';
  const buttons = list.length
    ? `<button type="button" data-ckb-act="reject">${esc(s.reject)}</button>\n      <button type="button" data-ckb-act="custom">${esc(s.custom)}</button>\n      <button type="button" data-ckb-act="accept" class="ckb-main">${esc(s.accept)}</button>`
    : `<button type="button" data-ckb-act="accept" class="ckb-main">Got it</button>`;
  return `<div id="ckb" class="ckb-${s.style}" role="dialog" aria-label="Cookie consent"${s.style === 'modal' ? ' aria-modal="true"' : ''} hidden>
  <div class="ckb-box">
    <div class="ckb-msg">${title}<p>${esc(s.message.trim())}${link}</p></div>${boxes}
    <div class="ckb-btns">
      ${buttons}
    </div>
  </div>
</div>`;
}

function css(s: State): string {
  const r = `${s.radius}px`;
  const on = onColor(s.accent);
  const where: Record<Style, string> = {
    bar: `#ckb{left:0;right:0;${s.place === 'top' ? 'top' : 'bottom'}:0}#ckb .ckb-box{border-radius:0}#ckb .ckb-cats{flex-basis:100%}`,
    corner: `#ckb{bottom:16px;${s.place === 'left' ? 'left' : 'right'}:16px;width:380px;max-width:calc(100% - 32px)}#ckb .ckb-box{flex-direction:column;align-items:stretch}#ckb .ckb-msg{flex:none}`,
    modal: `#ckb{inset:0;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.45)}#ckb .ckb-box{max-width:460px;flex-direction:column;align-items:stretch;padding:24px}#ckb .ckb-msg{flex:none}`,
  };
  return `#ckb{position:fixed;z-index:2147483000;font-size:14px;line-height:1.5;color:${s.fg}}
#ckb[hidden],#ckb [hidden]{display:none!important}
#ckb .ckb-box{display:flex;flex-wrap:wrap;align-items:center;gap:12px 20px;padding:16px 20px;background:${s.bg};border-radius:${r};box-shadow:0 8px 30px rgba(0,0,0,.18)}
#ckb .ckb-msg{flex:1 1 320px}#ckb p{margin:0}#ckb a{color:inherit}
#ckb .ckb-title{font-weight:700;font-size:16px;margin-bottom:4px}
#ckb .ckb-cats{display:flex;flex-wrap:wrap;gap:8px 18px}#ckb label{display:flex;gap:6px;align-items:center}
#ckb .ckb-btns{display:flex;flex-wrap:wrap;gap:8px}
#ckb button{font:inherit;font-weight:600;padding:9px 16px;border-radius:${r};border:1.5px solid ${s.accent};background:transparent;color:inherit;cursor:pointer}
#ckb .ckb-main{background:${s.accent};color:${on}}
${where[s.style]}`;
}

// The snippet's own script. It must stay small and plain: no dependency, works in any browser from the last years.
const JS = `(function(){var K='cookie-consent',b=document.getElementById('ckb');if(!b)return;
var box=b.querySelector('.ckb-cats'),cu=b.querySelector('[data-ckb-act=custom]'),ins=b.querySelectorAll('[data-ckb]');
function get(){try{return JSON.parse(localStorage.getItem(K))}catch(e){return null}}
function load(c){document.querySelectorAll('script[type="text/plain"][data-cookie-category]').forEach(function(s){
if(!c[s.dataset.cookieCategory]||s.dataset.ckbOn)return;s.dataset.ckbOn=1;var n=document.createElement('script');
for(var i=0;i<s.attributes.length;i++){var a=s.attributes[i];if(a.name!='type')n.setAttribute(a.name,a.value)}
n.text=s.text;s.parentNode.insertBefore(n,s.nextSibling)})}
function set(c){c.necessary=true;c.date=Date.now();try{localStorage.setItem(K,JSON.stringify(c))}catch(e){}
b.hidden=true;load(c);document.dispatchEvent(new CustomEvent('cookieconsent',{detail:c}))}
function all(v){var c={};ins.forEach(function(i){c[i.dataset.ckb]=v});return c}
function open(){var c=get()||{};ins.forEach(function(i){i.checked=!!c[i.dataset.ckb]});if(box){box.hidden=false;cu.textContent='Save choices'}b.hidden=false}
b.addEventListener('click',function(e){var a=e.target.closest('[data-ckb-act]');if(!a)return;a=a.dataset.ckbAct;
if(a=='accept')set(all(true));else if(a=='reject')set(all(false));
else if(box.hidden){box.hidden=false;cu.textContent='Save choices'}else{var c={};ins.forEach(function(i){c[i.dataset.ckb]=i.checked});set(c)}});
document.addEventListener('click',function(e){if(e.target.closest('[data-cookie-settings]')){e.preventDefault();open()}});
var c=get();if(c)load(c);else b.hidden=false})();`;

function snippet(s: State): string {
  return `<!-- Cookie banner made with darnly.dev/tools/cookie-banner-generator/ -->
${html(s)}
<style>
${css(s)}
</style>
<script>
${JS}
</script>`;
}

const GATE_EXAMPLE = `<!-- Before: loads for everyone -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXX"></script>

<!-- After: loads only once the visitor allows analytics -->
<script type="text/plain" data-cookie-category="analytics" async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXX"></script>
<script type="text/plain" data-cookie-category="analytics">
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXX');
</script>

<!-- A link anywhere (for example your footer) that opens the banner again -->
<a href="#" data-cookie-settings>Cookie settings</a>`;

function prompt(s: State): string {
  const list = cats(s);
  return `Add this cookie consent banner to my site.

1. Put the snippet below once, in the main layout, just before </body>, so it shows on every page. If my framework does not run inline <script> tags (for example React or Next.js), move the script part into its own file and load it on every page, keeping the HTML and CSS as they are.
${
  list.length
    ? `2. Find every ${list.join(' and ')} script in the project (Google Analytics, Google Tag Manager, Meta Pixel, Hotjar, etc.). Change each one so it only loads after consent: set type="text/plain" and add data-cookie-category="${list[0]}"${list.length > 1 ? ' (or "marketing" for ad and tracking pixels)' : ''}. Keep its src and code the same. If a script is added from JavaScript or a package instead of a tag, only start it after the "cookieconsent" event fires on document with detail.${list[0]} === true, or when localStorage "cookie-consent" already says so.
3. Add a "Cookie settings" link in the footer: <a href="#" data-cookie-settings>Cookie settings</a>. Clicking it opens the banner again.`
    : `2. Add a "Cookie settings" link in the footer: <a href="#" data-cookie-settings>Cookie settings</a>.`
}
Do not change the banner's look or text. Tell me which files you changed.

${snippet(s)}`;
}

// ---------- Page ----------

const mock = $<HTMLDivElement>('cb-mock');
const mount = $<HTMLDivElement>('cb-mount');
const styleEl = document.createElement('style');
document.head.appendChild(styleEl);
const sizeEl = $<HTMLElement>('cb-size');
const gaEl = $<HTMLElement>('cb-ga');
const gaText = $<HTMLElement>('cb-ga-text');
const replay = $<HTMLButtonElement>('cb-replay');
const code = $<HTMLElement>('cb-code');
const gate = $<HTMLElement>('cb-gate');
const status = $<HTMLParagraphElement>('cb-status');
const placeWrap = $<HTMLDivElement>('cb-place');
const catsNone = $<HTMLParagraphElement>('cb-cats-none');

type Choice = Record<string, boolean> | null;
let choice: Choice = null;

function setGa() {
  const list = cats(state);
  gaEl.classList.remove('wait', 'on', 'off', 'none');
  if (!list.length) {
    gaEl.classList.add('none');
    gaText.textContent = 'No analytics to block';
  } else if (!choice) {
    gaEl.classList.add('wait');
    gaText.textContent = 'Analytics waits for a choice';
  } else {
    const on = list.filter((c) => choice![c]);
    gaEl.classList.add(on.length ? 'on' : 'off');
    gaText.textContent = on.length ? `Loaded: ${on.map(label).join(' and ')}` : 'Analytics stays off';
  }
  replay.hidden = !choice;
}

function render() {
  const snip = snippet(state);
  styleEl.textContent = css(state);
  mount.innerHTML = html(state);
  const banner = mount.querySelector<HTMLElement>('#ckb')!;
  banner.hidden = !!choice;
  code.textContent = snip;
  gate.textContent = GATE_EXAMPLE;
  const bytes = new TextEncoder().encode(snip).length;
  sizeEl.textContent = `${(bytes / 1024).toFixed(1)} KB · no dependencies`;
  mock.dataset.style = state.style;
  // The position choices depend on the style.
  placeWrap.hidden = state.style === 'modal';
  placeWrap.querySelectorAll<HTMLInputElement>('input').forEach((i) => {
    const forBar = i.value === 'bottom' || i.value === 'top';
    (i.closest('label') as HTMLElement).hidden = state.style === 'bar' ? !forBar : forBar;
    i.checked = i.value === state.place;
  });
  catsNone.hidden = cats(state).length > 0;
  setGa();
}

// The preview cannot run the snippet's inline script (this page's security policy blocks inline scripts),
// so these handlers act the same way on the mock page.
mount.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-ckb-act]');
  if (!btn) return;
  const banner = mount.querySelector<HTMLElement>('#ckb')!;
  const box = banner.querySelector<HTMLElement>('.ckb-cats');
  const ins = [...banner.querySelectorAll<HTMLInputElement>('[data-ckb]')];
  const act = btn.dataset.ckbAct;
  if (act === 'custom' && box && box.hidden) {
    box.hidden = false;
    btn.textContent = 'Save choices';
    return;
  }
  const c: Record<string, boolean> = {};
  ins.forEach((i) => (c[i.dataset.ckb!] = act === 'accept' ? true : act === 'reject' ? false : i.checked));
  choice = c;
  banner.hidden = true;
  setGa();
  say(act === 'accept' ? 'You accepted. The analytics scripts load now.' : act === 'reject' ? 'You rejected. Nothing extra loads.' : 'Choices saved.');
});

function reopen() {
  const banner = mount.querySelector<HTMLElement>('#ckb')!;
  const box = banner.querySelector<HTMLElement>('.ckb-cats');
  banner.querySelectorAll<HTMLInputElement>('[data-ckb]').forEach((i) => (i.checked = !!choice?.[i.dataset.ckb!]));
  if (box) {
    box.hidden = false;
    const cu = banner.querySelector<HTMLElement>('[data-ckb-act=custom]');
    if (cu) cu.textContent = 'Save choices';
  }
  banner.hidden = false;
}

replay.addEventListener('click', () => {
  choice = null;
  render();
  say('');
});
$<HTMLAnchorElement>('cb-settings').addEventListener('click', (e) => {
  e.preventDefault();
  reopen();
});

// ---------- Controls ----------

function bindText(id: string, key: 'title' | 'message' | 'policy' | 'accept' | 'reject' | 'custom') {
  const el = $<HTMLInputElement | HTMLTextAreaElement>(id);
  el.value = state[key];
  el.addEventListener('input', () => {
    state[key] = el.value || (key === 'accept' || key === 'reject' || key === 'custom' ? el.placeholder : el.value);
    render();
  });
}
bindText('cb-title', 'title');
bindText('cb-message', 'message');
bindText('cb-policy', 'policy');
bindText('cb-accept', 'accept');
bindText('cb-reject', 'reject');
bindText('cb-custom', 'custom');

document.querySelectorAll<HTMLInputElement>('input[name="cb-style"]').forEach((i) =>
  i.addEventListener('change', () => {
    state.style = i.value as Style;
    if (state.style === 'bar' && !['bottom', 'top'].includes(state.place)) state.place = 'bottom';
    if (state.style === 'corner' && !['left', 'right'].includes(state.place)) state.place = 'right';
    choice = null;
    render();
  }),
);
document.querySelectorAll<HTMLInputElement>('input[name="cb-place"]').forEach((i) =>
  i.addEventListener('change', () => {
    state.place = i.value as State['place'];
    render();
  }),
);

(['analytics', 'marketing'] as const).forEach((k) => {
  const el = $<HTMLInputElement>(`cb-${k}`);
  el.checked = state[k];
  el.addEventListener('change', () => {
    state[k] = el.checked;
    choice = null;
    render();
  });
});

const colorKeys = ['bg', 'fg', 'accent'] as const;
function syncColors() {
  colorKeys.forEach((k) => {
    $<HTMLInputElement>(`cb-${k}`).value = state[k].toLowerCase();
    const tx = $<HTMLInputElement>(`cb-${k}-text`);
    if (document.activeElement !== tx) tx.value = state[k];
  });
  document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) => {
    const p = PRESETS[b.dataset.preset!];
    b.setAttribute('aria-pressed', String(p.bg === state.bg && p.fg === state.fg && p.accent === state.accent));
  });
}
colorKeys.forEach((k) => {
  const sw = $<HTMLInputElement>(`cb-${k}`);
  const tx = $<HTMLInputElement>(`cb-${k}-text`);
  sw.addEventListener('input', () => {
    state[k] = sw.value.toUpperCase();
    syncColors();
    render();
  });
  tx.addEventListener('input', () => {
    const v = hex(tx.value, '');
    if (!v) return;
    state[k] = v;
    sw.value = v.toLowerCase();
    syncColors();
    render();
  });
});
document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) => {
  const p = PRESETS[b.dataset.preset!];
  b.style.setProperty('--p-bg', p.bg);
  b.style.setProperty('--p-fg', p.fg);
  b.style.setProperty('--p-ac', p.accent);
  b.addEventListener('click', () => {
    Object.assign(state, p);
    syncColors();
    render();
  });
});

const radius = $<HTMLInputElement>('cb-radius');
const radiusOut = $<HTMLOutputElement>('cb-radius-out');
radius.addEventListener('input', () => {
  state.radius = Number(radius.value);
  radiusOut.textContent = `${state.radius}px`;
  render();
});

// ---------- Copy ----------

let sayTimer = 0;
function say(msg: string) {
  status.textContent = msg;
  clearTimeout(sayTimer);
  if (msg) sayTimer = window.setTimeout(() => (status.textContent = ''), 4000);
}

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    say(done);
  } catch {
    say('Your browser blocked copying. Open “See the code” and copy it by hand.');
  }
}

$<HTMLButtonElement>('cb-copy').addEventListener('click', () => copy(snippet(state), 'Copied. Paste it just before </body> on every page.'));
$<HTMLButtonElement>('cb-prompt').addEventListener('click', () => copy(prompt(state), 'Prompt copied. Paste it into Claude Code, Codex or Cursor.'));
$<HTMLButtonElement>('cb-copy-gate').addEventListener('click', () => copy(GATE_EXAMPLE, 'Example copied.'));

syncColors();
render();
