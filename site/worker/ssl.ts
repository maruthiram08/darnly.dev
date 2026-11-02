// SSL checker: what certificate a domain has, from public Certificate Transparency logs, plus a live
// https request to confirm the site actually serves it. Used by /api/ssl for /tools/ssl-checker/.
//
// Everything that touches the network is passed in (ct, probe, dns), so this file stays pure and
// every fetch goes through the Worker's own guards in index.ts.

export type CtCert = {
  id: string;
  issuer: string; // a friendly name like "Let's Encrypt"
  issuerName: string; // the raw issuer, like "C=US, O=Let's Encrypt, CN=R11"
  notBefore: string; // ISO
  notAfter: string; // ISO
  names: string[];
};

export type SslProbe = { ok: boolean; status: number; finalUrl: string; error?: 'tls' | 'connect' | 'timeout' };
export type Dns = { a: string[]; cname: string[] };

export type Level = 'pass' | 'warn' | 'fail';
export type Issue = { id: string; level: Level; title: string; detail: string; fix?: string; prompt?: string };

export type SslResult = {
  host: string;
  www: string; // the other name visitors type: www.example.com for example.com, and the other way round
  checkedAt: string;
  status: 'secure' | 'expiring' | 'expired' | 'broken' | 'none' | 'unknown';
  live: { https: SslProbe | null; http: SslProbe | null; www: SslProbe | null; dns: boolean; wwwDns: boolean };
  current: (CtCert & { daysLeft: number; daysTotal: number; coversHost: boolean; coversWww: boolean }) | null;
  history: CtCert[];
  source: 'crt.sh' | 'certspotter' | null;
  hostedOn: string | null;
  issues: Issue[];
};

const DAY = 86_400_000;

// crt.sh's issuer_name ("C=US, O=Let's Encrypt, CN=R11") to the name people know.
export function friendlyIssuer(raw: string): string {
  const org = raw.match(/(?:^|,\s*)O="?([^,"]+)"?/)?.[1]?.trim() ?? raw.match(/CN=([^,]+)/)?.[1]?.trim() ?? raw;
  const known: [RegExp, string][] = [
    [/let'?s encrypt/i, 'Let’s Encrypt'],
    [/google trust/i, 'Google Trust Services'],
    [/cloudflare/i, 'Cloudflare'],
    [/amazon/i, 'Amazon'],
    [/digicert/i, 'DigiCert'],
    [/sectigo|comodo/i, 'Sectigo'],
    [/zerossl/i, 'ZeroSSL'],
    [/globalsign/i, 'GlobalSign'],
    [/godaddy|starfield/i, 'GoDaddy'],
    [/microsoft/i, 'Microsoft'],
    [/ssl\.com|ssl corp/i, 'SSL.com'],
    [/entrust/i, 'Entrust'],
    [/buypass/i, 'Buypass'],
  ];
  for (const [re, name] of known) if (re.test(org)) return name;
  return org.replace(/,?\s*(Inc\.?|LLC|Ltd\.?|Limited|S\.A\.|GmbH)$/i, '').trim();
}

// crt.sh JSON rows. Several rows can be the same certificate (one per log entry), so dedupe by serial.
export function parseCrtSh(text: string): CtCert[] {
  let rows: unknown;
  try {
    rows = JSON.parse(text);
  } catch {
    // A very big answer was cut at our read limit: keep the complete rows before the cut.
    const cut = text.lastIndexOf('},');
    if (cut < 0) return [];
    try {
      rows = JSON.parse(text.slice(0, cut + 1) + ']');
    } catch {
      return [];
    }
  }
  if (!Array.isArray(rows)) return [];
  const seen = new Map<string, CtCert>();
  for (const r of rows as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object') continue;
    const nb = isoDate(r.not_before);
    const na = isoDate(r.not_after);
    if (!nb || !na) continue;
    const issuerName = String(r.issuer_name ?? '');
    const key = `${r.serial_number ?? r.id}|${issuerName}`;
    const names = uniq(String(r.name_value ?? r.common_name ?? '').split(/\s+/));
    const prev = seen.get(key);
    if (prev) {
      prev.names = uniq([...prev.names, ...names]);
      continue;
    }
    seen.set(key, { id: String(r.id ?? ''), issuer: friendlyIssuer(issuerName), issuerName, notBefore: nb, notAfter: na, names });
  }
  return [...seen.values()];
}

