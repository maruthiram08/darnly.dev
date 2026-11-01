// Runs a pattern over text. Used inside a Web Worker so a slow pattern can be stopped
// instead of freezing the page, and directly when workers are not available.

export type Span = [number, number] | null;
export type Found = { start: number; end: number; text: string; groups: Span[]; values: (string | undefined)[] };
export type Result = { matches: Found[]; total: number; names: (string | null)[] };

export const MAX_MATCHES = 2000;

// Names for each group number, so the list can say “group 1 (user)”.
function groupNames(re: RegExp, groups: number): (string | null)[] {
  const names: (string | null)[] = Array(groups).fill(null);
  const src = re.source;
  let n = 0;
  let inClass = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      continue;
    }
    if (c === '[') inClass = true;
    else if (c === '(') {
      if (src[i + 1] !== '?') n++;
      else {
        const m = /^\(\?<([A-Za-z_$][\w$]*)>/.exec(src.slice(i));
        if (m) {
          n++;
          names[n - 1] = m[1];
        }
      }
    }
  }
  return names;
}

export function run(pattern: string, flags: string, text: string): Result {
  // d gives the position of every group, so groups can be coloured in the text.
  const re = new RegExp(pattern, flags.includes('d') ? flags : flags + 'd');
  const matches: Found[] = [];
  let total = 0;
  const take = (m: RegExpExecArray) => {
    total++;
    if (matches.length >= MAX_MATCHES) return;
    const idx = (m as RegExpExecArray & { indices: Span[] }).indices;
    matches.push({
      start: m.index,
      end: m.index + m[0].length,
      text: m[0],
      groups: idx.slice(1).map((s) => (s ? [s[0], s[1]] : null)),
      values: Array.from(m).slice(1),
    });
  };
  if (re.global) {
    for (const m of text.matchAll(re)) take(m as RegExpExecArray);
  } else {
    const m = re.exec(text);
    if (m) take(m);
  }
  const groupCount = matches[0]?.groups.length ?? new RegExp(`${pattern}|`, flags.replace(/[gy]/g, '')).exec('')!.length - 1;
  return { matches, total, names: groupNames(re, groupCount) };
}
