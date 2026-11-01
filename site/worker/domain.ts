// Domain checker: reads a domain's DNS records (A, AAAA, CNAME, MX, TXT, NS) over DNS-over-HTTPS,
// works out which host it points to, then opens https and http for the bare domain and www,
// following each redirect by hand. Each problem gets a fix in plain words for that host.
// The Worker passes in `dns` and `hop`, which go through the shared page reader in index.ts,
// so the address checks, timeouts and read limits apply to every request made here.

export type Answer = { name: string; type: number; data: string };
export type DnsResult = { status: number; answers: Answer[] } | null;
export type Dns = (name: string, type: string) => Promise<DnsResult>;
export type HopResult = { status: number; location: string | null; headers: Record<string, string> } | { error: string };
export type Hop = (url: string) => Promise<HopResult>;

export type Level = 'pass' | 'warn' | 'fail' | 'info';
export type Check = { id: string; label: string; level: Level; detail: string; fix?: string; prompt?: string };
export type Step = { url: string; status: number };
export type Chain = { start: string; steps: Step[]; end: string | null; status: number | null; problem: Problem | null; headers: Record<string, string> };
type Problem = 'cert' | 'unreachable' | 'timeout' | 'loop' | 'blocked' | 'error' | 'forbidden';

type HostId = 'vercel' | 'netlify' | 'cloudflare' | 'github' | 'railway' | 'render' | 'fly' | 'firebase' | 'lovable' | 'wix' | 'squarespace' | 'parking';
type Records = { A: string[]; AAAA: string[]; CNAME: string[]; MX: string[]; TXT: string[]; NS: string[] };

const MAX_HOPS = 6;

// Addresses and names that give a host away. Checked against IPs, CNAME targets and response headers.
const IP_HOSTS: [RegExp, HostId][] = [
  [/^76\.76\.21\.\d+$/, 'vercel'],
  [/^216\.198\.79\.\d+$/, 'vercel'],
  [/^216\.150\.(1|16)\.\d+$/, 'vercel'],
  [/^64\.29\.17\.\d+$/, 'vercel'],
  [/^66\.33\.60\.\d+$/, 'vercel'],
  [/^75\.2\.60\.5$/, 'netlify'],
  [/^99\.83\.231\.61$/, 'netlify'],
  [/^185\.199\.(108|109|110|111)\.153$/, 'github'],
  [/^2606:50c0:800[0-3]::153$/i, 'github'],
  [/^216\.24\.57\.\d+$/, 'render'],
  [/^185\.158\.133\.1$/, 'lovable'],
  [/^199\.36\.158\.100$/, 'firebase'],
  [/^185\.230\.6[0-3]\.\d+$/, 'wix'],
  [/^198\.(185\.159|49\.23)\.14[45]$/, 'squarespace'],
  // Parking and forwarding pages from domain companies (GoDaddy, Namecheap).
  [/^(34\.102\.136\.180|3\.33\.130\.190|15\.197\.148\.33|3\.33\.152\.147|15\.197\.142\.173)$/, 'parking'],
  [/^(162\.255\.119\.\d+|198\.54\.117\.\d+)$/, 'parking'],
  // Cloudflare's proxy (orange cloud). Whatever runs behind it is found from the response headers.
  [/^104\.(1[6-9]|2[0-7])\.\d+\.\d+$/, 'cloudflare'],
  [/^172\.(6[4-9]|7[01])\.\d+\.\d+$/, 'cloudflare'],
  [/^188\.114\.(9[6-9]|10[0-9]|11[01])\.\d+$/, 'cloudflare'],
  [/^162\.15[89]\.\d+\.\d+$/, 'cloudflare'],
  [/^(2606:4700|2a06:98c1|2803:f800|2405:b500|2405:8100|2c0f:f248):/i, 'cloudflare'],
];

const CNAME_HOSTS: [RegExp, HostId][] = [
  [/(vercel-dns(-\d+)?\.com|\.vercel\.app)\.?$/i, 'vercel'],
  [/\.netlify\.(app|com)\.?$/i, 'netlify'],
  [/\.(pages|workers)\.dev\.?$/i, 'cloudflare'],
  [/\.github\.io\.?$/i, 'github'],
  [/\.railway\.app\.?$/i, 'railway'],
  [/\.onrender\.com\.?$/i, 'render'],
  [/\.fly\.dev\.?$/i, 'fly'],
  [/\.(web\.app|firebaseapp\.com)\.?$/i, 'firebase'],
  [/\.lovable\.app\.?$/i, 'lovable'],
  [/\.wixdns\.net\.?$/i, 'wix'],
  [/squarespace\.com\.?$/i, 'squarespace'],
];

