// Regex tester: the parts with no page code, so they are easy to reason about.
// explain() turns a JavaScript pattern into plain-English lines; toJs/toPython/toZod make copyable code.

export type Line = {
  src: string; // the piece of the pattern this line is about
  text: string; // what it means, in plain words
  depth: number; // nesting inside groups
  kind: 'text' | 'class' | 'anchor' | 'group' | 'look' | 'or' | 'ref' | 'any';
  quant?: string;
};

export const FLAGS: { f: string; name: string; text: string }[] = [
  { f: 'g', name: 'all', text: 'Find every match, not just the first one.' },
  { f: 'i', name: 'ignore case', text: 'Treat capital and small letters as the same.' },
  { f: 'm', name: 'multiline', text: '^ and $ match at the start and end of every line.' },
  { f: 's', name: 'dot all', text: 'The dot also matches line breaks.' },
  { f: 'u', name: 'unicode', text: 'Unicode mode: emoji count as one character and \\p{…} works.' },
  { f: 'y', name: 'sticky', text: 'Only match starting exactly where the last match ended.' },
];

const SIMPLE_ESCAPES: Record<string, string> = {
  d: 'a digit (0–9)',
  D: 'any character that is not a digit',
  w: 'a letter, digit or underscore',
  W: 'any character that is not a letter, digit or underscore',
  s: 'a space, tab or line break',
  S: 'any character that is not a space, tab or line break',
  n: 'a line break',
  r: 'a carriage return',
  t: 'a tab',
  f: 'a form feed',
  v: 'a vertical tab',
  '0': 'a null character',
};

const CLASS_ESCAPES: Record<string, string> = {
  d: 'digits',
  D: 'non-digits',
  w: 'letters, digits, _',
  W: 'non-word characters',
  s: 'spaces, tabs, line breaks',
  S: 'anything but whitespace',
  n: 'line break',
  r: 'carriage return',
  t: 'tab',
  f: 'form feed',
  v: 'vertical tab',
  b: 'backspace',
  '0': 'null',
};

const UNICODE_NAMES: Record<string, string> = {
  L: 'a letter in any language',
  Letter: 'a letter in any language',
  Lu: 'a capital letter in any language',
  Uppercase_Letter: 'a capital letter in any language',
  Ll: 'a small letter in any language',
  Lowercase_Letter: 'a small letter in any language',
  N: 'a number character in any script',
  Nd: 'a digit in any script',
  P: 'a punctuation mark',
  S: 'a symbol',
  Emoji: 'an emoji',
  Emoji_Presentation: 'an emoji',
  Extended_Pictographic: 'an emoji or pictograph',
};

function quoted(ch: string): string {
  if (ch === ' ') return 'a space';
  if (ch === '\n') return 'a line break';
  if (ch === '\t') return 'a tab';
  return `“${ch}”`;
}

function unicodeProp(body: string, negate: boolean): string {
  const name = body.includes('=') ? body.split('=')[1] : body;
  const nice = UNICODE_NAMES[name];
  const script = body.startsWith('Script=') || body.startsWith('sc=') || body.startsWith('Script_Extensions=');
  const what = nice ?? (script ? `a character from the ${name} script` : `a character with the Unicode property “${body}”`);
  return negate ? `anything except ${what}` : what;
}

function codeChar(hex: string): string {
  const cp = parseInt(hex, 16);
  const ch = Number.isFinite(cp) ? String.fromCodePoint(cp) : '?';
  return `the character U+${hex.toUpperCase().padStart(4, '0')} (${quoted(ch)})`;
}

function rangeName(a: string, b: string): string {
  if (a === 'a' && b === 'z') return 'a–z';
  if (a === 'A' && b === 'Z') return 'A–Z';
  if (a === '0' && b === '9') return '0–9';
  return `${a}–${b}`;
}

