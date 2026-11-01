// Pure-CSS loaders and skeleton screens: the loader list plus the code each output format needs.
// Nothing here touches the page, so it can be checked on its own.

export type Group = 'spinners' | 'dots' | 'pulse' | 'progress';
export type LoaderDef = {
  id: string;
  name: string;
  group: Group;
  kids: number; // empty <span>s inside the loader
  wide?: boolean; // 4× wider than tall (bars and text)
  text?: boolean; // shows the label as its text
  base: string[]; // declarations for the loader element itself
  rules?: string; // other rules: `&` is the loader class, %K / %K2 its keyframe names
};

// Tokens used in the definitions below, swapped for real CSS when code is made.
// $S size, $C color, $T one loop, $TRACK a faint version of the color.
const nth = (n: number, fn: (i: number) => string) =>
  Array.from({ length: n }, (_, i) => `& span:nth-child(${i + 1}) { ${fn(i)} }`).join('\n');

export const LOADERS: LoaderDef[] = [
  {
    id: 'ring',
    name: 'Ring',
    group: 'spinners',
    kids: 0,
    base: ['box-sizing: border-box', 'width: $S', 'height: $S', 'border-radius: 50%', 'border: calc($S / 8) solid $TRACK', 'border-top-color: $C', 'animation: %K calc($T * 0.8) linear infinite'],
    rules: '@keyframes %K { to { transform: rotate(1turn); } }',
  },
  {
    id: 'arc',
    name: 'Fading arc',
    group: 'spinners',
    kids: 0,
    base: [
      'width: $S',
      'height: $S',
      'border-radius: 50%',
      'background: conic-gradient(from 0deg, transparent 10%, $C)',
      '-webkit-mask: radial-gradient(farthest-side, transparent calc(100% - $S / 8 - 1px), #000 calc(100% - $S / 8))',
      'mask: radial-gradient(farthest-side, transparent calc(100% - $S / 8 - 1px), #000 calc(100% - $S / 8))',
      'animation: %K $T linear infinite',
    ],
    rules: '@keyframes %K { to { transform: rotate(1turn); } }',
  },
  {
    id: 'dual-ring',
    name: 'Dual ring',
    group: 'spinners',
    kids: 0,
    base: ['box-sizing: border-box', 'width: $S', 'height: $S', 'border-radius: 50%', 'border: calc($S / 10) solid transparent', 'border-top-color: $C', 'border-bottom-color: $C', 'animation: %K calc($T * 1.2) cubic-bezier(0.5, 0.1, 0.5, 0.9) infinite'],
    rules: '@keyframes %K { to { transform: rotate(1turn); } }',
  },
  {
    id: 'spokes',
    name: 'Spokes',
    group: 'spinners',
    kids: 8,
    base: ['position: relative', 'width: $S', 'height: $S'],
    rules: [
      '& span { position: absolute; left: 50%; top: 0; width: calc($S / 10); height: calc($S / 3.6); margin-left: calc($S / -20); border-radius: 999px; background: $C; transform-origin: 50% calc($S / 2); animation: %K $T linear infinite; }',
      nth(8, (i) => `transform: rotate(${i * 45}deg); animation-delay: calc($T * ${((i - 8) / 8).toFixed(3)});`),
      '@keyframes %K { from { opacity: 1; } to { opacity: 0.15; } }',
    ].join('\n'),
  },
  {
    id: 'orbit',
    name: 'Orbit',
    group: 'spinners',
    kids: 0,
    base: ['box-sizing: border-box', 'position: relative', 'width: $S', 'height: $S', 'border-radius: 50%', 'border: calc($S / 16) solid $TRACK', 'animation: %K $T linear infinite'],
    rules: [
      '&::before { content: ""; position: absolute; top: calc($S * -0.156); left: 50%; width: calc($S / 4); height: calc($S / 4); margin-left: calc($S / -8); border-radius: 50%; background: $C; }',
      '@keyframes %K { to { transform: rotate(1turn); } }',
    ].join('\n'),
  },
  {
    id: 'morph',
    name: 'Morph',
    group: 'spinners',
    kids: 0,
    base: ['width: $S', 'height: $S', 'background: $C', 'animation: %K calc($T * 1.6) ease-in-out infinite'],
    rules:
      '@keyframes %K { 0% { transform: rotate(0deg) scale(0.75); border-radius: 12%; } 50% { transform: rotate(180deg) scale(0.55); border-radius: 50%; } 100% { transform: rotate(360deg) scale(0.75); border-radius: 12%; } }',
  },
  {
    id: 'clock',
    name: 'Clock',
    group: 'spinners',
    kids: 0,
    base: ['box-sizing: border-box', 'position: relative', 'width: $S', 'height: $S', 'border-radius: 50%', 'border: calc($S / 14) solid $C'],
    rules: [
      '&::before, &::after { content: ""; position: absolute; left: 50%; bottom: 50%; width: calc($S / 14); margin-left: calc($S / -28); border-radius: 999px; background: $C; transform-origin: 50% 100%; }',
      '&::before { height: 34%; animation: %K calc($T * 1.5) linear infinite; }',
      '&::after { height: 24%; animation: %K calc($T * 9) linear infinite; }',
      '@keyframes %K { to { transform: rotate(1turn); } }',
    ].join('\n'),
  },
  {
    id: 'dots',
    name: 'Dots',
    group: 'dots',
    kids: 3,
    base: ['display: flex', 'align-items: center', 'justify-content: center', 'gap: calc($S / 10)', 'width: $S', 'height: $S'],
    rules: [
      '& span { width: calc($S / 4.5); height: calc($S / 4.5); border-radius: 50%; background: $C; animation: %K calc($T * 1.2) ease-in-out infinite both; }',
      '& span:nth-child(2) { animation-delay: calc($T * 0.16); }',
      '& span:nth-child(3) { animation-delay: calc($T * 0.32); }',
      '@keyframes %K { 0%, 80%, 100% { transform: scale(0.2); } 40% { transform: scale(1); } }',
    ].join('\n'),
  },
  {
    id: 'typing',
    name: 'Typing',
    group: 'dots',
    kids: 3,
    base: ['display: flex', 'align-items: center', 'justify-content: center', 'gap: calc($S / 10)', 'width: $S', 'height: $S'],
    rules: [
      '& span { width: calc($S / 5); height: calc($S / 5); border-radius: 50%; background: $C; opacity: 0.35; animation: %K calc($T * 1.2) ease-in-out infinite; }',
      '& span:nth-child(2) { animation-delay: calc($T * 0.15); }',
      '& span:nth-child(3) { animation-delay: calc($T * 0.3); }',
      '@keyframes %K { 0%, 60%, 100% { transform: translateY(0); opacity: 0.35; } 30% { transform: translateY(calc($S / -6)); opacity: 1; } }',
    ].join('\n'),
  },
  {
    id: 'swap',
    name: 'Swap',
    group: 'dots',
    kids: 2,
    base: ['position: relative', 'width: $S', 'height: $S'],
    rules: [
      '& span { position: absolute; left: 0; top: 50%; width: calc($S / 3.5); height: calc($S / 3.5); margin-top: calc($S / -7); border-radius: 50%; background: $C; animation: %K $T ease-in-out infinite; }',
      '& span:nth-child(2) { opacity: 0.45; animation-name: %K2; }',
      '@keyframes %K { 0%, 100% { transform: translateX(0) scale(1); } 50% { transform: translateX(calc($S * 0.714)) scale(0.8); } }',
      '@keyframes %K2 { 0%, 100% { transform: translateX(calc($S * 0.714)) scale(0.8); } 50% { transform: translateX(0) scale(1); } }',
    ].join('\n'),
  },
  {
    id: 'grid',
    name: 'Grid',
    group: 'dots',
    kids: 9,
    base: ['display: grid', 'grid-template-columns: repeat(3, 1fr)', 'gap: calc($S / 14)', 'width: $S', 'height: $S'],
    rules: [
      '& span { border-radius: calc($S / 24); background: $C; animation: %K calc($T * 1.3) ease-in-out infinite; }',
      nth(9, (i) => `animation-delay: calc($T * ${(((i % 3) + Math.floor(i / 3)) * 0.1 - 1.3).toFixed(1)});`),
      '@keyframes %K { 0%, 70%, 100% { transform: scale(1); opacity: 1; } 35% { transform: scale(0.3); opacity: 0.3; } }',
    ].join('\n'),
  },
  {
    id: 'bars',
    name: 'Bars',
    group: 'dots',
    kids: 5,
    base: ['display: flex', 'align-items: center', 'justify-content: center', 'gap: calc($S / 12)', 'width: $S', 'height: $S'],
    rules: [
      '& span { width: calc($S / 9); height: 70%; border-radius: 999px; background: $C; animation: %K $T ease-in-out infinite; }',
      nth(5, (i) => `animation-delay: calc($T * ${(i * 0.1 - 1).toFixed(1)});`),
      '@keyframes %K { 0%, 100% { transform: scaleY(0.35); } 50% { transform: scaleY(1); } }',
    ].join('\n'),
  },
  {
    id: 'pulse',
    name: 'Pulse',
    group: 'pulse',
    kids: 0,
    base: ['width: $S', 'height: $S', 'border-radius: 50%', 'background: $C', 'animation: %K $T ease-out infinite'],
    rules: '@keyframes %K { from { transform: scale(0); opacity: 1; } to { transform: scale(1); opacity: 0; } }',
  },
  {
    id: 'ripple',
    name: 'Ripple',
    group: 'pulse',
    kids: 0,
    base: ['position: relative', 'width: $S', 'height: $S'],
    rules: [
      '&::before, &::after { content: ""; box-sizing: border-box; position: absolute; inset: 0; border-radius: 50%; border: calc($S / 16) solid $C; opacity: 0; animation: %K calc($T * 1.6) cubic-bezier(0, 0.2, 0.8, 1) infinite; }',
      '&::after { animation-delay: calc($T * -0.8); }',
      '@keyframes %K { from { transform: scale(0.1); opacity: 1; } to { transform: scale(1); opacity: 0; } }',
    ].join('\n'),
  },
  {
    id: 'flip',
    name: 'Flip',
    group: 'pulse',
    kids: 0,
    base: ['width: calc($S * 0.7)', 'height: calc($S * 0.7)', 'margin: calc($S * 0.15)', 'border-radius: calc($S / 12)', 'background: $C', 'animation: %K calc($T * 1.4) ease-in-out infinite'],
    rules:
      '@keyframes %K { 0% { transform: perspective(calc($S * 3)) rotateX(0deg) rotateY(0deg); } 50% { transform: perspective(calc($S * 3)) rotateX(-180deg) rotateY(0deg); } 100% { transform: perspective(calc($S * 3)) rotateX(-180deg) rotateY(-180deg); } }',
  },
  {
    id: 'ball',
    name: 'Bounce',
    group: 'pulse',
    kids: 0,
    base: ['position: relative', 'width: $S', 'height: $S'],
    rules: [
      '&::before { content: ""; position: absolute; left: 50%; top: 0; width: calc($S / 3); height: calc($S / 3); margin-left: calc($S / -6); border-radius: 50%; background: $C; animation: %K calc($T * 0.5) cubic-bezier(0.55, 0, 1, 0.45) infinite alternate; }',
      '&::after { content: ""; position: absolute; left: 50%; bottom: 0; width: calc($S / 2.5); height: calc($S / 12); margin-left: calc($S / -5); border-radius: 50%; background: $C; animation: %K2 calc($T * 0.5) cubic-bezier(0.55, 0, 1, 0.45) infinite alternate; }',
      '@keyframes %K { to { transform: translateY(calc($S * 0.55)); } }',
      '@keyframes %K2 { from { transform: scale(0.5); opacity: 0.08; } to { transform: scale(1); opacity: 0.25; } }',
    ].join('\n'),
  },
  {
    id: 'progress',
    name: 'Progress bar',
    group: 'progress',
    kids: 0,
    wide: true,
    base: ['position: relative', 'width: calc($S * 4)', 'height: calc($S / 8)', 'border-radius: 999px', 'background: $TRACK', 'overflow: hidden'],
    rules: [
      '&::before { content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 40%; border-radius: inherit; background: $C; animation: %K calc($T * 1.5) ease-in-out infinite; }',
      '@keyframes %K { from { transform: translateX(-100%); } to { transform: translateX(250%); } }',
    ].join('\n'),
  },
  {
    id: 'stripes',
    name: 'Striped bar',
    group: 'progress',
    kids: 0,
    wide: true,
    base: ['width: calc($S * 4)', 'height: calc($S / 4)', 'border-radius: 999px', 'background: repeating-linear-gradient(-45deg, $C 0 calc($S / 8), $HALF calc($S / 8) calc($S / 4))', 'animation: %K calc($T * 0.6) linear infinite'],
    rules: '@keyframes %K { from { background-position: 0 0; } to { background-position: calc($S * 0.3536) 0; } }',
  },
  {
    id: 'text-shimmer',
    name: 'Shimmer text',
    group: 'progress',
    kids: 0,
    wide: true,
    text: true,
    base: [
      'display: inline-block',
      'font-size: calc($S / 2.2)',
      'font-weight: 600',
      'line-height: 1.2',
      'background: linear-gradient(90deg, $FAINT 0 40%, $C 50%, $FAINT 60% 100%)',
      'background-size: 300% 100%',
      '-webkit-background-clip: text',
      'background-clip: text',
      '-webkit-text-fill-color: transparent',
      'animation: %K calc($T * 2) linear infinite',
    ],
    rules: '@keyframes %K { from { background-position: 100% 0; } to { background-position: 0 0; } }',
  },
  {
    id: 'skeleton-lines',
    name: 'Skeleton lines',
    group: 'progress',
    kids: 3,
    wide: true,
    base: ['display: grid', 'gap: calc($S / 6)', 'width: calc($S * 4)'],
    rules: [
      '& span { height: calc($S / 5); border-radius: calc($S / 16); background: linear-gradient(90deg, $TRACK 0 30%, $FAINT 50%, $TRACK 70% 100%); background-size: 300% 100%; animation: %K calc($T * 1.5) linear infinite; }',
      '& span:last-child { width: 60%; }',
      '@keyframes %K { from { background-position: 100% 0; } to { background-position: 0 0; } }',
    ].join('\n'),
  },
];