const HEADER_HOSTS: [string, RegExp, HostId][] = [
  ['x-vercel-id', /./, 'vercel'],
  ['server', /^vercel/i, 'vercel'],
  ['x-nf-request-id', /./, 'netlify'],
  ['server', /^netlify/i, 'netlify'],
  ['server', /^github\.com/i, 'github'],
  ['x-github-request-id', /./, 'github'],
  ['fly-request-id', /./, 'fly'],
  ['server', /^fly\//i, 'fly'],
  ['rndr-id', /./, 'render'],
  ['x-render-origin-server', /./, 'render'],
  ['x-railway-edge', /./, 'railway'],
  ['x-railway-request-id', /./, 'railway'],
  ['server', /railway/i, 'railway'],
  ['server', /^pepyaka|^wix/i, 'wix'],
  ['server', /^squarespace/i, 'squarespace'],
];

// Header names worth reading from each hop (the rest are dropped).
export const HOST_HEADERS = ['server', 'x-vercel-id', 'x-vercel-error', 'x-nf-request-id', 'x-github-request-id', 'fly-request-id', 'rndr-id', 'x-render-origin-server', 'x-railway-edge', 'x-railway-request-id', 'cf-ray'];

const DNS_COMPANIES: [RegExp, string][] = [
  [/\.ns\.cloudflare\.com\.?$/i, 'Cloudflare'],
  [/vercel-dns\.com\.?$/i, 'Vercel'],
  [/nsone\.net\.?$/i, 'Netlify (NS1)'],
  [/domaincontrol\.com\.?$/i, 'GoDaddy'],
  [/registrar-servers\.com\.?$/i, 'Namecheap'],
  [/googledomains\.com\.?$/i, 'Google Cloud DNS or Squarespace Domains'],
  [/squarespacedns\.com\.?$/i, 'Squarespace Domains'],
  [/awsdns/i, 'Amazon Route 53'],
  [/dns-parking\.com\.?$/i, 'Hostinger'],
  [/hostinger/i, 'Hostinger'],
  [/porkbun\.com\.?$/i, 'Porkbun'],
  [/name\.com\.?$/i, 'Name.com'],
  [/wixdns\.net\.?$/i, 'Wix'],
  [/ui-dns\./i, 'IONOS'],
  [/gandi\.net\.?$/i, 'Gandi'],
  [/digitalocean\.com\.?$/i, 'DigitalOcean'],
  [/azure-dns/i, 'Azure DNS'],
  [/hover\.com\.?$/i, 'Hover'],
  [/dynadot\.com\.?$/i, 'Dynadot'],
  [/spaceship\.net\.?$/i, 'Spaceship'],
];

type HostInfo = { name: string; where: string; apex: string; www: string; redirect: string; https: string };

// Plain-words fixes per host. {d} is the domain being checked.
const HOSTS: Record<Exclude<HostId, 'parking'>, HostInfo> = {
  vercel: {
    name: 'Vercel',
    where: 'In Vercel, open your project and go to Settings → Domains',
    apex: 'an A record for @ pointing to 76.76.21.21 (or the value Vercel shows next to the domain)',
    www: 'a CNAME record for www pointing to cname.vercel-dns.com (or the value Vercel shows next to the domain)',
    redirect: 'In Vercel, go to Settings → Domains, edit the one you don’t want and set it to redirect to the other',
    https: 'Vercel makes the https certificate by itself once the domain is added there and DNS points to Vercel. Check the domain shows “Valid Configuration” in Settings → Domains',
  },
  netlify: {
    name: 'Netlify',
    where: 'In Netlify, open your site and go to Domain management → Add a domain',
    apex: 'an A record for @ pointing to 75.2.60.5',
    www: 'a CNAME record for www pointing to your-site.netlify.app',
    redirect: 'In Netlify, go to Domain management and set your primary domain. Netlify then redirects the other one by itself',
    https: 'In Netlify, go to Domain management → HTTPS and click “Verify DNS configuration”, then “Provision certificate”',
  },
  cloudflare: {
    name: 'Cloudflare',
    where: 'In Cloudflare, open Workers & Pages, pick your project and go to Custom domains → Set up a custom domain',
    apex: 'the record Cloudflare adds for you when you add the domain under Custom domains',
    www: 'the record Cloudflare adds for you when you add www under Custom domains',
    redirect: 'In Cloudflare, go to Rules → Redirect Rules and use the “Redirect from WWW to root” template (or the other way round)',
    https: 'In Cloudflare, go to SSL/TLS and set the mode to “Full (strict)”, then check the domain shows “Active” under Custom domains',
  },
  github: {
    name: 'GitHub Pages',
    where: 'In GitHub, open the repository and go to Settings → Pages → Custom domain',
    apex: 'four A records for @: 185.199.108.153, 185.199.109.153, 185.199.110.153 and 185.199.111.153',
    www: 'a CNAME record for www pointing to yourname.github.io',
    redirect: 'Set both records. GitHub Pages then redirects www and the bare domain to the one you entered under Custom domain',
    https: 'In GitHub, go to Settings → Pages and tick “Enforce HTTPS”. If it’s greyed out, wait up to an hour after DNS is right',
  },
  railway: {
    name: 'Railway',
    where: 'In Railway, open your service and go to Settings → Networking → Custom Domain',
    apex: 'the CNAME target Railway shows. A bare domain can’t take a CNAME at most DNS companies, so use one that offers CNAME flattening, like Cloudflare',
    www: 'a CNAME record for www pointing to the target Railway shows',
    redirect: 'Add both domains in Railway, or add a redirect rule at your DNS company',
    https: 'Railway makes the certificate once its domain page shows the DNS record as found. Check Settings → Networking',
  },
  render: {
    name: 'Render',
    where: 'In Render, open your service and go to Settings → Custom Domains',
    apex: 'an A record for @ pointing to 216.24.57.1',
    www: 'a CNAME record for www pointing to your-service.onrender.com',
    redirect: 'Add the bare domain in Render. It adds www and redirects it for you',
    https: 'In Render, click “Verify” next to the domain under Settings → Custom Domains. The certificate follows within minutes',
  },
  fly: {
    name: 'Fly.io',
    where: 'In your terminal, run fly certs add {d}',
    apex: 'A and AAAA records with the addresses from fly ips list',
    www: 'a CNAME record for www pointing to your-app.fly.dev',
    redirect: 'Add a redirect in your app’s code, or a redirect rule at your DNS company',
    https: 'Run fly certs show {d} and add any record it asks for',
  },
  firebase: {
    name: 'Firebase Hosting',
    where: 'In Firebase, open Hosting and click “Add custom domain”',
    apex: 'the A record Firebase shows when you add the domain',
    www: 'the record Firebase shows when you add www',
    redirect: 'In Firebase, add www as a custom domain and choose “Redirect to an existing website”',
    https: 'Firebase makes the certificate after it sees the records. Check the domain status in Hosting',
  },
  lovable: {
    name: 'Lovable',
    where: 'In Lovable, open your project and go to Settings → Domains → Connect domain',
    apex: 'an A record for @ pointing to 185.158.133.1',
    www: 'an A record for www pointing to 185.158.133.1',
    redirect: 'In Lovable, connect both and set one as the primary domain',
    https: 'Lovable makes the certificate once the domain shows as active in Settings → Domains',
  },
  wix: {
    name: 'Wix',
    where: 'In Wix, go to Settings → Domains → Connect a domain',
    apex: 'the A record Wix shows',
    www: 'the CNAME record Wix shows',
    redirect: 'Wix redirects www by itself once the domain is connected',
    https: 'Wix turns on https by itself after the domain connects',
  },
  squarespace: {
    name: 'Squarespace',
    where: 'In Squarespace, go to Settings → Domains → Use a domain I own',
    apex: 'the four A records Squarespace shows',
    www: 'a CNAME record for www pointing to ext-sq.squarespace.com',
    redirect: 'Squarespace redirects www by itself once the domain is connected',
    https: 'Squarespace turns on https by itself after the domain connects',
  },
};

const nameOf = (h: HostId) => (h === 'parking' ? 'a parking page' : HOSTS[h].name);

const GENERIC: HostInfo = {
  name: 'your host',
  where: 'At your hosting company (Vercel, Netlify, Cloudflare and so on), add {d} as a custom domain',
  apex: 'the A record your host shows when you add the domain',
  www: 'the CNAME record your host shows when you add www',
  redirect: 'At your host, set one address as the main one and redirect the other to it',
  https: 'Your host makes the https certificate once the domain is added there and DNS points to it. Check its domain settings page',
};

// Domain endings that take two labels, so "shop.co.uk" counts as a bare domain.
const TWO_PART = /\.(co|com|org|net|ac|gov|edu|ltd|plc|me|or|ne|gen|firm|ind)\.[a-z]{2}$/i;

export function parseDomain(host: string): { name: string; base: string; www: string | null; zone: string } {
  const name = host.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  const labels = name.split('.');
  const apex = labels.length === 2 || (labels.length === 3 && TWO_PART.test(name));
  const zoneLabels = TWO_PART.test(name) ? 3 : 2;
  return { name, base: name, www: apex ? `www.${name}` : null, zone: labels.slice(-zoneLabels).join('.') };
}

export async function checkDomain(host: string, dns: Dns, hop: Hop) {
  const d = parseDomain(host);
  const [apexA, apexAAAA, mx, txt, ns, wwwA, wwwAAAA] = await Promise.all([
    dns(d.name, 'A'),
    dns(d.name, 'AAAA'),
    dns(d.name, 'MX'),
    dns(d.name, 'TXT'),
    dns(d.zone, 'NS'),
    d.www ? dns(d.www, 'A') : Promise.resolve(null),
    d.www ? dns(d.www, 'AAAA') : Promise.resolve(null),
  ]);

  const apex = records([apexA, apexAAAA, mx, txt]);
  apex.NS = pick(ns, 2);
  const www = d.www ? records([wwwA, wwwAAAA]) : null;
  const dnsInfo = { name: d.name, www: d.www, apex, wwwRecords: www };
  const dnsCompany = companyOf(apex.NS);

  // Nothing answered at all: the DNS lookup service itself is down.
  if (!apexA && !ns) {
    return { ...dnsInfo, dnsCompany, host: null, chains: [], checks: [{ id: 'dns', label: 'DNS lookup', level: 'warn' as Level, detail: 'We couldn’t look up DNS records right now. Try again in a minute.' }] };
  }

  const status = apexA?.status ?? 0;
  if (status === 3 && !apex.NS.length) return early(dnsInfo, dnsCompany, nxdomain(d.name));
  if (status === 2) return early(dnsInfo, dnsCompany, servfail(d.name));

  const chains = await Promise.all(
    [`https://${d.name}/`, d.www && `https://${d.www}/`, `http://${d.name}/`, d.www && `http://${d.www}/`]
      .filter((u): u is string => !!u)
      .map((u) => follow(u, hop)),
  );
  const [httpsApex, httpsWww, httpApex, httpWww] = d.www ? chains : [chains[0], null, chains[1], null];

  const apexHosts = hostsOf(apex);
  const wwwHosts = www ? hostsOf(www) : [];
  const headerHost = chains.map((c) => fromHeaders(c.headers)).find(Boolean) ?? null;
  const main = mainHost(apexHosts, headerHost) ?? mainHost(wwwHosts, headerHost);
  const info = main && main !== 'parking' ? HOSTS[main] : GENERIC;
  const behindProxy = (apexHosts.includes('cloudflare') || wwwHosts.includes('cloudflare')) && !!headerHost && headerHost !== 'cloudflare';

  const ctx: Ctx = { d, info, hostName: main && main !== 'parking' ? nameOf(main) : null, dnsCompany };
  const checks: Check[] = [];
  checks.push(companyCheck(ctx, apex.NS));
  checks.push(recordsCheck(ctx, d.name, apex, apexHosts, 'apex'));
  if (d.www && www) checks.push(recordsCheck(ctx, d.www, www, wwwHosts, 'www'));
  if (d.www && www) {
    const same = sameHostCheck(ctx, apexHosts, wwwHosts);
    if (same) checks.push(same);
  }
  checks.push(httpsCheck(ctx, d.name, httpsApex, apex));
  if (d.www && httpsWww && www) checks.push(httpsCheck(ctx, d.www, httpsWww, www));
  checks.push(httpCheck(ctx, [httpApex, httpWww].filter((c): c is Chain => !!c)));
  if (d.www && httpsWww) checks.push(oneAddressCheck(ctx, httpsApex, httpsWww));
  checks.push(emailCheck(ctx, apex));

  const hostLabel = ctx.hostName ? (behindProxy ? `${ctx.hostName}, behind Cloudflare’s proxy` : ctx.hostName) : null;
  return { ...dnsInfo, dnsCompany, host: hostLabel, chains, checks };
}

type Ctx = { d: ReturnType<typeof parseDomain>; info: HostInfo; hostName: string | null; dnsCompany: string | null };

function early(dnsInfo: object, dnsCompany: string | null, check: Check) {
  return { ...dnsInfo, dnsCompany, host: null, chains: [], checks: [check] };
}

function nxdomain(name: string): Check {
  return {
    id: 'exists',
    label: 'The domain exists',
    level: 'fail',
    detail: `DNS says ${name} doesn’t exist. It may not be registered yet, it may have expired, or the spelling may be off.`,
    fix: `Log in to the company you bought ${name} from and check it’s active and paid. If you bought it in the last hour, wait a little and check again.`,
    prompt: `My domain ${name} doesn’t exist in DNS (the lookup says NXDOMAIN). Tell me, step by step and in plain words, how to check whether it’s registered and active at my domain company, and what to do next.`,
  };
}

function servfail(name: string): Check {
  return {
    id: 'exists',
    label: 'DNS answers',
    level: 'fail',
    detail: `DNS lookups for ${name} fail. This usually means DNSSEC is on at your domain company, but the records it expects don’t match your current DNS (common after moving DNS to Cloudflare or Vercel).`,
    fix: `At the company you bought ${name} from, turn DNSSEC off (or update its DS record to the one your new DNS company shows). It can take a few hours to clear.`,
    prompt: `DNS lookups for my domain ${name} fail with SERVFAIL, which usually means a stale DNSSEC record. Tell me step by step, in plain words, how to turn DNSSEC off or fix the DS record at my domain company.`,
  };
}

function records(results: DnsResult[]): Records {
  const r: Records = { A: [], AAAA: [], CNAME: [], MX: [], TXT: [], NS: [] };
  for (const res of results) {
    for (const a of res?.answers ?? []) {
      const data = a.data.trim();
      const list = a.type === 1 ? r.A : a.type === 28 ? r.AAAA : a.type === 5 ? r.CNAME : a.type === 15 ? r.MX : a.type === 16 ? r.TXT : null;
      if (!list) continue;
      const v = a.type === 16 ? txtValue(data) : a.type === 5 || a.type === 15 ? data.replace(/\.$/, '') : data;
      if (!list.includes(v)) list.push(v);
    }
  }
  return r;
}

function pick(res: DnsResult, type: number): string[] {
  return [...new Set((res?.answers ?? []).filter((a) => a.type === type).map((a) => a.data.trim().replace(/\.$/, '')))];
}

// TXT data comes back quoted, and long values arrive split into several quoted parts.
function txtValue(s: string): string {
  const parts = s.match(/"((?:[^"\\]|\\.)*)"/g);
  return parts ? parts.map((p) => p.slice(1, -1).replace(/\\"/g, '"')).join('') : s;
}

function companyOf(ns: string[]): string | null {
  for (const n of ns) for (const [re, name] of DNS_COMPANIES) if (re.test(n)) return name;
  return null;
}

function hostOfIp(ip: string): HostId | null {
  for (const [re, id] of IP_HOSTS) if (re.test(ip)) return id;
  return null;
}

// One entry per record: the host it points to, or null when we don't recognise it.
function hostsOf(r: Records): (HostId | null)[] {
  if (r.CNAME.length) {
    const target = r.CNAME[r.CNAME.length - 1];
    for (const [re, id] of CNAME_HOSTS) if (re.test(r.CNAME.join(' ')) || re.test(target)) return [id];
  }
  return [...r.A, ...r.AAAA].map(hostOfIp);
}

function fromHeaders(h: Record<string, string>): HostId | null {
  for (const [key, re, id] of HEADER_HOSTS) if (h[key] && re.test(h[key])) return id;
  if (h['server'] && /^cloudflare/i.test(h['server'])) return 'cloudflare';
  return null;
}

function mainHost(hosts: (HostId | null)[], header: HostId | null): HostId | null {
  const known = hosts.filter((h): h is HostId => !!h);
  if (!known.length) return header;
  // Cloudflare's proxy hides the real host; the response headers tell us what's behind it.
  if (known.every((h) => h === 'cloudflare') && header && header !== 'cloudflare') return header;
  const real = known.find((h) => h !== 'parking' && h !== 'cloudflare');
  return real ?? known[0];
}

const fill = (s: string, d: string) => s.replace(/\{d\}/g, d);
const at = (c: Ctx) => (c.dnsCompany ? `at ${c.dnsCompany} (where your DNS is managed)` : 'at the company that manages your DNS');

function agent(c: Ctx, problem: string, ask: string): string {
  const host = c.hostName ? `My site is hosted on ${c.hostName}` : 'My site’s host isn’t clear (tell me how to check)';
  const dns = c.dnsCompany ? `and my DNS is managed at ${c.dnsCompany}` : 'and I’m not sure where my DNS is managed';
  return `${host}, ${dns}. A check of ${c.d.name} found this problem: ${problem}\n\n${ask} Walk me through it one step at a time, in plain words, with exactly what to click and what to type. If something needs a change in my project’s code or config, make that change.`;
}

function companyCheck(c: Ctx, ns: string[]): Check {
  return {
    id: 'dns-company',
    label: 'Where your DNS is managed',
    level: 'info',
    detail: c.dnsCompany
      ? `${c.dnsCompany} runs DNS for ${c.d.zone} (${ns.slice(0, 2).join(', ')}). That’s where you add or change records.`
      : ns.length
        ? `Your nameservers are ${ns.slice(0, 2).join(', ')}. Records are added or changed at the company that runs them.`
        : `We couldn’t find the nameservers for ${c.d.zone}.`,
  };
}

function recordsCheck(c: Ctx, name: string, r: Records, hosts: (HostId | null)[], kind: 'apex' | 'www'): Check {
  const label = `${name} points to your site`;
  const want = fill(kind === 'apex' ? c.info.apex : c.info.www, c.d.name);
  const record = kind === 'apex' ? '@' : 'www';
  const shown = [...r.CNAME.map((v) => `CNAME ${v}`), ...r.A.map((v) => `A ${v}`), ...r.AAAA.map((v) => `AAAA ${v}`)];
  const where = fill(c.info.where, c.d.name);

  if (!shown.length) {
    return {
      id: `records-${kind}`,
      label,
      level: 'fail',
      detail: `${name} has no A, AAAA or CNAME record, so browsers can’t find it${kind === 'www' ? '. People who type www will get an error' : ''}.`,
      fix: `${where}, then ${at(c)} add ${want}.`,
      prompt: agent(c, `${name} has no DNS record pointing anywhere.`, `Tell me which DNS record to add for ${name} so it opens my site.`),
    };
  }
  if (hosts.includes('parking')) {
    const parked = [...r.A, ...r.AAAA].filter((ip) => hostOfIp(ip) === 'parking');
    const real = hosts.some((h) => h && h !== 'parking');
    return {
      id: `records-${kind}`,
      label,
      level: 'fail',
      detail: real
        ? `${name} still has a parking record from your domain company (${parked.join(', ')}) next to the right one, so some visitors land on a parking page.`
        : `${name} points to a parking or forwarding page from your domain company (${parked.join(', ')}), not to your site.`,
      fix: `${at(c)[0].toUpperCase()}${at(c).slice(1)}, delete the record${parked.length > 1 ? 's' : ''} for ${parked.join(', ')}${real ? '' : `, then add ${want}`}. Also turn off any “domain forwarding” there.`,
      prompt: agent(c, `${name} points to my domain company’s parking page (${parked.join(', ')}).`, `Tell me which records to delete and which to add for ${name}.`),
    };
  }
  const known = hosts.filter((h): h is HostId => !!h && h !== 'cloudflare');
  const unknown = hosts.filter((h) => !h).length;
  if (new Set(known).size > 1 || (known.length && unknown)) {
    const names = [...new Set(known)].map((h) => nameOf(h));
    return {
      id: `records-${kind}`,
      label,
      level: 'fail',
      detail: `${name} has records for more than one place (${shown.join(', ')}${names.length ? `; we recognise ${names.join(' and ')}` : ''}). Browsers pick one at random, so the site works only some of the time.`,
      fix: `${at(c)[0].toUpperCase()}${at(c).slice(1)}, keep only ${want}, and delete the others.`,
      prompt: agent(c, `${name} has DNS records pointing to more than one place: ${shown.join(', ')}.`, `Tell me which of these records to keep and which to delete.`),
    };
  }
  const via = hosts[0] === 'cloudflare' && hosts.every((h) => h === 'cloudflare') ? 'Cloudflare’s proxy' : known[0] ? nameOf(known[0]) : null;
  return {
    id: `records-${kind}`,
    label,
    level: 'pass',
    detail: `${shown.slice(0, 4).join(', ')}${shown.length > 4 ? ` and ${shown.length - 4} more` : ''}${via ? `, which is ${via}` : ''}.`,
  };
}

function sameHostCheck(c: Ctx, apex: (HostId | null)[], www: (HostId | null)[]): Check | null {
  const a = apex.find((h) => h && h !== 'cloudflare' && h !== 'parking');
  const w = www.find((h) => h && h !== 'cloudflare' && h !== 'parking');
  if (!a || !w || a === w) return null;
  return {
    id: 'same-host',
    label: 'Both addresses go to the same host',
    level: 'warn',
    detail: `${c.d.name} points to ${nameOf(a)} but ${c.d.www} points to ${nameOf(w)}, so they may show different sites.`,
    fix: `Point both to the host your site is on now, and delete the old records ${at(c)}.`,
    prompt: agent(c, `${c.d.name} points to ${nameOf(a)} but ${c.d.www} points to ${nameOf(w)}.`, `Tell me how to point both to the same host.`),
  };
}

// Follows one address hop by hop (manual redirects), so every hop gets the address checks.
export async function follow(start: string, hop: Hop): Promise<Chain> {
  const steps: Step[] = [];
  let url = start;
  let headers: Record<string, string> = {};
  const seen = new Set<string>();
  for (let i = 0; i <= MAX_HOPS; i++) {
    if (seen.has(url)) return { start, steps, end: null, status: null, problem: 'loop', headers };
    seen.add(url);
    const r = await hop(url);
    if ('error' in r) return { start, steps, end: null, status: null, problem: kindOf(r.error), headers };
    steps.push({ url, status: r.status });
    headers = r.headers;
    if (r.status >= 300 && r.status < 400 && r.location) {
      try {
        url = new URL(r.location, url).href;
      } catch {
        return { start, steps, end: null, status: r.status, problem: 'error', headers };
      }
      continue;
    }
    const problem: Problem | null = r.status === 525 || r.status === 526 ? 'cert' : r.status === 521 || r.status === 522 || r.status === 523 ? 'unreachable' : r.status === 401 || r.status === 403 || r.status === 429 ? 'forbidden' : r.status >= 400 ? 'error' : null;
    return { start, steps, end: url, status: r.status, problem, headers };
  }
  return { start, steps, end: null, status: null, problem: 'loop', headers };
}

function kindOf(err: string): Problem {
  if (/blocked/i.test(err)) return 'blocked';
  if (/timed? ?out|timeout|abort/i.test(err)) return 'timeout';
  if (/ssl|tls|certificate|cert|handshake/i.test(err)) return 'cert';
  return 'unreachable';
}

const short = (u: string | null) => (u ? u.replace(/\/$/, '') : '');

function httpsCheck(c: Ctx, name: string, ch: Chain, r: Records): Check {
  const label = `https://${name} opens`;
  const hasRecords = r.A.length + r.AAAA.length + r.CNAME.length > 0;
  const where = fill(c.info.where, c.d.name);
  const httpsFix = fill(c.info.https, c.d.name);
  if (!ch.problem) {
    const moved = ch.steps.length > 1 ? `, ending at ${short(ch.end)}` : '';
    return { id: `https-${name}`, label, level: 'pass', detail: `It opens over https with status ${ch.status}${moved}.` };
  }
  if (ch.problem === 'forbidden') {
    return { id: `https-${name}`, label, level: 'pass', detail: `It answers over https (status ${ch.status}). The site blocks automated checks, so open it in your browser to be sure it shows your site.` };
  }
  if (!hasRecords) {
    return { id: `https-${name}`, label, level: 'info', detail: `It can’t open, because ${name} has no DNS record yet (see above).` };
  }
  if (ch.problem === 'cert') {
    return {
      id: `https-${name}`,
      label,
      level: 'fail',
      detail: `The https certificate for ${name} is missing or wrong${ch.status ? ` (status ${ch.status})` : ''}, so browsers show a security warning.`,
      fix: `${httpsFix}.${c.hostName === 'Cloudflare' || r.A.some((ip) => hostOfIp(ip) === 'cloudflare') ? '' : ' If you only just changed DNS, wait up to an hour and check again.'}`,
      prompt: agent(c, `https://${name} has a missing or wrong https certificate.`, `Tell me how to get a valid https certificate for ${name}.`),
    };
  }
  if (ch.problem === 'blocked') {
    return { id: `https-${name}`, label, level: 'warn', detail: `It redirects to an address we can’t check (${short(ch.steps[ch.steps.length - 1]?.url ?? null) || name}).` };
  }
  if (ch.problem === 'loop') {
    return {
      id: `https-${name}`,
      label,
      level: 'fail',
      detail: `It redirects in a loop or too many times (${ch.steps.map((s) => s.status).join(' → ')}), so browsers give up with “too many redirects”.`,
      fix: c.dnsCompany === 'Cloudflare' || r.A.some((ip) => hostOfIp(ip) === 'cloudflare')
        ? 'In Cloudflare, go to SSL/TLS and change the mode from “Flexible” to “Full (strict)”. That’s the usual cause when Cloudflare sits in front of another host.'
        : `${fill(c.info.redirect, c.d.name)}, and make sure the two addresses don’t redirect to each other.`,
      prompt: agent(c, `https://${name} redirects in a loop: ${ch.steps.map((s) => `${s.url} (${s.status})`).join(' → ')}.`, `Tell me what causes this redirect loop and how to fix it.`),
    };
  }
  if (ch.problem === 'error' && ch.status) {
    const vercelMissing = ch.headers['x-vercel-error'] && /DEPLOYMENT_NOT_FOUND|NOT_FOUND/.test(ch.headers['x-vercel-error']);
    const notAdded = ch.status === 404 || ch.status === 421 || vercelMissing;
    return {
      id: `https-${name}`,
      label,
      level: 'fail',
      detail: notAdded
        ? `It reaches ${c.hostName ?? 'a server'}, but gets error ${ch.status}. Usually the domain points to the right host, but the host doesn’t know which site to show for ${name}.`
        : `It reaches ${c.hostName ?? 'a server'}, but gets error ${ch.status}${ch.status >= 500 ? ', so the site itself is failing' : ''}.`,
      fix: notAdded
        ? `${where}, and add ${name} as a domain${c.hostName ? '' : ' of your site'}.`
        : ch.status >= 500
          ? `Open your host’s logs for the latest deploy and look for the error. Redeploying the last working version gets the site back while you fix it.`
          : `Check that ${name} is added to the right project at your host.`,
      prompt: agent(c, `https://${name} answers with error ${ch.status}.`, notAdded ? `Tell me how to add ${name} to my project at my host.` : `Help me find why the site answers with error ${ch.status} and fix it.`),
    };
  }
  return {
    id: `https-${name}`,
    label,
    level: 'fail',
    detail: ch.problem === 'timeout' ? `${name} didn’t answer within a few seconds.` : `We couldn’t connect to ${name}${ch.status ? ` (status ${ch.status})` : ''}. The records point somewhere that isn’t answering.`,
    fix: `Check the records for ${name} ${at(c)} match what your host asks for: ${fill(name === c.d.www ? c.info.www : c.info.apex, c.d.name)}. If you just changed them, give it up to an hour.`,
    prompt: agent(c, `https://${name} doesn’t answer${ch.problem === 'timeout' ? ' (timeout)' : ''}.`, `Tell me how to check my DNS records and hosting so ${name} opens.`),
  };
}

function httpCheck(c: Ctx, chains: Chain[]): Check {
  const label = 'http:// goes to https://';
  const working = chains.filter((ch) => ch.steps.length);
  if (!working.length) return { id: 'http', label, level: 'info', detail: 'Plain http didn’t answer, so there was nothing to check. Most browsers try https first anyway.' };
  const stuck = working.filter((ch) => !(ch.end ?? ch.steps[ch.steps.length - 1].url).startsWith('https://') && !ch.steps.some((s) => s.url.startsWith('https://')));
  if (!stuck.length) {
    const first = working[0];
    return { id: 'http', label, level: 'pass', detail: `${short(first.start)} redirects to ${short(first.end ?? first.steps[first.steps.length - 1].url)}${first.steps[0] ? ` (${first.steps[0].status})` : ''}.` };
  }
  return {
    id: 'http',
    label,
    level: 'warn',
    detail: `${stuck.map((ch) => short(ch.start)).join(' and ')} open${stuck.length === 1 ? 's' : ''} without https, so visitors who type the address without https get a “Not secure” page.`,
    fix: c.hostName === 'Cloudflare' || c.dnsCompany === 'Cloudflare'
      ? 'In Cloudflare, go to SSL/TLS → Edge Certificates and turn on “Always Use HTTPS”.'
      : c.hostName === 'GitHub Pages'
        ? 'In GitHub, go to Settings → Pages and tick “Enforce HTTPS”.'
        : 'Turn on “force https” (sometimes called “always use https”) in your host’s domain settings.',
    prompt: agent(c, `http:// addresses for my site don’t redirect to https://.`, `Tell me how to make every http address redirect to https.`),
  };
}

function oneAddressCheck(c: Ctx, a: Chain, w: Chain): Check {
  const label = 'www and the bare domain agree';
  const okA = !!a.end && (!a.problem || a.problem === 'forbidden');
  const okW = !!w.end && (!w.problem || w.problem === 'forbidden');
  const redirect = fill(c.info.redirect, c.d.name);
  if (okA && okW) {
    const ha = new URL(a.end!).host;
    const hw = new URL(w.end!).host;
    if (ha === hw) {
      const from = a.steps.length > 1 ? c.d.name : c.d.www;
      return { id: 'one-address', label, level: 'pass', detail: `${from} redirects to ${ha}, so everyone ends up on one address.` };
    }
    return {
      id: 'one-address',
      label,
      level: 'warn',
      detail: `${c.d.name} and ${c.d.www} both open, but neither redirects to the other. Google may treat them as two sites, and logins or cookies can break between them.`,
      fix: `${redirect}.`,
      prompt: agent(c, `${c.d.name} and ${c.d.www} both open without redirecting to each other.`, `Tell me how to redirect one to the other with a permanent redirect.`),
    };
  }
  if (!okA && !okW) return { id: 'one-address', label, level: 'info', detail: 'Neither address opens yet, so fix those first (see above).' };
  const broken = okA ? c.d.www! : c.d.name;
  const good = okA ? c.d.name : c.d.www!;
  return {
    id: 'one-address',
    label,
    level: 'fail',
    detail: `${good} works but ${broken} doesn’t, so anyone who types ${broken} gets an error.`,
    fix: `${fill(c.info.where, c.d.name)}, add ${broken} too, and set it to redirect to ${good}. ${at(c)[0].toUpperCase()}${at(c).slice(1)}, add ${fill(broken === c.d.www ? c.info.www : c.info.apex, c.d.name)}.`,
    prompt: agent(c, `${good} works but ${broken} doesn’t open.`, `Tell me how to make ${broken} open and redirect to ${good}.`),
  };
}

const MAIL: [RegExp, string][] = [
  [/google\.com$|googlemail\.com$/i, 'Google Workspace'],
  [/outlook\.com$/i, 'Microsoft 365'],
  [/zoho\.(com|eu|in)$/i, 'Zoho Mail'],
  [/improvmx\.com$/i, 'ImprovMX (forwarding)'],
  [/forwardemail\.net$/i, 'Forward Email'],
  [/mx\.cloudflare\.net$/i, 'Cloudflare Email Routing'],
  [/protonmail\.ch$/i, 'Proton Mail'],
  [/messagingengine\.com$/i, 'Fastmail'],
  [/secureserver\.net$/i, 'GoDaddy email'],
  [/privateemail\.com$|registrar-servers\.com$/i, 'Namecheap email'],
  [/amazonaws\.com$/i, 'Amazon SES'],
  [/mailgun\.org$/i, 'Mailgun'],
  [/agentmail\.to$/i, 'AgentMail'],
];

function emailCheck(c: Ctx, r: Records): Check {
  const label = 'Email for this domain';
  const spf = r.TXT.find((t) => /^v=spf1/i.test(t));
  if (!r.MX.length) {
    return { id: 'email', label, level: 'info', detail: `No MX records, so email sent to @${c.d.name} won’t arrive. That’s fine if you don’t use email on this domain.` };
  }
  const servers = r.MX.map((m) => m.split(/\s+/).pop() ?? m);
  const provider = servers.map((s) => MAIL.find(([re]) => re.test(s))?.[1]).find(Boolean);
  return {
    id: 'email',
    label,
    level: 'info',
    detail: `Email goes to ${provider ?? servers.slice(0, 2).join(', ')}${spf ? ', and there’s an SPF record' : ', but there’s no SPF record, so email you send may land in spam'}.`,
  };
}
