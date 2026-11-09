/**
 * Which code drew an element, read from the framework's own development info in the page.
 * Runs in the page (MAIN world, inside the recorder), because only code there can see these properties.
 * Production builds strip all of it, so on a live site the answer is simply empty.
 *
 * - React 18: fiber._debugSource (where each JSX tag is written). React 19: fiber._debugStack (the stack that made it).
 * - Vue 3: el.__vueParentComponent (type.__file in dev). Vue 2: el.__vue__ ($options.__file).
 * - Svelte 4 and 5: el.__svelte_meta (loc.file and line of the tag; Svelte 5 also lists the parent components).
 * - Dev plugins that write the path on the element (react-dev-inspector, LocatorJS-style data-source-file).
 */

/** One component around the element, outermost first. */
export interface CodePart {
  name: string;
  /** Where this component's tag is written (in its parent's file): change it here to change only this use. */
  at?: string;
  /** The component's own file (Vue and Svelte know it; React doesn't say). */
  file?: string;
}

export interface SourceInfo {
  framework: 'react' | 'vue' | 'svelte' | 'attribute';
  /** Component names, outermost first, at most 4. */
  chain: string[];
  /** The file (and line) of the element's own tag: "start here". */
  source?: string;
  /** The same components with where each is placed and defined. */
  parts: CodePart[];
}

const MAX_PARTS = 4;

