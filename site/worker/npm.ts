// npm package checker: reads one package from the npm registry and grades it.
// Every request goes to a fixed npm address through the fetcher passed in (get() in index.ts).

export type Level = 'good' | 'warn' | 'bad' | 'info';
export type Check = { level: Level; value: string; note: string };

export type PackageReport = {
  name: string;
  found: true;
  version: string;
  description: string;
  homepage: string | null;
  repository: string | null;
  weekly: number | null; // downloads in the last 7 days
  weeks: number[]; // downloads per week for the last year, oldest first (empty if npm didn't answer)
  published: string | null; // when the latest version came out
  license: string | null;
  deps: number;
  size: number | null; // unpacked bytes
  maintainers: number;
  types: 'built-in' | 'types-package' | 'none';
  typesPackage: string | null;
  deprecated: string | null;
  checks: Record<'downloads' | 'published' | 'license' | 'deps' | 'size' | 'maintainers' | 'types' | 'deprecated', Check>;
  verdict: { level: Level; title: string; text: string };
};
export type Missing = { name: string; found: false; verdict: { level: Level; title: string; text: string } };

// Fetches an address and returns its JSON, or null for a 404, or throws when npm can't be reached.
export type GetJson = (url: string, max?: number) => Promise<{ status: number; data: unknown } | null>;

const REGISTRY = 'https://registry.npmjs.org';
const DOWNLOADS = 'https://api.npmjs.org/downloads';

// npm's own rules: lowercase, url-safe, at most 214 characters, optionally @scope/.
export function cleanName(raw: string): string | null {
  let s = raw.trim().toLowerCase();
  // People paste install commands, npmjs.com links or name@version.
  s = s.replace(/^(npm|pnpm|yarn|bun)\s+(i|install|add)\s+(-[a-z-]+\s+)*/, '');
  s = s.replace(/^https?:\/\/(www\.)?npmjs\.com\/package\//, '').replace(/\/v\/.*$/, '').replace(/[?#].*$/, '');
  s = s.replace(/^(@?[^@\s]+)@.*$/, '$1').replace(/\/+$/, '');
  if (!s || s.length > 214) return null;
  return /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(s) ? s : null;
}

const enc = (name: string) => name.replace('/', '%2F');

// The @types package that DefinitelyTyped would use: @scope/name → @types/scope__name.
export const typesName = (name: string) => `@types/${name.startsWith('@') ? name.slice(1).replace('/', '__') : name}`;

// Daily counts → weekly sums, newest week last. Drops a partial week at the start.
export function toWeeks(days: { downloads: number }[]): number[] {
  const out: number[] = [];
  for (let end = days.length; end - 7 >= 0; end -= 7) {
    let sum = 0;
    for (let i = end - 7; i < end; i++) sum += days[i].downloads || 0;
    out.unshift(sum);
  }
  return out;
}

type Manifest = Record<string, unknown>;

// Has the package's own .d.ts files, judged from package.json.
export function hasOwnTypes(m: Manifest): boolean {
  if (typeof m.types === 'string' || typeof m.typings === 'string') return true;
  const exp = m.exports;
  return !!exp && typeof exp === 'object' && /"types"\s*:|\.d\.[cm]?ts"/.test(JSON.stringify(exp));
}

const PERMISSIVE = /^(MIT|ISC|0BSD|BSD-[23]-Clause|Apache-2\.0|Unlicense|CC0-1\.0|BlueOak-1\.0\.0|Zlib|Python-2\.0|WTFPL|CC-BY-[34]\.0|BSD)$/i;
const WEAK_COPYLEFT = /^(LGPL|MPL|EPL)/i;
const STRONG_COPYLEFT = /^(GPL|AGPL|SSPL|EUPL|OSL)/i;

export function licenseOf(m: Manifest): string | null {
  const l = m.license;
  if (typeof l === 'string' && l.trim()) return l.trim();
  if (l && typeof l === 'object' && typeof (l as { type?: unknown }).type === 'string') return (l as { type: string }).type;
  const ls = m.licenses;
  if (Array.isArray(ls) && ls.length) {
    const t = ls.map((x) => (x && typeof x === 'object' ? (x as { type?: string }).type : x)).filter((x): x is string => typeof x === 'string');
    if (t.length) return t.join(' OR ');
  }
  return null;
}

export function gradeLicense(license: string | null): Check {
  if (!license) return { level: 'bad', value: 'None', note: 'No license means you have no right to use it. Ask the author, or pick another package.' };
  if (/^(UNLICENSED|SEE LICENSE IN)/i.test(license)) return { level: 'warn', value: license.replace(/^SEE LICENSE IN.*/i, 'Custom'), note: 'Not an open source license. Read its terms before you ship it.' };
  // "(MIT OR Apache-2.0)": fine if any choice is permissive.
  const parts = license.replace(/[()]/g, '').split(/\s+(?:OR|AND)\s+/i).map((p) => p.trim());
  const isOr = /\sOR\s/i.test(license);
  const ok = isOr ? parts.some((p) => PERMISSIVE.test(p)) : parts.every((p) => PERMISSIVE.test(p));
  if (ok) return { level: 'good', value: license, note: 'Free to use in any project, including paid ones.' };
  if (parts.some((p) => STRONG_COPYLEFT.test(p))) return { level: 'warn', value: license, note: 'Copyleft: if you ship it, you may have to share your own code too.' };
  if (parts.some((p) => WEAK_COPYLEFT.test(p))) return { level: 'info', value: license, note: 'Fine to use; changes to this package itself must be shared.' };
  return { level: 'info', value: license, note: 'A less common license. Skim its terms.' };
}

export const fmtNum = (n: number) =>
  n >= 1e9 ? `${trim(n / 1e9)}B` : n >= 1e6 ? `${trim(n / 1e6)}M` : n >= 1e3 ? `${trim(n / 1e3)}k` : String(n);
const trim = (n: number) => (n >= 100 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, ''));

