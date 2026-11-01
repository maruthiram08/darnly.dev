// JSON to TypeScript: the parser, type inferrer and printers. No DOM here, so it can be tested on its own.

// ---------- Parsing ----------
// A small JSON parser of our own, so errors give a line, a column and a plain reason in every browser,
// numbers keep their exact digits (big ids stay intact) and duplicate or "__proto__" keys are safe.

export class Num {
  constructor(public raw: string) {}
  get int() {
    return !/[.eE]/.test(this.raw);
  }
}
export type Json = null | boolean | string | Num | Json[] | Map<string, Json>;

export class JsonError extends Error {
  constructor(message: string, public line: number, public column: number) {
    super(message);
  }
}

export function parse(text: string): Json {
  let i = 0;
  // A byte order mark at the start is harmless; skip it.
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  const fail = (msg: string, at = i): never => {
    let line = 1;
    let col = 1;
    for (let k = 0; k < at && k < text.length; k++) {
      if (text[k] === '\n') {
        line++;
        col = 1;
      } else col++;
    }
    throw new JsonError(msg, line, col);
  };

  const describe = (ch: string | undefined) => {
    if (ch === undefined) return 'the end';
    if (ch === "'") return 'a single quote (\')';
    if (ch === '`') return 'a backtick (`)';
    if (/\s/.test(ch)) return 'a space';
    return `“${ch}”`;
  };

  const space = () => {
    for (;;) {
      const c = text[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') i++;
      else if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*'))
        fail('There’s a comment here. JSON doesn’t allow comments, so remove it.');
      else break;
    }
  };

  const value = (): Json => {
    space();
    const c = text[i];
    if (c === '{') return object();
    if (c === '[') return array();
    if (c === '"') return string();
    if (c === '-' || (c >= '0' && c <= '9')) return number();
    if (text.startsWith('true', i)) return (i += 4), true;
    if (text.startsWith('false', i)) return (i += 5), false;
    if (text.startsWith('null', i)) return (i += 4), null;
    if (c === undefined) return fail('The JSON ends too early. Something is missing at the end, like a value, a } or a ].');
    if (c === "'") return fail('Text in JSON needs double quotes ("like this"), not single quotes.');
    if (text.startsWith('undefined', i)) return fail('“undefined” isn’t allowed in JSON. Use null instead.');
    if (text.startsWith('NaN', i) || text.startsWith('Infinity', i)) return fail('NaN and Infinity aren’t allowed in JSON. Use a number or null.');
    if (/[A-Za-z_$]/.test(c)) return fail('This text needs double quotes around it ("like this").');
    return fail(`Expected a value here, but found ${describe(c)}.`);
  };

  const object = (): Map<string, Json> => {
    const out = new Map<string, Json>();
    i++;
    space();
    if (text[i] === '}') return i++, out;
    let comma = -1;
    for (;;) {
      space();
      const c = text[i];
      if (c === '}') fail('This comma is extra. JSON doesn’t allow a comma after the last item, so remove it.', comma);
      if (c === "'") fail('Names in JSON need double quotes ("name"), not single quotes.');
      if (c !== undefined && /[A-Za-z_$]/.test(c)) fail('This name needs double quotes around it, like "name".');
      if (c !== '"') fail(c === undefined ? 'The JSON ends too early. A } is missing at the end.' : `Expected a name in double quotes here, but found ${describe(c)}.`);
      const key = string();
      space();
      if (text[i] !== ':') fail(`Expected a colon (:) after the name "${key}", but found ${describe(text[i])}.`);
      i++;
      out.set(key, value());
      space();
      if (text[i] === ',') {
        comma = i++;
        continue;
      }
      if (text[i] === '}') return i++, out;
      if (text[i] === undefined) fail('The JSON ends too early. A } is missing at the end.');
      fail(`Expected a comma or a } here, but found ${describe(text[i])}. Is a comma missing?`);
    }
  };

  const array = (): Json[] => {
    const out: Json[] = [];
    i++;
    space();
    if (text[i] === ']') return i++, out;
    let comma = -1;
    for (;;) {
      space();
      if (text[i] === ']') fail('This comma is extra. JSON doesn’t allow a comma after the last item, so remove it.', comma);
      out.push(value());
      space();
      if (text[i] === ',') {
        comma = i++;
        continue;
      }
      if (text[i] === ']') return i++, out;
      if (text[i] === undefined) fail('The JSON ends too early. A ] is missing at the end.');
      fail(`Expected a comma or a ] here, but found ${describe(text[i])}. Is a comma missing?`);
    }
  };

  const string = (): string => {
    const start = i;
    i++;
    let out = '';
    for (;;) {
      const c = text[i];
      if (c === undefined) fail('This text is never closed. A " is missing.', start);
      if (c === '"') return i++, out;
      if (c === '\n') fail('This text runs onto a new line. Close it with a " first, or write \\n for a line break.', start);
      if (c < ' ') fail('This text has a tab or another hidden character in it. Write \\t for a tab.');
      if (c === '\\') {
        const e = text[i + 1];
        const map: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (e === 'u') {
          const hex = text.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('\\u must be followed by four hex digits, like \\u00e9.');
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
        if (e === undefined || !(e in map)) fail(`“\\${e ?? ''}” isn’t allowed in JSON text. To write a backslash, use \\\\.`);
        out += map[e];
        i += 2;
        continue;
      }
      out += c;
      i++;
    }
  };

  const number = (): Num => {
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 400));
    if (!m) return fail('This number isn’t written the JSON way. Use digits like 42, -3 or 1.5.');
    if (/^-?0\d/.test(text.slice(i, i + 3))) fail('Numbers in JSON can’t start with 0, like 007. Use 7, or put it in quotes as text.');
    i += m[0].length;
    if (text[i] === '.' || /[0-9A-Za-z_]/.test(text[i] ?? '')) fail('This number isn’t written the JSON way. Use digits like 42, -3 or 1.5.');
    return new Num(m[0]);
  };

  space();
  if (i >= text.length) fail('Paste some JSON to start.');
  const result = value();
  space();
  if (i < text.length) {
    if (text[i] === ',') fail('There’s more after the end of the JSON. If you meant a list, wrap everything in [ and ].');
    fail(`The JSON should end here, but there’s more after it, starting with ${describe(text[i])}. Remove the extra text, or wrap several items in [ and ].`);
  }
  return result;
}

