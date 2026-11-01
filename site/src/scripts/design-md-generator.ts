// DESIGN.md generator: asks /api/design for a page's design system, shows it at a glance,
// and writes it up as a short DESIGN.md for AI coding agents.

type Swatch = { hex: string; uses: number; vars: string[] };
type ColorVar = { name: string; hex: string; value: string; dark: string | null; uses: number };
type Font = { name: string; source: string; onGoogle: boolean; weights: string[]; styles: string[]; roles: string[]; uses: number; stack: string };
type Size = { px: number; uses: number; role: string | null };
type Heading = { tag: string; size: number | null; weight: string | null; lineHeight: string | null; letterSpacing: string | null };
type Component = {
  background: string | null;
  color: string | null;
  border: string | null;
  radius: number | null;
  padding: string | null;
  shadow: string | null;
  fontSize: number | null;
  fontWeight: string | null;
  uses: number;
};
type Result = {
  url: string;
  finalUrl: string;
  status: number;
  colors: { vars: ColorVar[]; backgrounds: Swatch[]; text: Swatch[]; accents: Swatch[]; themeColor: string | null };
  fonts: Font[];
  body: { size: number | null; lineHeight: string | null };
  headings: Heading[];
  typeScale: Size[];
  radii: { px: number; uses: number }[];
  spacing: { base: number | null; steps: number[] };
  shadows: string[];
  maxWidth: number | null;
  buttons: Component[];
  card: Component | null;
  sheets: number;
  sheetsFailed: number;
  error?: string;
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('dm-form');
const input = $<HTMLInputElement>('dm-url');
const button = $<HTMLButtonElement>('dm-go');
const error = $<HTMLParagraphElement>('dm-error');
const out = $<HTMLDivElement>('dm-out');
const summary = $<HTMLParagraphElement>('dm-summary');
const status = $<HTMLParagraphElement>('dm-status');
const note = $<HTMLParagraphElement>('dm-note');
const mdBox = $<HTMLElement>('dm-md');
const downloadBtn = $<HTMLButtonElement>('dm-download');
const promptBtn = $<HTMLButtonElement>('dm-prompt');
const copyBtn = $<HTMLButtonElement>('dm-copy');

let markdown = '';
let current: Result | null = null;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string | null) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};

const up = (hex: string) => hex.toUpperCase();
const pxs = (n: number) => (n >= 9999 ? '9999px' : `${n}px`);
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

function lum(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const l = (s: number) => (s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4);
  return 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b);
}

const textOn = (hex: string) => (lum(hex) > 0.4 ? '#0B2230' : '#FFFFFF');

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ---- What the colors are for ----

type Role = { role: string; hex: string; token: string | null };

function colorRoles(r: Result): Role[] {
  const c = r.colors;
  const out: Role[] = [];
  const seen = new Set<string>();
  const push = (role: string, s: Swatch | undefined) => {
    if (!s || seen.has(s.hex)) return;
    seen.add(s.hex);
    out.push({ role, hex: s.hex, token: s.vars[0] ?? null });
  };
  const accents = new Set(c.accents.map((a) => a.hex));
  const page = c.backgrounds[0];
  push('Page background', page);
  // Main text is the one that stands out most from the page, unless it's rarely used.
  let [t0, t1] = c.text;
  if (page && t0 && t1 && t1.uses >= t0.uses / 2 && Math.abs(lum(t1.hex) - lum(page.hex)) > Math.abs(lum(t0.hex) - lum(page.hex))) [t0, t1] = [t1, t0];
  push('Text', t0);
  // A surface sits close to the page color (a light gray on a white page), not a contrasting band.
  push('Surface (cards, sections)', c.backgrounds.slice(1).find((b) => !accents.has(b.hex) && page && Math.abs(lum(b.hex) - lum(page.hex)) < 0.25));
  push('Muted text', [t1, ...c.text.slice(2)].find((t) => t && !accents.has(t.hex) && t.hex !== page?.hex));
  push('Accent (buttons, links, focus)', c.accents[0]);
  push('Second accent', c.accents[1]);
  return out;
}