export const GROUPS: { id: Group | 'all'; name: string }[] = [
  { id: 'all', name: 'All' },
  { id: 'spinners', name: 'Spinners' },
  { id: 'dots', name: 'Dots and bars' },
  { id: 'pulse', name: 'Pulse and bounce' },
  { id: 'progress', name: 'Bars, text and skeleton' },
];

export type Options = { color: string; size: number; speed: number; label: string };

// ---- Loader code ----

const cls = (d: LoaderDef) => `loader-${d.id}`;

function fill(d: LoaderDef, s: string): string {
  const c = cls(d);
  return s
    .replaceAll('$TRACK', 'color-mix(in srgb, var(--loader-color) 20%, transparent)')
    .replaceAll('$FAINT', 'color-mix(in srgb, var(--loader-color) 35%, transparent)')
    .replaceAll('$HALF', 'color-mix(in srgb, var(--loader-color) 55%, transparent)')
    .replaceAll('$S', 'var(--loader-size)')
    .replaceAll('$C', 'var(--loader-color)')
    .replaceAll('$T', 'var(--_t)')
    .replaceAll('%K2', `${c}-b`)
    .replaceAll('%K', `${c}-a`)
    .replaceAll('&', `.${c}`);
}

// Spreads a one-line rule like `.a { x: 1; y: 2; }` over several lines.
function pretty(rule: string, indent = ''): string {
  const m = rule.match(/^([^{]+)\{\s*([\s\S]*)\}\s*$/);
  if (!m) return indent + rule;
  const sel = m[1].trim();
  const body = m[2].trim();
  if (sel.startsWith('@keyframes')) {
    const frames = [...body.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((f) => pretty(`${f[1].trim()} { ${f[2].trim()} }`, indent + '  '));
    return `${indent}${sel} {\n${frames.join('\n')}\n${indent}}`;
  }
  const decls = body.split(/;(?![^(]*\))/).map((x) => x.trim()).filter(Boolean);
  return `${indent}${sel} {\n${decls.map((x) => `${indent}  ${x};`).join('\n')}\n${indent}}`;
}

// The CSS for one loader. `colorValue` is what --loader-color starts as.
export function loaderCss(d: LoaderDef, o: Options, colorValue = o.color, withComment = true): string {
  const c = cls(d);
  const vars = [`--loader-size: ${o.size}px`, `--loader-color: ${colorValue}`, `--loader-speed: ${o.speed}s`, '--_t: var(--loader-speed)'];
  const main = pretty(`.${c} { ${[...vars, ...d.base.map((x) => fill(d, x))].join('; ')}; }`);
  const rest = (d.rules ?? '').split('\n').filter(Boolean).map((r) => pretty(fill(d, r)));
  const reduce = `/* Slower for people who ask their device for less motion. */\n@media (prefers-reduced-motion: reduce) {\n  .${c} { --_t: calc(var(--loader-speed) * 3); }\n}`;
  const head = withComment ? `/* ${d.name} loader. Change the three --loader- values to restyle it. */\n` : '';
  return head + [main, ...rest, reduce].join('\n\n');
}

export function loaderHtml(d: LoaderDef, o: Options, extraClass = ''): string {
  const c = [cls(d), extraClass].filter(Boolean).join(' ');
  const label = escapeHtml(o.label || 'Loading');
  if (d.text) return `<div class="${c}" role="status">${label}</div>`;
  const kids = d.kids ? '\n' + Array.from({ length: d.kids }, () => '  <span></span>').join('\n') + '\n' : '';
  return `<div class="${c}" role="status" aria-label="${label}">${kids}</div>`;
}

export type CodeBlock = { label: string; code: string };
export type Format = 'html' | 'tailwind' | 'react';

export function loaderCode(d: LoaderDef, o: Options, format: Format): CodeBlock[] {
  if (format === 'html') {
    return [
      { label: 'HTML', code: loaderHtml(d, o) },
      { label: 'CSS', code: loaderCss(d, o) },
    ];
  }
  if (format === 'tailwind') {
    const css = loaderCss(d, o, 'currentColor', false);
    const color = `text-[${o.color}]`;
    return [
      {
        label: 'Global CSS (globals.css or app.css) · Tailwind v3 and v4',
        code: `/* ${d.name} loader. Its color is the text color, so any text-* class works. */\n@layer components {\n${indentCss(mainRule(css))}\n}\n\n${otherRules(css)}`,
      },
      { label: 'Markup', code: `<!-- Swap ${color} for any text color, like text-sky-500. -->\n${loaderHtml(d, o, color)}` },
    ];
  }
  // React (TypeScript). Inline CSS keeps it one file.
  const name = 'Loader';
  const css = loaderCss(d, { ...o, size: 48, speed: 1 }, o.color, false);
  const kids = d.text ? '{label}' : d.kids ? '\n' + Array.from({ length: d.kids }, () => '        <span />').join('\n') + '\n      ' : '';
  const aria = d.text ? '' : ' aria-label={label}';
  return [
    {
      label: `${name}.tsx · React, works in Next.js server components`,
      code: `import type { CSSProperties } from 'react';

// ${d.name} loader. Use <${name} />, or <${name} size={20} color="#fff" /> inside a button.
const css = \`
${css.replaceAll('`', '\\`')}
\`;

type Props = { size?: number; color?: string; speed?: number; label?: string };

export default function ${name}({ size = ${o.size}, color = '${o.color}', speed = ${o.speed}, label = '${(o.label || 'Loading').replaceAll("'", "\\'")}' }: Props) {
  const style = { '--loader-size': \`\${size}px\`, '--loader-color': color, '--loader-speed': \`\${speed}s\` } as CSSProperties;
  return (
    <>
      <style>{css}</style>
      <div className="${cls(d)}" role="status"${aria} style={style}>${kids}</div>
    </>
  );
}
`,
    },
  ];
}

// Splits loaderCss output into the class rules (go in @layer components) and the rest (keyframes, media).
function mainRule(css: string): string {
  return css
    .split('\n\n')
    .filter((b) => b.startsWith('.'))
    .join('\n\n');
}
function otherRules(css: string): string {
  return css
    .split('\n\n')
    .filter((b) => !b.startsWith('.'))
    .join('\n\n');
}
const indentCss = (s: string) =>
  s
    .split('\n')
    .map((l) => (l ? '  ' + l : l))
    .join('\n');

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

// The CSS for every loader at once, used by the page's own preview.
export function allLoadersCss(o: Options): string {
  return LOADERS.map((d) => loaderCss(d, o, o.color, false)).join('\n\n');
}

// ---- Skeleton screens ----

export type Skeleton = {
  image: boolean;
  avatar: 'none' | 'circle' | 'square';
  title: boolean;
  lines: number; // 0–5
  button: boolean;
  rows: number; // 1–5, repeats the avatar + lines row (lists)
  anim: 'shimmer' | 'pulse' | 'none';
  base: string; // block color
  highlight: string; // shimmer color
  card: string; // card background
  border: string;
  radius: number; // block corners, px
  speed: number; // seconds
};

export const SKELETON_PRESETS: { id: string; name: string; s: Partial<Skeleton> }[] = [
  { id: 'blog', name: 'Blog card', s: { image: true, avatar: 'none', title: true, lines: 3, button: false, rows: 1 } },
  { id: 'profile', name: 'Profile', s: { image: false, avatar: 'circle', title: true, lines: 1, button: true, rows: 1 } },
  { id: 'list', name: 'List', s: { image: false, avatar: 'circle', title: true, lines: 1, button: false, rows: 4 } },
  { id: 'product', name: 'Product', s: { image: true, avatar: 'none', title: true, lines: 1, button: true, rows: 1 } },
  { id: 'comment', name: 'Comment', s: { image: false, avatar: 'circle', title: true, lines: 3, button: false, rows: 2 } },
  { id: 'text', name: 'Paragraph', s: { image: false, avatar: 'none', title: true, lines: 5, button: false, rows: 1 } },
];

export const SKELETON_THEMES = {
  light: { base: '#e6ebef', highlight: '#f6f8fa', card: '#ffffff', border: '#e6ebef' },
  dark: { base: '#262f37', highlight: '#36414b', card: '#151b21', border: '#262f37' },
};

export const DEFAULT_SKELETON: Skeleton = {
  image: true,
  avatar: 'none',
  title: true,
  lines: 3,
  button: false,
  rows: 1,
  anim: 'shimmer',
  ...SKELETON_THEMES.light,
  radius: 8,
  speed: 1.5,
};

// One description of the card, read by all three outputs.
type Block = { kind: 'image' | 'avatar' | 'title' | 'line' | 'short' | 'button' } | { kind: 'row'; avatar: boolean; lines: Block[] };

function blocks(s: Skeleton): Block[] {
  const out: Block[] = [];
  if (s.image) out.push({ kind: 'image' });
  const lines: Block[] = [];
  if (s.title) lines.push({ kind: 'title' });
  for (let i = 0; i < s.lines; i++) lines.push({ kind: i === s.lines - 1 && s.lines > 1 ? 'short' : 'line' });
  if (lines.length === 0 && s.avatar === 'none') lines.push({ kind: 'line' });
  for (let r = 0; r < Math.max(1, s.rows); r++) out.push({ kind: 'row', avatar: s.avatar !== 'none', lines });
  if (s.button) out.push({ kind: 'button' });
  return out;
}

const SK_CLASS: Record<string, string> = {
  image: 'sk sk-image',
  avatar: 'sk sk-avatar',
  title: 'sk sk-title',
  line: 'sk sk-line',
  short: 'sk sk-line sk-short',
  button: 'sk sk-button',
};

export function skeletonHtml(s: Skeleton): string {
  const out = ['<div class="skeleton" role="status" aria-label="Loading">'];
  for (const b of blocks(s)) {
    if (b.kind !== 'row') {
      out.push(`  <div class="${SK_CLASS[b.kind]}"></div>`);
      continue;
    }
    out.push('  <div class="sk-row">');
    if (b.avatar) out.push('    <div class="sk sk-avatar"></div>');
    out.push('    <div class="sk-lines">');
    for (const l of b.lines) out.push(`      <div class="${SK_CLASS[l.kind]}"></div>`);
    out.push('    </div>');
    out.push('  </div>');
  }
  out.push('</div>');
  return out.join('\n');
}

export function skeletonCss(s: Skeleton): string {
  const r = s.radius;
  const avatarRadius = s.avatar === 'circle' ? '50%' : `${r}px`;
  const parts = [
    `/* Skeleton card. Show it while data loads, then swap in the real card. */
.skeleton {
  display: grid;
  gap: 16px;
  max-width: 360px;
  padding: 20px;
  border: 1px solid ${s.border};
  border-radius: ${r + 8}px;
  background: ${s.card};
}

.sk-row {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}

.sk-lines {
  display: grid;
  flex: 1;
  gap: 10px;
}

.sk {
  border-radius: ${r}px;
  background: ${s.base};
}

.sk-image { height: 160px; }
.sk-avatar { flex: none; width: 44px; height: 44px; border-radius: ${avatarRadius}; }
.sk-title { width: 70%; height: 18px; }
.sk-line { height: 12px; }
.sk-short { width: 55%; }
.sk-button { width: 120px; height: 40px; border-radius: 999px; }`,
  ];
  if (s.anim === 'shimmer') {
    parts.push(`/* A soft light sweeps across every block. */
.sk {
  background: linear-gradient(90deg, ${s.base} 0 35%, ${s.highlight} 50%, ${s.base} 65% 100%);
  background-size: 300% 100%;
  animation: sk-shimmer ${s.speed}s linear infinite;
}

@keyframes sk-shimmer {
  from { background-position: 100% 0; }
  to { background-position: 0 0; }
}`);
  } else if (s.anim === 'pulse') {
    parts.push(`/* Every block fades gently in and out. */
.sk {
  animation: sk-pulse ${s.speed}s ease-in-out infinite;
}

@keyframes sk-pulse {
  50% { opacity: 0.5; }
}`);
  }
  if (s.anim !== 'none') {
    parts.push(`/* No movement for people who ask their device for less motion. */
@media (prefers-reduced-motion: reduce) {
  .sk { animation: none; }
}`);
  }
  return parts.join('\n\n');
}

const TW: Record<string, string> = {
  image: 'h-40',
  avatar: 'size-11 shrink-0',
  title: 'h-[18px] w-[70%]',
  line: 'h-3',
  short: 'h-3 w-[55%]',
  button: 'h-10 w-[120px] rounded-full',
};

export function skeletonTailwind(s: Skeleton): CodeBlock[] {
  const anim = s.anim === 'pulse' ? ' animate-pulse motion-reduce:animate-none' : s.anim === 'shimmer' ? ' sk-shimmer' : '';
  const block = (kind: string) => {
    let c = TW[kind];
    if (kind === 'avatar') c += s.avatar === 'circle' ? ' rounded-full' : ` rounded-[${s.radius}px]`;
    else if (kind !== 'button') c += ` rounded-[${s.radius}px]`;
    return `<div class="${c} bg-[${s.base}]${anim}"></div>`;
  };
  const out = [`<div role="status" aria-label="Loading" class="grid max-w-[360px] gap-4 rounded-[${s.radius + 8}px] border border-[${s.border}] bg-[${s.card}] p-5">`];
  for (const b of blocks(s)) {
    if (b.kind !== 'row') {
      out.push('  ' + block(b.kind));
      continue;
    }
    out.push('  <div class="flex items-start gap-3.5">');
    if (b.avatar) out.push('    ' + block('avatar'));
    out.push('    <div class="grid flex-1 gap-2.5">');
    for (const l of b.lines) out.push('      ' + block(l.kind));
    out.push('    </div>');
    out.push('  </div>');
  }
  out.push('</div>');
  const res: CodeBlock[] = [];
  if (s.anim === 'shimmer') {
    res.push({
      label: 'Global CSS (globals.css or app.css) · Tailwind v3 and v4',
      code: `/* The shimmer. Tailwind has animate-pulse built in, but no shimmer. */
@layer components {
  .sk-shimmer {
    background-image: linear-gradient(90deg, transparent 0 35%, ${s.highlight} 50%, transparent 65% 100%);
    background-size: 300% 100%;
    animation: sk-shimmer ${s.speed}s linear infinite;
  }
}

@keyframes sk-shimmer {
  from { background-position: 100% 0; }
  to { background-position: 0 0; }
}

@media (prefers-reduced-motion: reduce) {
  .sk-shimmer { animation: none; }
}`,
    });
  }
  res.push({ label: 'Markup', code: out.join('\n') });
  return res;
}

export function skeletonReact(s: Skeleton): CodeBlock[] {
  const css = skeletonCss(s);
  const jsx: string[] = [];
  for (const b of blocks(s)) {
    if (b.kind !== 'row') {
      jsx.push(`      <div className="${SK_CLASS[b.kind]}" />`);
      continue;
    }
    if (s.rows > 1) continue;
    jsx.push('      <div className="sk-row">');
    if (b.avatar) jsx.push('        <div className="sk sk-avatar" />');
    jsx.push('        <div className="sk-lines">');
    for (const l of b.lines) jsx.push(`          <div className="${SK_CLASS[l.kind]}" />`);
    jsx.push('        </div>');
    jsx.push('      </div>');
  }
  const first = blocks(s).find((b) => b.kind === 'row') as Extract<Block, { kind: 'row' }>;
  const rowsJsx = s.rows > 1
    ? [
        '      {Array.from({ length: rows }, (_, i) => (',
        '        <div className="sk-row" key={i}>',
        ...(first.avatar ? ['          <div className="sk sk-avatar" />'] : []),
        '          <div className="sk-lines">',
        ...first.lines.map((l) => `            <div className="${SK_CLASS[l.kind]}" />`),
        '          </div>',
        '        </div>',
        '      ))}',
      ]
    : [];
  // Keep the rows where they belong: after the image, before the button.
  const body: string[] = [];
  if (s.rows > 1) {
    if (s.image) body.push('      <div className="sk sk-image" />');
    body.push(...rowsJsx);
    if (s.button) body.push('      <div className="sk sk-button" />');
  } else body.push(...jsx);
  const props = s.rows > 1 ? `{ rows = ${s.rows} }: { rows?: number }` : '';
  return [
    {
      label: 'SkeletonCard.tsx · React, works in Next.js server components',
      code: `// Show <SkeletonCard /> while data loads, then render the real card.
const css = \`
${css}
\`;

export default function SkeletonCard(${props}) {
  return (
    <div className="skeleton" role="status" aria-label="Loading">
      <style>{css}</style>
${body.join('\n')}
    </div>
  );
}
`,
    },
  ];
}

export function skeletonCode(s: Skeleton, format: Format): CodeBlock[] {
  if (format === 'tailwind') return skeletonTailwind(s);
  if (format === 'react') return skeletonReact(s);
  return [
    { label: 'HTML', code: skeletonHtml(s) },
    { label: 'CSS', code: skeletonCss(s) },
  ];
}