// ---------- Formatting ----------
export function format(v: Json, indent = 2): string {
  const pad = (n: number) => ' '.repeat(n * indent);
  const go = (v: Json, d: number): string => {
    if (v === null) return 'null';
    if (typeof v === 'boolean') return String(v);
    if (typeof v === 'string') return JSON.stringify(v);
    if (v instanceof Num) return v.raw;
    if (Array.isArray(v)) {
      if (!v.length) return '[]';
      return `[\n${v.map((x) => pad(d + 1) + go(x, d + 1)).join(',\n')}\n${pad(d)}]`;
    }
    if (!v.size) return '{}';
    const rows = [...v].map(([k, x]) => `${pad(d + 1)}${JSON.stringify(k)}: ${go(x, d + 1)}`);
    return `{\n${rows.join(',\n')}\n${pad(d)}}`;
  };
  return go(v, 0);
}

// ---------- Inferring types ----------
type Field = { type: T; optional: boolean };
export type T =
  | { kind: 'null' }
  | { kind: 'string' }
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'never' } // the item type of an empty list
  | { kind: 'array'; item: T }
  | { kind: 'object'; fields: Map<string, Field>; hint: string }
  | { kind: 'union'; types: T[] };

function infer(v: Json, hint: string): T {
  if (v === null) return { kind: 'null' };
  if (typeof v === 'boolean') return { kind: 'boolean' };
  if (typeof v === 'string') return { kind: 'string' };
  if (v instanceof Num) return { kind: 'number' };
  if (Array.isArray(v)) {
    const itemHint = singular(hint);
    let item: T = { kind: 'never' };
    for (const x of v) item = merge(item, infer(x, itemHint));
    return { kind: 'array', item };
  }
  const fields = new Map<string, Field>();
  for (const [k, x] of v) fields.set(k, { type: infer(x, k), optional: false });
  return { kind: 'object', fields, hint };
}