export const fmtSize = (b: number) =>
  b >= 1024 * 1024 ? `${trim(b / 1024 / 1024)} MB` : b >= 1024 ? `${Math.round(b / 1024)} kB` : `${b} B`;

export function monthsSince(iso: string, now: number): number {
  return (now - Date.parse(iso)) / (30.44 * 24 * 3600 * 1000);
}

export function ago(iso: string, now: number): string {
  const days = Math.floor((now - Date.parse(iso)) / 86_400_000);
  if (days < 1) return 'today';
  if (days < 2) return 'yesterday';
  if (days < 45) return `${days} days ago`;
  const m = Math.round(days / 30.44);
  if (m < 18) return `${m} months ago`;
  const y = days / 365.25;
  return `${y < 10 ? y.toFixed(1).replace(/\.0$/, '') : Math.round(y)} years ago`;
}

type Facts = Omit<PackageReport, 'checks' | 'verdict' | 'found'>;

// Turns the facts into one graded card each, plus the verdict line on top.
export function grade(f: Facts, now = Date.now()): Pick<PackageReport, 'checks' | 'verdict'> {
  const months = f.published ? monthsSince(f.published, now) : null;
  const when = f.published ? ago(f.published, now) : 'Unknown';
  const isTypes = f.name.startsWith('@types/');

  const checks: PackageReport['checks'] = {
    downloads:
      f.weekly === null
        ? { level: 'info', value: '?', note: 'npm didn’t give us download numbers just now.' }
        : f.weekly >= 100_000
          ? { level: 'good', value: fmtNum(f.weekly), note: 'Very popular. Bugs get found and fixed fast.' }
          : f.weekly >= 1_000
            ? { level: 'info', value: fmtNum(f.weekly), note: 'Used by real projects, but not a household name.' }
            : { level: 'warn', value: fmtNum(f.weekly), note: 'Very few people use this. If an AI agent suggested it, check the name is right.' },
    published:
      months === null
        ? { level: 'info', value: 'Unknown', note: 'npm didn’t tell us when it was last published.' }
        : months >= 24
          ? { level: 'bad', value: when, note: 'No new version in over 2 years. It may be abandoned.' }
          : months >= 12
            ? { level: 'warn', value: when, note: 'No new version in over a year. Check the issues are being answered.' }
            : { level: 'good', value: when, note: 'Recently updated.' },
    license: gradeLicense(f.license),
    deps:
      f.deps === 0
        ? { level: 'good', value: '0', note: 'No dependencies. Nothing else comes along with it.' }
        : f.deps <= 10
          ? { level: 'good', value: String(f.deps), note: `Brings ${f.deps} other ${f.deps === 1 ? 'package' : 'packages'} with it.` }
          : f.deps <= 30
            ? { level: 'info', value: String(f.deps), note: `Brings ${f.deps} other packages with it, and they bring their own.` }
            : { level: 'warn', value: String(f.deps), note: `Brings ${f.deps} other packages with it. More code you didn’t check.` },
    size:
      f.size === null
        ? { level: 'info', value: '?', note: 'npm didn’t list its size.' }
        : f.size > 10 * 1024 * 1024
          ? { level: 'warn', value: fmtSize(f.size), note: 'Big download. Fine on a server; check what reaches the browser.' }
          : { level: f.size > 2 * 1024 * 1024 ? 'info' : 'good', value: fmtSize(f.size), note: 'Unpacked install size, before your bundler trims it.' },
    maintainers:
      f.maintainers <= 1
        ? { level: 'info', value: String(f.maintainers), note: 'One person can publish it. Common, but it all rests on them.' }
        : { level: 'good', value: String(f.maintainers), note: 'More than one person can publish and fix it.' },
    types:
      f.types === 'built-in' || isTypes
        ? { level: 'good', value: 'Built in', note: 'Your editor and AI agent get autocomplete straight away.' }
        : f.types === 'types-package'
          ? { level: 'info', value: 'Separate', note: `Add ${f.typesPackage} as well for autocomplete.` }
          : { level: 'warn', value: 'None', note: 'No TypeScript types, so your agent has to guess how to call it.' },
    deprecated: f.deprecated
      ? { level: 'bad', value: 'Yes', note: f.deprecated.slice(0, 300) }
      : { level: 'good', value: 'No', note: 'The author hasn’t marked it as deprecated.' },
  };

  let verdict: PackageReport['verdict'];
  if (f.deprecated) verdict = { level: 'bad', title: 'Look for an alternative', text: 'The author marked it as deprecated.' };
  else if (months !== null && months >= 24) verdict = { level: 'bad', title: 'Look for an alternative', text: 'Nothing new published in over 2 years.' };
  else if (f.weekly !== null && f.weekly < 1_000) verdict = { level: 'warn', title: 'Check it carefully', text: 'Very few people use it. Make sure it’s the package you meant.' };
  else if (checks.license.level === 'bad') verdict = { level: 'warn', title: 'Check it carefully', text: 'It has no license, so you may not be allowed to use it.' };
  else if (months !== null && months >= 12) verdict = { level: 'warn', title: 'Probably fine, but slowing down', text: 'Popular, but nothing new published in over a year.' };
  else if (checks.license.level === 'warn') verdict = { level: 'warn', title: 'Popular, check the license', text: `Maintained and used, but ${f.license} has strings attached.` };
  else if (f.weekly !== null && f.weekly >= 10_000) verdict = { level: 'good', title: 'Popular and maintained', text: 'Widely used and still updated. A safe pick.' };
  else verdict = { level: 'good', title: 'Looks fine', text: 'Maintained, with a normal license. Less widely used, so read its README.' };
  return { checks, verdict };
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function repoUrl(m: Manifest): string | null {
  const r = m.repository;
  const raw = typeof r === 'string' ? r : r && typeof r === 'object' ? str((r as { url?: unknown }).url) : null;
  if (!raw) return null;
  const gh = raw.match(/^(?:github:)?([\w.-]+\/[\w.-]+)$/);
  if (gh) return `https://github.com/${gh[1]}`;
  const u = raw.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/^ssh:\/\/git@/, 'https://').replace(/^git@([^:]+):/, 'https://$1/').replace(/\.git$/, '');
  return /^https:\/\//.test(u) ? u : null;
}