// Reads one escape at pattern[i] === '\\'. Returns its length and what it means.
function readEscape(p: string, i: number, inClass: boolean): { len: number; text: string; literal?: string; kind?: Line['kind'] } {
  const c = p[i + 1];
  if (c === undefined) return { len: 1, text: 'a backslash', literal: '\\' };
  if (c === 'x' && /^[0-9a-fA-F]{2}$/.test(p.slice(i + 2, i + 4))) return { len: 4, text: codeChar(p.slice(i + 2, i + 4)), literal: String.fromCharCode(parseInt(p.slice(i + 2, i + 4), 16)) };
  if (c === 'u') {
    const braced = /^\{([0-9a-fA-F]+)\}/.exec(p.slice(i + 2));
    if (braced) return { len: 2 + braced[0].length, text: codeChar(braced[1]), literal: String.fromCodePoint(parseInt(braced[1], 16)) };
    if (/^[0-9a-fA-F]{4}$/.test(p.slice(i + 2, i + 6))) return { len: 6, text: codeChar(p.slice(i + 2, i + 6)), literal: String.fromCharCode(parseInt(p.slice(i + 2, i + 6), 16)) };
  }
  if (c === 'c' && /[a-zA-Z]/.test(p[i + 2] || '')) return { len: 3, text: `the control character Ctrl+${p[i + 2].toUpperCase()}` };
  if (c === 'p' || c === 'P') {
    const m = /^\{([^}]*)\}/.exec(p.slice(i + 2));
    if (m) return { len: 2 + m[0].length, text: unicodeProp(m[1], c === 'P') };
  }
  if (!inClass) {
    if (c === 'b') return { len: 2, text: 'a word edge (where a word starts or ends)', kind: 'anchor' };
    if (c === 'B') return { len: 2, text: 'not at a word edge', kind: 'anchor' };
    if (c === 'k') {
      const m = /^<([^>]+)>/.exec(p.slice(i + 2));
      if (m) return { len: 2 + m[0].length, text: `the same text that group “${m[1]}” matched, again`, kind: 'ref' };
    }
    const num = /^[1-9]\d*/.exec(p.slice(i + 1));
    if (num) return { len: 1 + num[0].length, text: `the same text that group ${num[0]} matched, again`, kind: 'ref' };
  }
  const table = inClass ? CLASS_ESCAPES : SIMPLE_ESCAPES;
  if (table[c]) return { len: 2, text: table[c], literal: c === 'n' ? '\n' : c === 't' ? '\t' : undefined };
  // Escaped punctuation, like \. or \/, just means that character.
  return { len: 2, text: quoted(c), literal: c };
}

// Reads a character class starting at '['. Returns its length and a description.
function readClass(p: string, i: number): { len: number; text: string } {
  let j = i + 1;
  const negate = p[j] === '^';
  if (negate) j++;
  const items: string[] = [];
  let depth = 0; // only used by the v flag's nested classes
  const start = j;
  while (j < p.length) {
    const c = p[j];
    if (c === ']' && depth === 0) break;
    if (c === '[') depth++;
    if (c === ']') depth--;
    let piece: string;
    let lit: string | undefined;
    let len = 1;
    if (c === '\\') {
      const e = readEscape(p, j, true);
      len = e.len;
      lit = e.literal;
      piece = e.literal !== undefined && e.literal.length === 1 && !/[a-zA-Z0-9]/.test(p[j + 1]) ? `“${e.literal}”` : e.text;
    } else {
      lit = c;
      piece = quoted(c);
    }
    // A range like a-z.
    if (lit !== undefined && p[j + len] === '-' && p[j + len + 1] !== undefined && p[j + len + 1] !== ']') {
      let k = j + len + 1;
      let to = p[k];
      let toLen = 1;
      if (to === '\\') {
        const e = readEscape(p, k, true);
        to = e.literal ?? to;
        toLen = e.len;
      }
      items.push(rangeName(lit, to));
      j = k + toLen;
      continue;
    }
    items.push(piece);
    j += len;
  }
  const len = j - i + 1;
  if (j === start) return { len, text: negate ? 'any single character, including line breaks' : 'nothing (an empty set never matches)' };
  const list = items.join(', ');
  return { len, text: negate ? `one character that is NOT any of: ${list}` : `one character from: ${list}` };
}