const members = (t: T): T[] => (t.kind === 'union' ? t.types : t.kind === 'never' ? [] : [t]);

// Combines what two samples say about the same place. Fields missing from one side become optional.
function merge(a: T, b: T): T {
  if (a.kind === 'never') return b;
  if (b.kind === 'never') return a;
  if (a.kind === 'object' && b.kind === 'object') {
    const fields = new Map<string, Field>();
    for (const [k, f] of a.fields) {
      const g = b.fields.get(k);
      fields.set(k, g ? { type: merge(f.type, g.type), optional: f.optional || g.optional } : { ...f, optional: true });
    }
    for (const [k, g] of b.fields) if (!a.fields.has(k)) fields.set(k, { ...g, optional: true });
    return { kind: 'object', fields, hint: a.hint };
  }
  if (a.kind === 'array' && b.kind === 'array') return { kind: 'array', item: merge(a.item, b.item) };
  if (a.kind !== 'union' && b.kind !== 'union' && a.kind === b.kind) return a;
  // Different kinds: keep one member per kind, merging same-kind members.
  const out: T[] = [];
  for (const t of [...members(a), ...members(b)]) {
    const k = out.findIndex((o) => o.kind === t.kind);
    if (k === -1) out.push(t);
    else out[k] = merge(out[k], t);
  }
  return out.length === 1 ? out[0] : { kind: 'union', types: out };
}

// ---------- Naming ----------
const RESERVED = new Set(
  'any unknown never object string number boolean symbol bigint null undefined void Array Object String Number Boolean Date Map Set Record Partial Promise Function Error'.split(' '),
);

export function pascal(s: string): string {
  const words = s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  let out = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  if (!out) out = 'Item';
  if (/^\d/.test(out)) out = `T${out}`;
  if (RESERVED.has(out)) out += 'Type';
  return out;
}

// Names the items of a list: users -> User, categories -> Category, boxes -> Box, data -> DataItem.
export function singular(s: string): string {
  if (/[^aeiou]ies$/i.test(s)) return s.slice(0, -3) + (s.endsWith('IES') ? 'Y' : 'y');
  if (/(ss|sh|ch|x|z)es$/i.test(s)) return s.slice(0, -2);
  if (/(ss|us|is)$/i.test(s)) return `${s}Item`;
  if (/s$/i.test(s) && s.length > 1) return s.slice(0, -1);
  return `${s}Item`;
}

// ---------- Printing ----------
export type Options = {
  rootName: string;
  style: 'interface' | 'type';
  optional: boolean; // make every field optional
  readonly: boolean;
};

type Def = { name: string; type: T & { kind: 'object' } };

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const key = (k: string) => (IDENT.test(k) ? k : JSON.stringify(k));

// Gives every object shape a name. Shapes that are exactly the same share one name.
function nameObjects(root: T, rootName: string) {
  const defs: Def[] = [];
  const byShape = new Map<string, string>();
  const taken = new Set<string>();
  const names = new Map<T, string>();

  const shape = (t: T): string => {
    switch (t.kind) {
      case 'array':
        return `[${shape(t.item)}]`;
      case 'union':
        return t.types.map(shape).sort().join('|');
      case 'object':
        return `{${[...t.fields].map(([k, f]) => `${JSON.stringify(k)}${f.optional ? '?' : ''}:${shape(f.type)}`).join(',')}}`;
      default:
        return t.kind;
    }
  };

  const visit = (t: T, root = false) => {
    if (t.kind === 'array') return visit(t.item);
    if (t.kind === 'union') return t.types.forEach((m) => visit(m));
    if (t.kind !== 'object') return;
    const s = shape(t);
    let name = byShape.get(s);
    if (!name) {
      const base = root ? pascal(rootName) : pascal(t.hint);
      name = base;
      for (let n = 2; taken.has(name); n++) name = `${base}${n}`;
      taken.add(name);
      byShape.set(s, name);
      defs.push({ name, type: t });
    }
    names.set(t, name);
    // Same-shaped copies still have their own nested objects, so name those too.
    for (const f of t.fields.values()) visit(f.type);
  };
  // A list or plain value at the top gets the root name as a type alias, so nested types never take it.
  if (root.kind !== 'object') taken.add(pascal(rootName));
  visit(root, root.kind === 'object');
  return { defs, names };
}