const safeHttp = (u: string | null) => (u && /^https?:\/\//i.test(u) ? u : null);

// Reads everything we need about one package. Throws if the registry can't be reached.
export async function checkPackage(name: string, getJson: GetJson, now = Date.now()): Promise<PackageReport | Missing> {
  const latest = await getJson(`${REGISTRY}/${enc(name)}/latest`);
  if (!latest || latest.status === 404 || !latest.data || typeof latest.data !== 'object') {
    return {
      name,
      found: false,
      verdict: {
        level: 'bad',
        title: 'This package doesn’t exist',
        text: 'There’s no package with this name on npm. AI agents sometimes make up package names, and attackers register those names later. Check the spelling, or ask your agent for the real one.',
      },
    };
  }
  const m = latest.data as Manifest;
  const own = hasOwnTypes(m);

  const soft = <T>(p: Promise<T>) => p.catch(() => null);
  const [range, search, typesPkg] = await Promise.all([
    soft(getJson(`${DOWNLOADS}/range/last-year/${name}`, 200_000)),
    soft(getJson(`${REGISTRY}/-/v1/search?text=${encodeURIComponent(name)}&size=5`, 200_000)),
    own || name.startsWith('@types/') ? null : soft(getJson(`${REGISTRY}/${enc(typesName(name))}/latest`, 200_000)),
  ]);

  const days = (range?.data as { downloads?: { downloads: number }[] } | undefined)?.downloads;
  const weeks = Array.isArray(days) ? toWeeks(days) : [];
  type Hit = { package?: { name?: string; date?: string }; downloads?: { weekly?: number } };
  const hit = ((search?.data as { objects?: Hit[] } | undefined)?.objects ?? []).find((o) => o.package?.name === name);
  const weekly = weeks.length ? weeks[weeks.length - 1] : typeof hit?.downloads?.weekly === 'number' ? hit.downloads.weekly : null;

  let published = str(hit?.package?.date);
  if (!published) {
    // Not in search results (npm hides deprecated packages there): read the release date from the
    // package's full record. Very large records are skipped and the date shows as unknown.
    type Doc = { time?: Record<string, unknown>; 'dist-tags'?: { latest?: unknown } };
    const doc = (await soft(getJson(`${REGISTRY}/${enc(name)}`, 4_000_000)))?.data as Doc | undefined;
    const tag = str(doc?.['dist-tags']?.latest) ?? str(m.version);
    published = tag ? str(doc?.time?.[tag]) : null;
  }

  // An @types package that says "this package has its own types" doesn't count.
  const typesOk = !!typesPkg && typesPkg.status === 200 && !(typesPkg.data as Manifest | null)?.deprecated;
  const dist = (m.dist ?? {}) as { unpackedSize?: unknown };
  const deps = m.dependencies && typeof m.dependencies === 'object' ? Object.keys(m.dependencies).length : 0;

  const facts: Facts = {
    name,
    version: str(m.version) ?? '?',
    description: (str(m.description) ?? '').slice(0, 300),
    homepage: safeHttp(str(m.homepage)),
    repository: repoUrl(m),
    weekly,
    weeks,
    published,
    license: licenseOf(m),
    deps,
    size: typeof dist.unpackedSize === 'number' ? dist.unpackedSize : null,
    maintainers: Array.isArray(m.maintainers) ? m.maintainers.length : 0,
    types: own ? 'built-in' : typesOk ? 'types-package' : 'none',
    typesPackage: typesOk ? typesName(name) : null,
    deprecated: str(m.deprecated),
  };
  return { ...facts, found: true, ...grade(facts, now) };
}