function quantText(q: string): string {
  const lazy = q.length > 1 && q.endsWith('?') && q !== '?';
  const core = lazy ? q.slice(0, -1) : q;
  let t: string;
  if (core === '*') t = 'any number of times, or not at all';
  else if (core === '+') t = 'one or more times';
  else if (core === '?') t = 'optional';
  else {
    const m = /^\{(\d+)(,(\d*))?\}$/.exec(core)!;
    const a = m[1];
    if (!m[2]) t = `exactly ${a} ${a === '1' ? 'time' : 'times'}`;
    else if (m[3] === '') t = `${a} or more times`;
    else t = `${a} to ${m[3]} times`;
  }
  return lazy ? `${t}, as few as possible` : t;
}

function readQuant(p: string, i: number): string | null {
  const c = p[i];
  let q: string | null = null;
  if (c === '*' || c === '+' || c === '?') q = c;
  else if (c === '{') {
    const m = /^\{\d+(,\d*)?\}/.exec(p.slice(i));
    if (m) q = m[0];
  }
  if (q && p[i + q.length] === '?') q += '?';
  return q;
}

function short(s: string): string {
  return s.length > 28 ? `${s.slice(0, 26)}…` : s;
}

// Plain-English breakdown, one line per piece. Assumes the pattern is valid (checked by the caller).
export function explain(p: string, flags: string): Line[] {
  const lines: Line[] = [];
  const open: { line: Line; start: number }[] = [];
  let group = 0;
  let last: Line | null = null; // what a following quantifier applies to
  let lit: Line | null = null; // literal text being collected
  let litChars: string[] = [];
  let litSrc: string[] = [];
  const depth = () => open.length;

  const flushLit = () => {
    if (lit) lit.text = litChars.length === 1 ? quoted(litChars[0]) : `the text “${litChars.join('')}”`;
    lit = null;
    litChars = [];
    litSrc = [];
  };
  const push = (l: Line) => {
    flushLit();
    lines.push(l);
    last = l;
  };
  const addLit = (ch: string, src: string) => {
    if (!lit) {
      lit = { src: '', text: '', depth: depth(), kind: 'text' };
      lines.push(lit);
    }
    litChars.push(ch);
    litSrc.push(src);
    lit.src += src;
    last = lit;
  };

  let i = 0;
  while (i < p.length) {
    const c = p[i];
    const q = readQuant(p, i);
    if (q && last) {
      // A quantifier after literal text only applies to the last character: split it off.
      if (last === lit && litChars.length > 1) {
        const ch = litChars.pop()!;
        const src = litSrc.pop()!;
        (lit as Line).src = litSrc.join('');
        flushLit();
        last = { src, text: quoted(ch), depth: depth(), kind: 'text' };
        lines.push(last);
      } else if (last === lit) {
        flushLit();
      }
      last.quant = quantText(q);
      last.src += q;
      last = null;
      i += q.length;
      continue;
    }
    if (c === '\\') {
      const e = readEscape(p, i, false);
      const src = p.slice(i, i + e.len);
      if (e.literal !== undefined && !/[a-zA-Z0-9]/.test(p[i + 1]) && e.literal.length === 1) addLit(e.literal, src);
      else push({ src, text: e.text, depth: depth(), kind: e.kind ?? 'class' });
      i += e.len;
      continue;
    }
    if (c === '[') {
      const k = readClass(p, i);
      push({ src: p.slice(i, i + k.len), text: k.text, depth: depth(), kind: 'class' });
      i += k.len;
      continue;
    }
    if (c === '.') {
      push({ src: '.', text: flags.includes('s') ? 'any character' : 'any character except a line break', depth: depth(), kind: 'any' });
      i++;
      continue;
    }
    if (c === '^') {
      push({ src: '^', text: flags.includes('m') ? 'start of a line' : 'start of the text', depth: depth(), kind: 'anchor' });
      last = null;
      i++;
      continue;
    }
    if (c === '$') {
      push({ src: '$', text: flags.includes('m') ? 'end of a line' : 'end of the text', depth: depth(), kind: 'anchor' });
      last = null;
      i++;
      continue;
    }
    if (c === '|') {
      push({ src: '|', text: 'OR', depth: depth(), kind: 'or' });
      last = null;
      i++;
      continue;
    }
    if (c === '(') {
      let text: string;
      let kind: Line['kind'] = 'group';
      let len = 1;
      const rest = p.slice(i);
      let m: RegExpExecArray | null;
      if (rest.startsWith('(?:')) {
        text = 'a group (not saved)';
        len = 3;
      } else if (rest.startsWith('(?=')) {
        text = 'must be followed by (checked, not part of the match)';
        kind = 'look';
        len = 3;
      } else if (rest.startsWith('(?!')) {
        text = 'must NOT be followed by';
        kind = 'look';
        len = 3;
      } else if (rest.startsWith('(?<=')) {
        text = 'must come right after (checked, not part of the match)';
        kind = 'look';
        len = 4;
      } else if (rest.startsWith('(?<!')) {
        text = 'must NOT come right after';
        kind = 'look';
        len = 4;
      } else if ((m = /^\(\?<([A-Za-z_$][\w$]*)>/.exec(rest))) {
        group++;
        text = `group ${group}, named “${m[1]}” (saved)`;
        len = m[0].length;
      } else if ((m = /^\(\?([a-z]*)(-([a-z]*))?:/.exec(rest))) {
        const on = m[1].includes('i') ? 'ignoring case' : m[3]?.includes('i') ? 'matching case exactly' : 'with its own settings';
        text = `a group ${on}`;
        len = m[0].length;
      } else {
        group++;
        text = `group ${group} (saved)`;
      }
      const line: Line = { src: '', text, depth: depth(), kind };
      push(line);
      open.push({ line, start: i });
      last = null;
      i += len;
      continue;
    }
    if (c === ')') {
      flushLit();
      const g = open.pop();
      if (g) {
        g.line.src = short(p.slice(g.start, i + 1));
        last = g.line;
      }
      i++;
      continue;
    }
    // A plain character, which means itself.
    addLit(c, c);
    i++;
  }
  flushLit();
  for (const l of lines) if (l.quant) l.text = `${l.text}, ${l.quant}`;
  return lines;
}

// Splits "/abc/gi" pasted into the pattern box into pattern and flags.
export function splitLiteral(s: string): { pattern: string; flags: string } | null {
  const m = /^\/([\s\S]+)\/([dgimsuvy]*)$/.exec(s.trim());
  return m ? { pattern: m[1], flags: m[2] } : null;
}

export function checkPattern(p: string, flags: string): string | null {
  try {
    new RegExp(p, flags);
    return null;
  } catch (e) {
    const msg = String((e as Error).message || e);
    return msg.replace(/^Invalid regular expression: \/.*\/[a-z]*: /, '').replace(/^Invalid regular expression: /, '');
  }
}

function literal(p: string, flags: string): string {
  // RegExp.source escapes slashes and line breaks so the result can be pasted as a /…/ literal.
  return `/${new RegExp(p, flags).source}/${flags}`;
}

export function toJs(p: string, flags: string): string {
  const lit = literal(p, flags);
  if (flags.includes('g')) {
    return `const pattern = ${lit};\n\n// Every match in a piece of text:\nconst matches = [...text.matchAll(pattern)].map((m) => m[0]);`;
  }
  return `const pattern = ${lit};\n\n// true or false:\nconst ok = pattern.test(value);\n\n// The match and its groups:\nconst match = value.match(pattern);`;
}

export function toZod(p: string, flags: string): string {
  // g and y make .test() remember where it stopped, which breaks validation on the second call.
  const f = flags.replace(/[gy]/g, '');
  const lines = [`import { z } from 'zod';`, '', `const schema = z.string().regex(${literal(p, f)}, {`, `  message: 'That does not look right.',`, '});'];
  const anchored = p.startsWith('^') && p.endsWith('$') && !p.endsWith('\\$');
  if (!anchored) lines.push('', '// Tip: start the pattern with ^ and end it with $, or text that only *contains*', '// a match will pass too.');
  if (f !== flags) lines.push('', '// The g and y flags were removed: they make validation pass and fail in turns.');
  return lines.join('\n');
}

export function toPython(p: string, flags: string): { code: string; notes: string[] } {
  const notes: string[] = [];
  let out = '';
  let inClass = false;
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '\\') {
      const rest = p.slice(i);
      let m: RegExpExecArray | null;
      if (!inClass && (m = /^\\k<([^>]+)>/.exec(rest))) {
        out += `(?P=${m[1]})`;
        i += m[0].length - 1;
      } else if ((m = /^\\u\{([0-9a-fA-F]+)\}/.exec(rest))) {
        out += `\\U${m[1].padStart(8, '0')}`;
        i += m[0].length - 1;
      } else if ((m = /^\\[pP]\{[^}]*\}/.exec(rest))) {
        out += m[0];
        i += m[0].length - 1;
        if (!notes.some((n) => n.includes('\\p{'))) notes.push('\\p{…} needs the "regex" package (pip install regex): use regex.compile instead of re.compile.');
      } else if ((m = /^\\c[a-zA-Z]/.exec(rest))) {
        out += `\\x${(m[0].charCodeAt(2) % 32).toString(16).padStart(2, '0')}`;
        i += 2;
      } else if (rest[1] === '/') {
        out += '/';
        i++;
      } else {
        out += rest.slice(0, 2);
        i++;
      }
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      out += c;
      continue;
    }
    if (c === '[') {
      if (p.startsWith('[^]', i)) {
        out += '[\\s\\S]';
        i += 2;
        continue;
      }
      if (p.startsWith('[]', i)) {
        out += '(?!)';
        i += 1;
        continue;
      }
      inClass = true;
      out += c;
      continue;
    }
    const named = /^\(\?<([A-Za-z_]\w*)>/.exec(p.slice(i));
    if (named) {
      out += `(?P<${named[1]}>`;
      i += named[0].length - 1;
      continue;
    }
    out += c;
  }

  const pyFlags: string[] = [];
  if (flags.includes('i')) pyFlags.push('re.IGNORECASE');
  if (flags.includes('m')) pyFlags.push('re.MULTILINE');
  if (flags.includes('s')) pyFlags.push('re.DOTALL');
  if (flags.includes('y')) notes.push('Python has no sticky flag: use pattern.match(text, pos) to match at an exact position.');

  let str: string;
  if (!out.includes('"')) str = `r"${out}"`;
  else if (!out.includes("'")) str = `r'${out}'`;
  else if (!out.includes('"""') && !out.endsWith('"')) str = `r"""${out}"""`;
  else str = JSON.stringify(out);

  const args = pyFlags.length ? `${str}, ${pyFlags.join(' | ')}` : str;
  const use = flags.includes('g')
    ? '# Every match in a piece of text:\nmatches = [m.group(0) for m in pattern.finditer(text)]'
    : '# Does the whole value match?\nok = pattern.fullmatch(value) is not None\n\n# First match anywhere:\nmatch = pattern.search(value)';
  const head = notes.length ? notes.map((n) => `# Note: ${n}`).join('\n') + '\n' : '';
  return { code: `import re\n\n${head}pattern = re.compile(${args})\n\n${use}`, notes };
}

