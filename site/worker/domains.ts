// Is a domain name registered? Used by /api/domains for the domain name finder.
// Two signals, read in parallel:
//   RDAP: the registry's own record. Found = taken; 404 = no record, so probably free.
//   DNS:  a lookup through Cloudflare's resolver. Name servers = taken; "no such domain" = no DNS.
// RDAP decides when it answers; DNS settles the cases where RDAP is down or the TLD has no RDAP.

// Only these endings can be checked, so the Worker only ever talks to these registries.
export const TLDS = ['com', 'dev', 'app', 'io', 'ai', 'co', 'net', 'org', 'xyz', 'sh', 'so', 'me'] as const;

export type State = 'free' | 'taken' | 'maybe' | 'unknown';
export type Result = {
  name: string;
  state: State;
  // From the registry record, when the name is taken.
  registered?: string;
  expires?: string;
  registrar?: string;
};

export type RdapAnswer =
  | { kind: 'found'; registered?: string; expires?: string; registrar?: string }
  | { kind: 'none' }
  | { kind: 'error' };
export type DnsAnswer = 'exists' | 'nx' | 'error';

// a-z, 0-9 and inner hyphens, 1 to 63 letters, then one of the endings above.
export function cleanName(raw: string): string | null {
  const name = raw.trim().toLowerCase().replace(/\.$/, '');
  const m = name.match(/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.([a-z]+)$/);
  if (!m || !(TLDS as readonly string[]).includes(m[2])) return null;
  if (m[1].slice(2, 4) === '--' && !m[1].startsWith('xn--')) return null;
  return name;
}

// The IANA bootstrap file maps each ending to its registry's RDAP address.
export function parseBootstrap(text: string): Record<string, string> {
  const map: Record<string, string> = {};
  try {
    const data = JSON.parse(text) as { services?: [string[], string[]][] };
    for (const [tlds, urls] of data.services ?? []) {
      // Prefer https when a registry lists both.
      const base = urls.find((u) => u.startsWith('https://')) ?? urls[0];
      if (!base) continue;
      for (const t of tlds) map[t.toLowerCase()] = base.endsWith('/') ? base : `${base}/`;
    }
  } catch {
    /* an unreadable file means an empty map, and every lookup falls back */
  }
  return map;
}

// Dates and registrar from an RDAP domain record.
export function readRecord(data: unknown): Omit<Extract<RdapAnswer, { kind: 'found' }>, 'kind'> {
  const out: { registered?: string; expires?: string; registrar?: string } = {};
  if (!data || typeof data !== 'object') return out;
  const rec = data as { events?: { eventAction?: string; eventDate?: string }[]; entities?: unknown[] };
  for (const e of rec.events ?? []) {
    const day = typeof e?.eventDate === 'string' ? e.eventDate.slice(0, 10) : undefined;
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    if (e.eventAction === 'registration') out.registered = day;
    if (e.eventAction === 'expiration') out.expires = day;
  }
  for (const ent of rec.entities ?? []) {
    const en = ent as { roles?: string[]; vcardArray?: [string, [string, unknown, string, unknown][]] };
    if (!en?.roles?.includes('registrar')) continue;
    const fn = en.vcardArray?.[1]?.find((f) => f[0] === 'fn');
    if (fn && typeof fn[3] === 'string') out.registrar = fn[3].slice(0, 80);
  }
  return out;
}

// What a DNS-over-HTTPS answer says: NXDOMAIN (3) means no such name; a normal answer (0)
// means the registry points the name somewhere, so someone owns it. A failure (2) proves nothing.
export function readDns(data: unknown): DnsAnswer {
  const status = (data as { Status?: number } | null)?.Status;
  if (status === 3) return 'nx';
  if (status === 0) return 'exists';
  return 'error';
}

export function verdict(name: string, rdap: RdapAnswer, dns: DnsAnswer): Result {
  if (rdap.kind === 'found') {
    const { kind: _, ...rest } = rdap;
    return { name, state: 'taken', ...rest };
  }
  if (dns === 'exists') return { name, state: 'taken' };
  if (rdap.kind === 'none') return { name, state: 'free' };
  if (dns === 'nx') return { name, state: 'maybe' };
  return { name, state: 'unknown' };
}