/** "/Users/me/shop/src/components/Card.tsx?t=1" becomes "src/components/Card.tsx". */
export function shortPath(path: string): string {
  const clean = path.replace(/^(webpack-internal:\/\/\/|file:\/\/)/, '').replace(/[?#].*$/, '').replace(/^\([^)]*\)\/\.?\/?/, '').replace(/^\.\//, '');
  // src/ wins over a project folder that happens to be called app/ ("/Users/me/app/src/Card.vue").
  for (const dir of ['src', 'app', 'components', 'pages', 'lib', 'routes']) {
    const m = clean.match(new RegExp(`(?:^|/)(${dir}/.+)$`));
    if (m) return m[1]!;
  }
  const parts = clean.split('/').filter(Boolean);
  return parts.slice(-3).join('/');
}

const withLine = (file: string, line?: number) => `${shortPath(file)}${line ? `:${line}` : ''}`;

// ---------- React ----------

type Fiber = { type?: unknown; return?: Fiber | null; _debugSource?: { fileName?: string; lineNumber?: number } | null; _debugStack?: { stack?: string } | null };

const REACT_SKIP = /^(Fragment|Suspense|StrictMode|Provider|Consumer|Context|ErrorBoundary|Router|Layout(Router)?|InnerLayoutRouter|OuterLayoutRouter|RenderFromTemplateContext|ScrollAndFocusHandler|RedirectBoundary|NotFoundBoundary|LoadingBoundary|HTTPAccessFallbackBoundary)/;

function fiberName(f: Fiber): string | undefined {
  let t = f.type as { displayName?: string; name?: string; render?: { name?: string }; type?: { name?: string } } | string | undefined;
  if (!t || typeof t === 'string') return undefined;
  // forwardRef and memo wrap the real component.
  const name = t.displayName || t.name || t.render?.name || t.type?.name;
  return name && /^[A-Z]/.test(name) && !REACT_SKIP.test(name) ? name : undefined;
}

/** Where the fiber's JSX tag is written, in the user's own code. */
export function reactSourceOf(f: Fiber): string | undefined {
  const ds = f._debugSource;
  if (ds?.fileName) return withLine(ds.fileName, ds.lineNumber);
  for (const line of (f._debugStack?.stack ?? '').split('\n').slice(1)) {
    if (/node_modules|react-dom|react-server|next\/dist|chunk-|\/@vite\/|\/@react-refresh/.test(line)) continue;
    const m = line.match(/((?:src|app|components|pages|lib)\/[\w./@\[\]()-]+\.(?:tsx|jsx|ts|js))(?:\?[^:)]*)?(?::(\d+))?/);
    if (m) return m[2] ? `${m[1]}:${m[2]}` : m[1];
  }
  return undefined;
}

function reactInfo(el: Element): SourceInfo | undefined {
  let node: Element | null = el;
  for (let i = 0; node && i < 10; i++, node = node.parentElement) {
    const key = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
    if (!key) continue;
    let fiber = (node as unknown as Record<string, Fiber>)[key] as Fiber | null | undefined;
    const parts: CodePart[] = [];
    let source: string | undefined;
    for (let guard = 0; fiber && guard < 200 && parts.length < MAX_PARTS; guard++, fiber = fiber.return) {
      const name = fiberName(fiber);
      if (!name) {
        // The element's own tag (and any plain tags around it) before the first component.
        if (!parts.length) source ??= reactSourceOf(fiber);
        continue;
      }
      if (parts[0]?.name === name) continue;
      // Before the first component no tag had a file: the component's own placement is the best "start here".
      source ??= reactSourceOf(fiber);
      const at = reactSourceOf(fiber);
      parts.unshift({ name, ...(at ? { at } : {}) });
    }
    if (parts.length || source) return { framework: 'react', chain: parts.map((p) => p.name), source, parts };
  }
  return undefined;
}

// ---------- Vue ----------

type VueType = { name?: string; __name?: string; __file?: string };
type VueInstance = { type?: VueType; parent?: VueInstance | null };
type Vue2 = { $options?: { name?: string; _componentTag?: string; __file?: string }; $parent?: Vue2 | null };

const baseName = (file?: string) => file?.split('/').pop()?.replace(/\.(vue|svelte|tsx?|jsx?)$/, '');
const pascal = (name?: string) => name?.replace(/(^|[-_])(\w)/g, (_, __, c: string) => c.toUpperCase());

function vueInfo(el: Element): SourceInfo | undefined {
  let node: Element | null = el;
  for (let i = 0; node && i < 10; i++, node = node.parentElement) {
    const v3 = (node as unknown as { __vueParentComponent?: VueInstance }).__vueParentComponent;
    const v2 = (node as unknown as { __vue__?: Vue2 }).__vue__;
    if (!v3 && !v2) continue;
    const parts: CodePart[] = [];
    if (v3) {
      let inst: VueInstance | null | undefined = v3;
      for (let guard = 0; inst && guard < 50 && parts.length < MAX_PARTS; guard++, inst = inst.parent) {
        const file = inst.type?.__file;
        const name = pascal(inst.type?.name || inst.type?.__name || baseName(file));
        // The app root has no file and no name worth showing.
        if (!name || !/^[A-Z]/.test(name)) continue;
        parts.unshift({ name, ...(file ? { file: shortPath(file) } : {}) });
      }
    } else {
      let vm: Vue2 | null | undefined = v2;
      for (let guard = 0; vm && guard < 50 && parts.length < MAX_PARTS; guard++, vm = vm.$parent) {
        const file = vm.$options?.__file;
        const name = pascal(vm.$options?.name || vm.$options?._componentTag || baseName(file));
        if (!name || !/^[A-Z]/.test(name)) continue;
        parts.unshift({ name, ...(file ? { file: shortPath(file) } : {}) });
      }
    }
    if (!parts.length) return undefined;
    return { framework: 'vue', chain: parts.map((p) => p.name), source: parts.at(-1)?.file, parts };
  }
  return undefined;
}

// ---------- Svelte ----------

type SvelteLoc = { file?: string; line?: number };
type SvelteParent = { type?: string; file?: string; line?: number; componentTag?: string; parent?: SvelteParent | null };
type SvelteMeta = { loc?: SvelteLoc; parent?: SvelteParent | null };

function svelteInfo(el: Element): SourceInfo | undefined {
  let node: Element | null = el;
  for (let i = 0; node && i < 10; i++, node = node.parentElement) {
    const meta = (node as unknown as { __svelte_meta?: SvelteMeta }).__svelte_meta;
    if (!meta?.loc?.file) continue;
    // Svelte versions differ on counting lines from 0 or 1; either way it lands on or next to the tag.
    const source = withLine(meta.loc.file, meta.loc.line);
    const parts: CodePart[] = [];
    // Svelte 5 dev: each component boundary names the component and where its tag is written (in the parent's file).
    let own = shortPath(meta.loc.file);
    let p = meta.parent;
    for (let guard = 0; p && guard < 50 && parts.length < MAX_PARTS; guard++, p = p.parent) {
      if (p.type !== 'component') continue;
      const name = pascal(p.componentTag);
      if (!name || !/^[A-Z]/.test(name)) continue;
      parts.unshift({ name, file: own, ...(p.file ? { at: withLine(p.file, p.line) } : {}) });
      if (p.file) own = shortPath(p.file);
    }
    // Svelte 4 has no parents: the component is the file the tag is in.
    const name = pascal(baseName(meta.loc.file));
    if (!parts.length && name && /^[A-Z]/.test(name)) parts.push({ name, file: shortPath(meta.loc.file) });
    return { framework: 'svelte', chain: parts.map((x) => x.name), source, parts };
  }
  return undefined;
}

// ---------- all of them ----------

/** What the page's framework knows about who drew this element; undefined on production builds and plain HTML. */
export function sourceInfo(el: Element): SourceInfo | undefined {
  // Some dev tools (react-dev-inspector, LocatorJS-style plugins) write the file path on the element itself.
  const attr = el.closest('[data-inspector-relative-path],[data-source-file]');
  const attrSource = attr
    ? `${attr.getAttribute('data-inspector-relative-path') ?? attr.getAttribute('data-source-file')}${attr.getAttribute('data-inspector-line') ? `:${attr.getAttribute('data-inspector-line')}` : ''}`
    : undefined;
  let info: SourceInfo | undefined;
  for (const read of [reactInfo, vueInfo, svelteInfo]) {
    try {
      info = read(el);
    } catch {
      /* a page can define these properties as anything: never break the capture */
    }
    if (info) break;
  }
  if (info) return attrSource ? { ...info, source: attrSource } : info;
  return attrSource ? { framework: 'attribute', chain: [], source: attrSource, parts: [] } : undefined;
}