function fontLabel(f: Font): string {
  return f.name === 'System font' ? `the system font (\`${f.stack}\`)` : f.name;
}

function fontsByRole(r: Result) {
  const real = r.fonts.filter((f) => f.uses > 0 || f.source !== 'system');
  const body = real.find((f) => f.roles.includes('Body text')) ?? real[0];
  const heading = real.find((f) => f.roles.includes('Headings') && f !== body);
  const code = real.find((f) => f.roles.includes('Code') && f !== body && f !== heading);
  return { body, heading, code };
}

// What each radius is used for, when we know.
function radiusLabels(r: Result): Map<number, string[]> {
  const m = new Map<number, string[]>();
  const add = (n: number | null | undefined, what: string) => {
    if (n === null || n === undefined) return;
    m.set(n, [...new Set([...(m.get(n) ?? []), what])]);
  };
  r.buttons.forEach((b) => add(b.radius, 'buttons'));
  add(r.card?.radius, 'cards');
  return m;
}

// ---- DESIGN.md ----

function buildMarkdown(r: Result): string {
  const name = host(r.finalUrl);
  const today = new Date().toISOString().slice(0, 10);
  const L: string[] = [];
  L.push(`# Design system: ${name}`, '');
  L.push('Follow this style guide for all UI work. Use these exact values and don’t invent new colors, fonts, sizes or shadows. If something isn’t covered here, pick the closest value below.', '');
  L.push(`_Taken from ${r.finalUrl} on ${today} with https://darnly.dev/tools/design-md-generator/_`, '');

  // Colors
  const roles = colorRoles(r);
  if (roles.length) {
    L.push('## Colors', '', '| Role | Value | Token |', '|---|---|---|');
    for (const x of roles) L.push(`| ${x.role} | \`${x.hex}\` | ${x.token ? `\`${x.token}\`` : ''} |`);
    L.push('');
    const vars = [...r.colors.vars].sort((a, b) => b.uses - a.uses).slice(0, 12);
    if (vars.length) {
      L.push('Color tokens the site defines:', '', '```css', ':root {', ...vars.map((v) => `  ${v.name}: ${v.hex};`), '}');
      const dark = vars.filter((v) => v.dark);
      if (dark.length) L.push('', '/* Dark mode */', '.dark {', ...dark.map((v) => `  ${v.name}: ${v.dark};`), '}');
      L.push('```', '');
    }
  }

  // Typography
  const { body, heading, code } = fontsByRole(r);
  const typeRows: string[] = [];
  for (const h of r.headings) {
    if (h.size === null) continue;
    typeRows.push(`| ${h.tag.toUpperCase()} | ${h.size}px | ${h.weight ?? ''} | ${h.lineHeight ?? ''} | ${h.letterSpacing ?? ''} |`);
  }
  if (r.body.size) typeRows.push(`| Body | ${r.body.size}px | 400 | ${r.body.lineHeight ?? ''} | |`);
  if (body || typeRows.length) {
    L.push('## Typography', '');
    if (body) L.push(`- **Body font:** ${fontLabel(body)}${body.weights.length ? ` (weights ${body.weights.join(', ')})` : ''}`);
    const headingWeight = r.headings.find((h) => h.weight)?.weight;
    if (heading) L.push(`- **Heading font:** ${fontLabel(heading)}${heading.weights.length ? ` (weights ${heading.weights.join(', ')})` : ''}`);
    else if (body) L.push(`- **Headings:** same font as body${headingWeight ? `, weight ${headingWeight}` : ''}`);
    if (code) L.push(`- **Code font:** ${fontLabel(code)}`);
    if (typeRows.length) L.push('', '| Style | Size | Weight | Line height | Letter spacing |', '|---|---|---|---|---|', ...typeRows);
    if (r.typeScale.length > 2) L.push('', `Type scale: ${r.typeScale.map((s) => s.px).join(' / ')} px. Don’t use sizes outside this scale.`);
    L.push('');
  }

  // Spacing and layout
  if (r.spacing.steps.length || r.maxWidth) {
    L.push('## Spacing and layout', '');
    if (r.spacing.steps.length) {
      L.push(r.spacing.base ? `- Spacing grid: ${r.spacing.base}px. Steps in use: ${r.spacing.steps.join(', ')} px.` : `- Spacing steps in use: ${r.spacing.steps.join(', ')} px.`);
    }
    if (r.maxWidth) L.push(`- Max content width: ${r.maxWidth}px, centered.`);
    L.push('');
  }

  // Shape
  if (r.radii.length || r.shadows.length) {
    L.push('## Shape', '');
    if (r.radii.length) {
      const labels = radiusLabels(r);
      L.push(`- Corner radius: ${r.radii.map((x) => `${pxs(x.px)}${x.px >= 9999 ? ' (pills)' : labels.has(x.px) ? ` (${labels.get(x.px)!.join(', ')})` : ''}`).join(', ')}`);
    }
    if (r.shadows.length) {
      L.push('- Shadows:');
      for (const s of r.shadows) L.push(`  - \`${s}\`${r.card?.shadow === s ? ' (cards)' : r.buttons.some((b) => b.shadow === s) ? ' (buttons)' : ''}`);
    }
    L.push('');
  }

  // Components
  const comps: [string, Component][] = [];
  if (r.buttons[0]) comps.push(['Primary button', r.buttons[0]]);
  if (r.buttons[1]) comps.push(['Secondary button', r.buttons[1]]);
  if (r.card) comps.push(['Card', r.card]);
  if (comps.length) {
    L.push('## Components', '');
    for (const [title, c] of comps) {
      L.push(`### ${title}`, '');
      const parts: string[] = [];
      if (c.background) parts.push(`- Background: ${c.background === 'transparent' ? 'transparent' : `\`${c.background}\``}${c.color ? `, text \`${c.color}\`` : ''}`);
      else if (c.color) parts.push(`- Text: \`${c.color}\``);
      if (c.border) parts.push(`- Border: \`${c.border}\``);
      const box = [c.padding ? `padding ${c.padding}` : '', c.radius !== null ? `radius ${pxs(c.radius)}` : ''].filter(Boolean).join(', ');
      if (box) parts.push(`- ${box[0].toUpperCase()}${box.slice(1)}`);
      const font = [c.fontSize ? `${c.fontSize}px` : '', c.fontWeight ? `weight ${c.fontWeight}` : ''].filter(Boolean).join(', ');
      if (font) parts.push(`- Text size: ${font}`);
      if (c.shadow) parts.push(`- Shadow: \`${c.shadow}\``);
      L.push(...parts, '');
    }
  }

  // Rules
  const rules: string[] = [];
  if (roles.length) rules.push(`Use only the colors above.${r.colors.accents[0] ? ` Use the accent \`${r.colors.accents[0].hex}\` for the main action on a screen, and don’t add new shades or gradients.` : ''}`);
  const fontNames = [body, heading, code].filter((f): f is Font => !!f && f.name !== 'System font').map((f) => f.name);
  if (fontNames.length) rules.push(`Use only ${list(fontNames)}. Don’t add other fonts.`);
  if (r.spacing.base) rules.push(`Keep every margin, padding and gap on the ${r.spacing.base}px grid.`);
  if (r.radii.length || r.shadows.length) rules.push('Reuse the radius and shadow values above instead of making up new ones.');
  if (comps.length) rules.push('Build new buttons and cards from the component styles above, so they match the existing ones.');
  rules.push('Keep text readable: dark text on light backgrounds, light text on dark ones.');
  L.push('## Rules', '', ...rules.map((x) => `- ${x}`));

  return L.join('\n') + '\n';
}

function agentPrompt(md: string): string {
  return [
    'Save the text between the lines below as DESIGN.md in the root folder of this project.',
    'Then add this line to CLAUDE.md (or AGENTS.md if this project uses that; create the file if neither exists): "Follow DESIGN.md for all UI work."',
    'Then set up its colors, fonts, radius and shadows as theme tokens the way this project already handles styling (Tailwind theme, CSS variables or a theme file), so new UI uses them. Don’t restyle existing pages unless I ask.',
    '',
    '---',
    md.trim(),
    '---',
  ].join('\n');
}

// ---- At a glance ----

function renderColors(r: Result) {
  const ul = $<HTMLUListElement>('dm-colors');
  const roles = colorRoles(r);
  $('dm-colors-box').hidden = !roles.length;
  ul.replaceChildren(
    ...roles.map((x) => {
      const li = el('li');
      const b = el('button');
      b.type = 'button';
      b.style.background = x.hex;
      b.style.color = textOn(x.hex);
      b.setAttribute('aria-label', `Copy ${up(x.hex)}, ${x.role}`);
      b.append(el('strong', '', up(x.hex)), el('span', '', x.role.replace(/ \(.*\)$/, '')));
      b.addEventListener('click', async () => {
        status.textContent = (await copy(up(x.hex))) ? `Copied ${up(x.hex)}` : 'Your browser blocked copying. Select the text instead.';
      });
      li.append(b);
      return li;
    }),
  );
}

function renderType(r: Result) {
  const { body, heading } = fontsByRole(r);
  const fonts = $<HTMLParagraphElement>('dm-fonts');
  const names = [body && `Body: ${body.name}`, heading && `Headings: ${heading.name}`].filter(Boolean) as string[];
  fonts.textContent = names.join(' · ');
  fonts.hidden = !names.length;
  const ul = $<HTMLUListElement>('dm-scale');
  ul.replaceChildren(
    ...r.typeScale.slice(0, 7).map((s) => {
      const li = el('li');
      const sample = el('span', '', s.role ? s.role.replace(/\bh(\d)/g, 'Heading $1').replace(/^body/, 'Body') : 'Aa Bb Cc');
      sample.style.fontSize = `${Math.min(s.px, 40)}px`;
      const h = r.headings.find((x) => x.size === s.px);
      if (h?.weight) sample.style.fontWeight = h.weight;
      li.append(el('b', '', `${s.px}px`), sample);
      return li;
    }),
  );
  $('dm-type-box').hidden = !names.length && !r.typeScale.length;
}

function renderShapes(r: Result) {
  const ul = $<HTMLUListElement>('dm-shapes');
  const items: HTMLElement[] = [];
  for (const x of r.radii) {
    const li = el('li');
    const i = el('i');
    i.style.borderRadius = x.px >= 9999 ? '999px' : `${Math.min(x.px, 28)}px`;
    li.append(i, el('span', '', x.px >= 9999 ? 'pill' : `${x.px}px`));
    items.push(li);
  }
  r.shadows.forEach((s, n) => {
    const li = el('li');
    const i = el('i', 'shadow');
    i.style.boxShadow = s;
    i.style.borderRadius = `${Math.min(r.card?.radius ?? 8, 16)}px`;
    li.append(i, el('span', '', `shadow ${n + 1}`));
    items.push(li);
  });
  ul.replaceChildren(...items);
  ul.hidden = !items.length;
  const sp = $<HTMLParagraphElement>('dm-spacing');
  const bits: string[] = [];
  if (r.spacing.steps.length) bits.push(`${r.spacing.base ? `${r.spacing.base}px grid. ` : ''}Spacing: ${r.spacing.steps.join(', ')} px.`);
  if (r.maxWidth) bits.push(`Content width: ${r.maxWidth}px.`);
  sp.textContent = bits.join(' ');
  sp.hidden = !bits.length;
  $('dm-shape-box').hidden = !items.length && !bits.length;
}

function styleBox(e: HTMLElement, c: Component) {
  if (c.background) e.style.background = c.background;
  if (c.color) e.style.color = c.color;
  e.style.border = c.border ?? '0';
  if (c.radius !== null) e.style.borderRadius = c.radius >= 9999 ? '999px' : `${c.radius}px`;
  if (c.padding) e.style.padding = c.padding;
  if (c.shadow) e.style.boxShadow = c.shadow;
  if (c.fontSize) e.style.fontSize = `${c.fontSize}px`;
  if (c.fontWeight) e.style.fontWeight = c.fontWeight;
}

function renderComps(r: Result) {
  const box = $<HTMLDivElement>('dm-comps');
  const items: HTMLElement[] = [];
  r.buttons.forEach((b, i) => {
    const e = el('span', 'btn', i === 0 ? 'Primary button' : 'Secondary');
    styleBox(e, b);
    items.push(e);
  });
  if (r.card) {
    const c = el('div', 'card');
    styleBox(c, r.card);
    if (!r.card.background) c.style.background = r.colors.backgrounds[0]?.hex ?? '#ffffff';
    if (!r.card.color && r.colors.text[0]) c.style.color = r.colors.text[0].hex;
    c.append(el('b', '', 'Card title'), el('span', '', 'Cards use this background, border, radius and padding.'));
    items.push(c);
  }
  box.replaceChildren(...items);
  if (r.colors.backgrounds[0]) box.style.background = r.colors.backgrounds[0].hex;
  $('dm-comp-box').hidden = !items.length;
}

function render(r: Result) {
  current = r;
  markdown = buildMarkdown(r);
  mdBox.textContent = markdown;
  const found = [
    colorRoles(r).length && 'colors',
    r.fonts.length && 'fonts',
    r.typeScale.length > 1 && 'type sizes',
    r.spacing.steps.length && 'spacing',
    r.radii.length && 'radius',
    r.shadows.length && 'shadows',
    r.buttons.length && 'buttons',
    r.card && 'cards',
  ].filter(Boolean) as string[];
  summary.textContent = found.length ? `Style guide for ${host(r.finalUrl)}: ${list(found)}.` : `We couldn’t find much styling on ${host(r.finalUrl)}.`;
  status.textContent = '';
  renderColors(r);
  renderType(r);
  renderShapes(r);
  renderComps(r);

  const problems: string[] = [];
  if (r.status >= 400) problems.push(`The page answered with error ${r.status}, so this may not be the real page.`);
  if (r.sheetsFailed) problems.push(`${r.sheetsFailed} stylesheet${r.sheetsFailed === 1 ? '' : 's'} couldn’t be read, so some values may be missing.`);
  if (found.length < 3) problems.push('The site may add its styles with JavaScript, or block automated visits. Try another page on the same site.');
  note.textContent = problems.join(' ');
  note.hidden = !problems.length;
}

function flash(b: HTMLButtonElement, text: string, back: string) {
  b.textContent = text;
  setTimeout(() => (b.textContent = back), 1500);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = input.value.trim();
  if (!url) return;
  error.hidden = true;
  button.disabled = true;
  button.textContent = 'Reading…';
  try {
    const res = await fetch(`/api/design?url=${encodeURIComponent(url)}`);
    const data: Result = await res.json().catch(() => ({ error: 'Something went wrong. Try again.' }) as Result);
    if (!res.ok || data.error) throw new Error(data.error ?? 'Something went wrong. Try again.');
    out.hidden = false;
    render(data);
    history.replaceState(null, '', `?url=${encodeURIComponent(url)}`);
  } catch (err) {
    error.textContent = (err as Error).message;
    error.hidden = false;
    out.hidden = true;
  } finally {
    button.disabled = false;
    button.textContent = 'Make DESIGN.md';
  }
});

downloadBtn.addEventListener('click', () => {
  if (!markdown) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
  a.download = 'DESIGN.md';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  status.textContent = 'Saved DESIGN.md to your downloads. Move it into the top folder of your project.';
});

copyBtn.addEventListener('click', async () => flash(copyBtn, (await copy(markdown)) ? 'Copied' : 'Couldn’t copy', 'Copy'));

promptBtn.addEventListener('click', async () => {
  if (!current) return;
  flash(promptBtn, (await copy(agentPrompt(markdown))) ? 'Copied. Paste it into your agent' : 'Couldn’t copy', 'Copy prompt for your AI agent');
});

// Shared links like /tools/design-md-generator/?url=linear.app run straight away.
const preset = new URLSearchParams(location.search).get('url');
if (preset) {
  input.value = preset;
  form.requestSubmit();
}
