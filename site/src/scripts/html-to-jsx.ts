// HTML to JSX: everything runs in the visitor's browser. Nothing is sent anywhere.
import { convert, previewFragment, componentName, CHANGE_LABELS, type ChangeKey } from './html-to-jsx-core';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('hj-input');
const example = $<HTMLButtonElement>('hj-example');
const clear = $<HTMLButtonElement>('hj-clear');
const preview = $<HTMLDivElement>('hj-preview');
const verdict = $<HTMLDivElement>('hj-verdict');
const vTitle = $<HTMLParagraphElement>('hj-v-title');
const chips = $<HTMLUListElement>('hj-chips');
const warn = $<HTMLUListElement>('hj-warn');
const code = $<HTMLElement>('hj-code');
const codeLab = $<HTMLSpanElement>('hj-code-lab');
const copy = $<HTMLButtonElement>('hj-copy');
const wrap = $<HTMLInputElement>('hj-wrap');
const name = $<HTMLInputElement>('hj-name');
const nameWrap = $<HTMLLabelElement>('hj-name-wrap');
const tw = $<HTMLInputElement>('hj-tw');
const prompt = $<HTMLButtonElement>('hj-prompt');

const EXAMPLE = `<!-- Sign-up card -->
<div class="card" style="max-width: 360px; margin: 0 auto; padding: 24px; border-radius: 16px; background-color: #ffffff; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12); font-family: system-ui, sans-serif; color: #0f172a;">
  <div style="display: flex; align-items: center; gap: 12px;">
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#e5337e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="4"></rect>
      <circle cx="16" cy="16" r="2"></circle>
    </svg>
    <h2 style="margin: 0; font-size: 20px;">Join the beta</h2>
  </div>
  <p style="color: #475569; line-height: 1.5;">Get early access to new features.<br>No spam, ever.</p>
  <label for="email" style="display: block; font-weight: 600; margin-bottom: 4px;">Email</label>
  <input id="email" type="email" placeholder="you@example.com" required style="width: 100%; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; box-sizing: border-box;">
  <label class="terms" style="display: flex; align-items: center; gap: 8px; margin-top: 12px; font-size: 14px;">
    <input type="checkbox" checked> Send me product updates
  </label>
  <button class="btn" type="submit" style="margin-top: 16px; width: 100%; padding: 12px; border: 0; border-radius: 9999px; background-color: #0891b2; color: #ffffff; font-weight: 600; cursor: pointer;">Sign me up</button>
</div>`;

// The preview lives in a shadow root so the pasted CSS can't restyle this page.
const shadow = preview.attachShadow({ mode: 'open' });
const BASE_CSS = `:host { all: initial; display: block; }
.root { min-height: 100%; box-sizing: border-box; padding: 16px; font: 16px/1.5 system-ui, -apple-system, sans-serif; color: #111; background: #fff; }
.empty { display: grid; place-items: center; height: 320px; color: #6b7280; font: 15px/1.5 system-ui, sans-serif; text-align: center; }
img, video, svg { max-width: 100%; }`;

let jsx = '';

function renderPreview(html: string) {
  shadow.replaceChildren();
  const style = document.createElement('style');
  style.textContent = BASE_CSS;
  const root = document.createElement('div');
  root.className = 'root';
  if (html.trim()) root.append(previewFragment(html, document));
  else {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = 'Your HTML shows up here.';
    root.append(e);
  }
  shadow.append(style, root);
}

// Links and forms in the preview shouldn't take the visitor away from the page.
shadow.addEventListener('click', (e) => {
  if ((e.target as Element).closest?.('a, button, [type="submit"]')) e.preventDefault();
});
shadow.addEventListener('submit', (e) => e.preventDefault());

function render() {
  const html = input.value;
  nameWrap.classList.toggle('off', !wrap.checked);
  name.disabled = !wrap.checked;
  renderPreview(html);
  const r = convert(html, { component: wrap.checked ? name.value || 'MyComponent' : '', tailwind: tw.checked });
  jsx = r.jsx;
  code.textContent = jsx || '// Your JSX shows up here.';
  codeLab.textContent = wrap.checked && jsx ? `${componentName(name.value || 'MyComponent')}.jsx` : 'JSX';

  chips.replaceChildren();
  const keys = (Object.keys(r.changes) as ChangeKey[]).filter((k) => r.changes[k] > 0);
  const total = keys.reduce((n, k) => n + r.changes[k], 0);
  if (!r.roots) {
    verdict.classList.add('empty');
    vTitle.textContent = 'Paste HTML to get JSX';
  } else {
    verdict.classList.remove('empty');
    vTitle.textContent = total ? `Ready for React · ${total} fix${total === 1 ? '' : 'es'} made` : 'Ready for React · nothing needed changing';
    for (const k of keys) {
      const li = document.createElement('li');
      li.textContent = CHANGE_LABELS[k](r.changes[k]);
      chips.append(li);
    }
  }
  warn.replaceChildren(
    ...r.warnings.map((w) => {
      const li = document.createElement('li');
      li.textContent = w;
      return li;
    }),
  );
  warn.hidden = r.warnings.length === 0;
  copy.textContent = 'Copy JSX';
}

async function copyText(text: string, btn: HTMLButtonElement, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = 'Press Ctrl+C';
    const range = document.createRange();
    range.selectNodeContents(code);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
  }
  setTimeout(() => (btn.textContent = label), 1600);
}

let timer = 0;
input.addEventListener('input', () => {
  clearTimeout(timer);
  timer = window.setTimeout(render, input.value.length > 100_000 ? 400 : 120);
});
for (const el of [wrap, name, tw]) el.addEventListener('input', render);

example.addEventListener('click', () => {
  input.value = EXAMPLE;
  name.value = 'SignupCard';
  render();
});
clear.addEventListener('click', () => {
  input.value = '';
  render();
  input.focus();
});

copy.addEventListener('click', () => {
  if (jsx) copyText(jsx, copy, 'Copy JSX');
});

prompt.addEventListener('click', () => {
  if (!jsx) return;
  const comp = wrap.checked ? componentName(name.value || 'MyComponent') : '';
  const where = comp
    ? `Add this React component to my project as a new file, for example src/components/${comp}.tsx (use .jsx or the folder my project already uses for components), and show me where to use <${comp} />.`
    : 'Add this JSX to my project where it belongs, inside the right component.';
  const text = `${where} It was converted from plain HTML, so make it fit the project: if the project uses Tailwind, turn simple inline styles into Tailwind classes; if a class refers to CSS that isn't in the project, keep the look the same with the project's own styling. Replace any inline event code with real handlers. Keep how it looks the same.\n\n${jsx}`;
  copyText(text, prompt, 'Copy prompt for your AI agent');
});

input.value = EXAMPLE;
render();