// Ready-made patterns. Each comes with lines of sample text: some should match and some should not.
export const LIBRARY: { id: string; name: string; pattern: string; flags: string; text: string; about: string }[] = [
  {
    id: 'email',
    name: 'Email',
    pattern: '^[\\w.+-]+@[\\w-]+(\\.[\\w-]+)*\\.[a-zA-Z]{2,}$',
    flags: 'gm',
    about: 'An email address: a name, an @, a domain and an ending like .com.',
    text: 'hello@darnly.dev\nmaruthi.ram+test@gmail.com\nsupport@mail.example.co.uk\nnot-an-email\nmissing@tld\n@nouser.com\nspace in@name.com',
  },
  {
    id: 'url',
    name: 'URL',
    pattern: '^https?:\\/\\/[\\w-]+(\\.[\\w-]+)+(:\\d+)?(\\/\\S*)?$',
    flags: 'gim',
    about: 'A web address that starts with http:// or https://.',
    text: 'https://darnly.dev\nhttp://localhost.test:3000/app?tab=1\nhttps://www.example.com/blog/post-1#top\nftp://files.example.com\ndarnly.dev\nhttps://no spaces.com',
  },
  {
    id: 'phone',
    name: 'Phone (US)',
    pattern: '^\\+?(\\d{1,3}[\\s.-]?)?\\(?\\d{3}\\)?[\\s.-]?\\d{3}[\\s.-]?\\d{4}$',
    flags: 'gm',
    about: 'A 10-digit phone number, with an optional country code, brackets, dots or dashes.',
    text: '+1 415 555 0132\n(415) 555-0132\n415.555.0132\n4155550132\n555-0132\n415-555-01',
  },
  {
    id: 'phone-in',
    name: 'Phone (India)',
    pattern: '^(\\+91[\\s-]?)?[6-9]\\d{9}$',
    flags: 'gm',
    about: 'An Indian mobile number: 10 digits starting with 6 to 9, with an optional +91.',
    text: '9876543210\n+91 9876543210\n+91-7012345678\n5876543210\n98765 43210\n987654321',
  },
  {
    id: 'slug',
    name: 'Slug',
    pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
    flags: 'gm',
    about: 'A URL slug: small letters and numbers, joined by single dashes.',
    text: 'my-first-post\nregex-tester\npost2024\nMy-Post\ntrailing-\ndouble--dash\nwith space',
  },
  {
    id: 'hex',
    name: 'Hex color',
    pattern: '^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$',
    flags: 'gim',
    about: 'A CSS hex color: # and then 3, 4, 6 or 8 hex digits.',
    text: '#0EA5E9\n#fff\n#ffffff80\n#1234\n0EA5E9\n#12345\n#GGGGGG',
  },
  {
    id: 'date',
    name: 'Date (YYYY-MM-DD)',
    pattern: '^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$',
    flags: 'gm',
    about: 'A date like 2026-11-01. Months 01–12, days 01–31.',
    text: '2026-11-01\n1999-12-31\n2026-02-30\n2026-13-01\n26-11-01\n2026/11/01',
  },
  {
    id: 'password',
    name: 'Strong password',
    pattern: '^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).{8,}$',
    flags: 'gm',
    about: 'At least 8 characters, with a small letter, a capital letter and a digit.',
    text: 'Sunshine42\nP4ssword!\npassword\nPASSWORD123\nShort1\nlongbutnodigits',
  },
  {
    id: 'price',
    name: 'Prices in text',
    pattern: '\\$(\\d{1,3}(,\\d{3})*|\\d+)(\\.\\d{2})?',
    flags: 'g',
    about: 'Dollar amounts anywhere in a sentence, like $9, $1,299 or $19.99.',
    text: 'The Pro plan is $19.99 a month, or $199 a year.\nTeams pay $1,299 for 10 seats. Old price: $24.50.\nNo price here: 19.99 or USD 20.',
  },
];