function tsType(t: T, names: Map<T, string>, ro: boolean): string {
  switch (t.kind) {
    case 'never':
      return 'unknown';
    case 'object':
      return names.get(t)!;
    case 'array': {
      const inner = tsType(t.item, names, ro);
      const wrapped = t.item.kind === 'union' ? `(${inner})` : inner;
      return `${ro ? 'readonly ' : ''}${wrapped}[]`;
    }
    case 'union': {
      // null last reads best: string | null.
      const sorted = [...t.types].sort((a, b) => (a.kind === 'null' ? 1 : 0) - (b.kind === 'null' ? 1 : 0));
      return sorted.map((m) => tsType(m, names, ro)).join(' | ');
    }
    default:
      return t.kind;
  }
}

export function toTypeScript(json: Json, o: Options): string {
  const root = infer(json, o.rootName);
  const { defs, names } = nameObjects(root, o.rootName);
  const rootName = pascal(o.rootName);
  const out: string[] = [];
  const ro = o.readonly ? 'readonly ' : '';

  if (root.kind !== 'object') out.push(`export type ${rootName} = ${tsType(root, names, o.readonly)};`);

  for (const d of defs) {
    const rows = [...d.type.fields].map(
      ([k, f]) => `  ${ro}${key(k)}${f.optional || o.optional ? '?' : ''}: ${tsType(f.type, names, o.readonly)};`,
    );
    const body = rows.length ? `{\n${rows.join('\n')}\n}` : '{}';
    out.push(o.style === 'interface' ? `export interface ${d.name} ${body}` : `export type ${d.name} = ${body};`);
  }
  return out.join('\n\n') + '\n';
}

function zodType(t: T, names: Map<T, string>): string {
  switch (t.kind) {
    case 'never':
      return 'z.unknown()';
    case 'null':
      return 'z.null()';
    case 'string':
    case 'number':
    case 'boolean':
      return `z.${t.kind}()`;
    case 'object':
      return `${names.get(t)}Schema`;
    case 'array':
      return `z.array(${zodType(t.item, names)})`;
    case 'union': {
      const rest = t.types.filter((m) => m.kind !== 'null');
      const hasNull = rest.length < t.types.length;
      const inner = rest.length === 1 ? zodType(rest[0], names) : `z.union([${rest.map((m) => zodType(m, names)).join(', ')}])`;
      return hasNull ? `${inner}.nullable()` : inner;
    }
  }
}

export function toZod(json: Json, o: Options): string {
  const root = infer(json, o.rootName);
  const { defs, names } = nameObjects(root, o.rootName);
  const rootName = pascal(o.rootName);

  // Zod needs each schema written before the schemas that use it.
  const order: Def[] = [];
  const seen = new Set<string>();
  const byName = new Map(defs.map((d) => [d.name, d]));
  const deps = (t: T, acc: string[]) => {
    if (t.kind === 'object') acc.push(names.get(t)!);
    else if (t.kind === 'array') deps(t.item, acc);
    else if (t.kind === 'union') t.types.forEach((m) => deps(m, acc));
    return acc;
  };
  const place = (d: Def) => {
    if (seen.has(d.name)) return;
    seen.add(d.name);
    for (const f of d.type.fields.values()) for (const n of deps(f.type, [])) place(byName.get(n)!);
    order.push(d);
  };
  defs.forEach(place);

  const out: string[] = ['import { z } from "zod";'];
  for (const d of order) {
    const rows = [...d.type.fields].map(
      ([k, f]) => `  ${key(k)}: ${zodType(f.type, names)}${f.optional || o.optional ? '.optional()' : ''},`,
    );
    const body = rows.length ? `z.object({\n${rows.join('\n')}\n})` : 'z.object({})';
    out.push(`export const ${d.name}Schema = ${body}${o.readonly ? '.readonly()' : ''};`);
  }
  if (root.kind !== 'object') out.push(`export const ${rootName}Schema = ${zodType(root, names)};`);
  out.push(`export type ${rootName} = z.infer<typeof ${rootName}Schema>;`);
  return out.join('\n\n') + '\n';
}