// Cert Spotter (the fallback when crt.sh is down): /v1/issuances?expand=dns_names&expand=issuer
export function parseCertSpotter(text: string): CtCert[] {
  let rows: unknown;
  try {
    rows = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  return (rows as Record<string, unknown>[])
    .map((r) => {
      const issuer = (r.issuer ?? {}) as Record<string, unknown>;
      const issuerName = String(issuer.name ?? issuer.friendly_name ?? '');
      return {
        id: String(r.id ?? ''),
        issuer: typeof issuer.friendly_name === 'string' ? friendlyIssuer(`O=${issuer.friendly_name}`) : friendlyIssuer(issuerName),
        issuerName,
        notBefore: isoDate(r.not_before) ?? '',
        notAfter: isoDate(r.not_after) ?? '',
        names: uniq(Array.isArray(r.dns_names) ? (r.dns_names as unknown[]).map(String) : []),
      };
    })
    .filter((c) => c.notBefore && c.notAfter);
}

function isoDate(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  // crt.sh leaves off the time zone; its times are UTC.
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const uniq = (list: string[]) => [...new Set(list.map((n) => n.trim().toLowerCase()).filter(Boolean))];

// Does a certificate name cover this host? "*.example.com" covers "www.example.com" but not
// "example.com" or "a.b.example.com".
export function covers(names: string[], host: string): boolean {
  const h = host.toLowerCase();
  return names.some((n) => n === h || (n.startsWith('*.') && h.endsWith(n.slice(1)) && !h.slice(0, -n.length + 1).includes('.')));
}

// The other name visitors type: www.example.com <-> example.com.
export function otherName(host: string): string {
  return host.startsWith('www.') ? host.slice(4) : `www.${host}`;
}

// Which host a domain points to, from its DNS answers.
export function detectHost(d: Dns | null): string | null {
  if (!d) return null;
  const c = d.cname.join(' ').toLowerCase();
  const a = d.a;
  if (/vercel/.test(c) || a.some((ip) => ip === '76.76.21.21' || ip.startsWith('216.198.79.') || ip.startsWith('66.33.60.'))) return 'Vercel';
  if (/netlify/.test(c) || a.some((ip) => ip === '75.2.60.5' || ip === '99.83.231.61')) return 'Netlify';
  if (/github\.io/.test(c) || a.some((ip) => /^185\.199\.(108|109|110|111)\.153$/.test(ip))) return 'GitHub Pages';
  if (/pages\.dev|workers\.dev|cloudflare/.test(c) || a.some(isCloudflareIp)) return 'Cloudflare';
  if (/railway/.test(c)) return 'Railway';
  if (/onrender\.com/.test(c)) return 'Render';
  if (/fly\.dev/.test(c)) return 'Fly.io';
  if (/lovable/.test(c) || a.includes('185.158.133.1')) return 'Lovable';
  if (/firebaseapp|web\.app/.test(c) || a.includes('199.36.158.100')) return 'Firebase';
  if (/amplifyapp|cloudfront/.test(c)) return 'AWS';
  return null;
}

function isCloudflareIp(ip: string): boolean {
  return /^(104\.(1[6-9]|2[0-7])\.|172\.(6[4-9]|7[01])\.|188\.114\.(9[6-9]|1[01]\d)\.|162\.15[89]\.)/.test(ip);
}

const HOST_TIP: Record<string, string> = {
  Vercel: 'In Vercel, open your project, then Settings, then Domains. A domain with “Invalid configuration” or a spinning “Pending” there has no certificate yet. Fix the DNS record Vercel shows, and the certificate follows within a few minutes.',
  Netlify: 'In Netlify, open Domain management, then HTTPS, and click “Verify DNS configuration”, then “Provision certificate”.',
  'GitHub Pages': 'In your GitHub repo, open Settings, then Pages. Wait for the DNS check to pass, then tick “Enforce HTTPS”. It can take up to an hour.',
  Cloudflare: 'In Cloudflare, open SSL/TLS, then Edge Certificates, and check the certificate status. Set the SSL mode to “Full (strict)” if your host has its own certificate.',
  Lovable: 'In Lovable, open Project settings, then Domains, and check the domain shows as active. Remove and re-add it if it’s stuck.',
  Firebase: 'In the Firebase console, open Hosting and check the custom domain says “Connected”. Certificates can take up to 24 hours after DNS is right.',
  Railway: 'In Railway, open the service, then Settings, then Networking, and check the custom domain has a green tick.',
  Render: 'In Render, open the service, then Settings, then Custom Domains, and click “Verify” next to the domain.',
  'Fly.io': 'Run `fly certs show <your domain>` and follow what it says about DNS records.',
  AWS: 'In AWS Amplify or Certificate Manager, check the certificate status. “Pending validation” means a DNS record is still missing.',
};

export function analyze(input: {
  host: string;
  now: Date;
  certs: CtCert[];
  source: 'crt.sh' | 'certspotter' | null;
  https: SslProbe | null;
  http: SslProbe | null;
  www: SslProbe | null;
  dns: Dns | null;
  wwwDns: Dns | null;
}): SslResult {
  const { host, now, certs } = input;
  const www = otherName(host);
  const t = now.getTime();
  const hostedOn = detectHost(input.dns);
  const tip = hostedOn ? HOST_TIP[hostedOn] : undefined;
  const dnsOk = !!input.dns && (input.dns.a.length > 0 || input.dns.cname.length > 0);
  const wwwDnsOk = !!input.wwwDns && (input.wwwDns.a.length > 0 || input.wwwDns.cname.length > 0);

  const mine = certs
    .filter((c) => covers(c.names, host) || covers(c.names, www))
    .sort((a, b) => b.notBefore.localeCompare(a.notBefore));
  const valid = mine.filter((c) => covers(c.names, host) && Date.parse(c.notBefore) <= t && Date.parse(c.notAfter) > t);
  // The newest certificate is usually the one being served; prefer one that also covers www.
  const wwwToo = valid.find((c) => covers(c.names, www));
  const best = wwwToo && Date.parse(valid[0].notBefore) - Date.parse(wwwToo.notBefore) < 7 * DAY ? wwwToo : valid[0];
  const current = best
    ? {
        ...best,
        daysLeft: Math.floor((Date.parse(best.notAfter) - t) / DAY),
        daysTotal: Math.round((Date.parse(best.notAfter) - Date.parse(best.notBefore)) / DAY),
        coversHost: covers(best.names, host),
        coversWww: covers(best.names, www),
      }
    : null;
  const lastExpired = !current ? mine.find((c) => covers(c.names, host) && Date.parse(c.notAfter) <= t) : undefined;
  const wwwCert = mine.some((c) => covers(c.names, www) && Date.parse(c.notBefore) <= t && Date.parse(c.notAfter) > t);

  const https = input.https;
  const issues: Issue[] = [];
  const agent = (task: string) => `${task} Check how this project is hosted and tell me exactly which setting or DNS record I need to change myself, step by step.`;

  // 1. Does the site answer over https at all?
  let status: SslResult['status'];
  if (!https?.ok && !input.dns && https?.error !== 'tls') {
    // The DNS lookup itself failed, so we can't tell what's wrong.
    status = 'unknown';
    issues.push({
      id: 'https',
      level: 'fail',
      title: `We couldn’t reach ${host}`,
      detail: 'Neither the site nor its DNS answered us. Check the spelling, or try again in a minute.',
    });
  } else if (!dnsOk && !https?.ok) {
    status = 'none';
    issues.push({
      id: 'dns',
      level: 'fail',
      title: `${host} doesn’t point anywhere yet`,
      detail: 'There’s no DNS record for this name, so no browser can reach it, with or without https.',
      fix: 'Add the A or CNAME record your host gives you at your domain registrar. Certificates are only issued once DNS works.',
      prompt: agent(`My domain ${host} has no DNS record. Tell me which record to add at my registrar so it points to my host.`),
    });
  } else if (https?.ok) {
    status = current && current.daysLeft <= 7 ? 'expiring' : 'secure';
    issues.push({ id: 'https', level: 'pass', title: `${host} loads over https`, detail: 'We opened the site over a secure connection and the browser-trusted certificate checked out.' });
  } else if (https?.error === 'tls' || (https && https.status >= 525 && https.status <= 526)) {
    status = lastExpired && !current ? 'expired' : 'broken';
    issues.push({
      id: 'https',
      level: 'fail',
      title: status === 'expired' ? 'The certificate has expired' : 'The certificate isn’t trusted',
      detail:
        status === 'expired'
          ? `The last certificate for ${host} ran out ${ago(lastExpired!.notAfter, t)}. Browsers now show a full-page “Your connection is not private” warning.`
          : `The site answered, but its certificate doesn’t match ${host} or isn’t trusted. Visitors see a “Your connection is not private” warning.`,
      fix: tip ?? 'Ask your host to issue a certificate for this exact name. Most hosts do it for free once DNS points to them.',
      prompt: agent(`Visitors to https://${host} get a certificate warning. Find out why and how to get a valid free certificate for it.`),
    });
  } else {
    status = https ? (current ? 'broken' : 'none') : 'unknown';
    issues.push({
      id: 'https',
      level: 'fail',
      title: https?.error === 'timeout' ? `${host} took too long to answer over https` : `${host} doesn’t answer over https`,
      detail: current
        ? 'A certificate exists in the public logs, but the server didn’t accept a secure connection. The DNS may point somewhere else than the host that holds the certificate.'
        : 'We couldn’t open a secure connection, and the public logs have no current certificate for this name.',
      fix: tip ?? 'Point the domain at your host and turn on https there. Most hosts issue a free certificate automatically within minutes.',
      prompt: agent(`https://${host} doesn’t load. Find out why my custom domain has no working https and how to fix it.`),
    });
  }

  // 2. Expiry.
  if (current) {
    if (current.daysLeft <= 7) {
      issues.push({
        id: 'expiry',
        level: 'fail',
        title: current.daysLeft <= 0 ? 'The certificate runs out today' : `The certificate runs out in ${plural(current.daysLeft, 'day')}`,
        detail: `Free certificates usually renew about a third of the way before they end. With ${plural(current.daysLeft, 'day')} left, automatic renewal has probably failed.`,
        fix: tip ?? 'Check your host’s certificate page for a renewal error, which is usually a DNS record that changed.',
        prompt: agent(`The https certificate for ${host} expires in ${plural(current.daysLeft, 'day')} and hasn’t renewed. Find out why auto-renewal failed.`),
      });
    } else if (current.daysLeft <= Math.max(10, Math.round(current.daysTotal / 4))) {
      issues.push({
        id: 'expiry',
        level: 'warn',
        title: `The certificate runs out in ${plural(current.daysLeft, 'day')}`,
        detail: `It should have renewed by now (most hosts renew with a third of the time left). Check again in a few days. If the date doesn’t move, renewal is failing.`,
        fix: tip,
      });
    } else {
      issues.push({
        id: 'expiry',
        level: 'pass',
        title: `Good for ${plural(current.daysLeft, 'more day')}`,
        detail: `${current.issuer} certificates renew automatically, so you don’t need to do anything.`,
      });
    }
  }

  // 3. The other name (www or the bare domain).
  if (wwwDnsOk) {
    const w = input.www;
    if (w?.ok) {
      issues.push({ id: 'www', level: 'pass', title: `${www} works too`, detail: `${www} also loads over https${sameSite(w.finalUrl, host) ? ` and sends visitors to ${host}` : ''}.` });
    } else {
      issues.push({
        id: 'www',
        level: 'fail',
        title: `${www} has no working certificate`,
        detail: `${www} points somewhere, but https://${www} ${w?.error === 'tls' ? 'shows a certificate warning' : 'doesn’t load'}${wwwCert ? '' : ', and no certificate in the public logs covers it'}. People who type it get an error page.`,
        fix: hostedOn
          ? `Add ${www} as a second domain in ${hostedOn} and set it to redirect to ${host}. ${hostedOn} then issues its certificate.`
          : `Add ${www} as a domain at your host too, and redirect it to ${host}.`,
        prompt: agent(`https://${www} gives an error but https://${host} works. Add ${www} to my hosting so it gets a certificate and redirects to ${host}.`),
      });
    }
  } else if (input.wwwDns && https?.ok) {
    issues.push({
      id: 'www',
      level: 'warn',
      title: `${www} isn’t set up`,
      detail: `${www} has no DNS record, so anyone who types it gets “site can’t be reached”.`,
      fix: `Add a CNAME record for ${www.startsWith('www.') ? 'www' : 'the bare domain'} pointing to your host, then add it as a domain there with a redirect to ${host}.`,
      prompt: agent(`${www} doesn’t resolve. Set it up so it redirects to https://${host}.`),
    });
  }

  // 4. http -> https redirect.
  if (https?.ok && input.http) {
    const toHttps = input.http.ok && input.http.finalUrl.startsWith('https://');
    issues.push(
      toHttps
        ? { id: 'redirect', level: 'pass', title: 'http sends visitors to https', detail: `Typing http://${host} lands on the secure version.` }
        : {
            id: 'redirect',
            level: 'warn',
            title: 'http doesn’t send visitors to https',
            detail: `http://${host} ${input.http.ok ? 'stays on the insecure version' : 'doesn’t load'}, so old links and people typing the address without https miss out.`,
            fix: hostedOn === 'Cloudflare' ? 'In Cloudflare, open SSL/TLS, then Edge Certificates, and turn on “Always Use HTTPS”.' : 'Turn on “Force HTTPS” or “Redirect to HTTPS” at your host.',
            prompt: agent(`http://${host} doesn’t redirect to https. Make every http request redirect to https.`),
          },
    );
  }

  // 5. Nothing in the logs, or the logs didn't answer.
  if (!input.source) {
    issues.push({
      id: 'logs',
      level: 'warn',
      title: 'The certificate logs didn’t answer',
      detail: 'The public logs we read for the dates and history are slow or down right now. The live https check above still ran. Try again in a minute for the full picture.',
    });
  } else if (!certs.length) {
    issues.push({
      id: 'logs',
      level: https?.ok ? 'warn' : 'fail',
      title: 'No certificates in the public logs',
      detail: https?.ok
        ? 'The site works, so its certificate is probably issued for a parent wildcard or a different name. We just can’t show its dates.'
        : 'No certificate has ever been issued for this name. If you just added the domain, wait 10 minutes and check again.',
    });
  }

  return {
    host,
    www,
    checkedAt: now.toISOString(),
    status,
    live: { https, http: input.http, www: input.www, dns: dnsOk, wwwDns: wwwDnsOk },
    current,
    history: mine.slice(0, 12),
    source: input.source,
    hostedOn,
    issues,
  };
}

function sameSite(finalUrl: string, host: string): boolean {
  try {
    return new URL(finalUrl).hostname === host;
  } catch {
    return false;
  }
}

function ago(iso: string, now: number): string {
  const d = Math.max(0, Math.floor((now - Date.parse(iso)) / DAY));
  return d === 0 ? 'today' : `${plural(d, 'day')} ago`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
