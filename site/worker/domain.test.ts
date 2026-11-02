import { describe, expect, it } from 'vitest';
import { checkDomain, parseDomain, type Dns, type Hop, type HopResult } from './domain';

const TYPES: Record<string, number> = { A: 1, AAAA: 28, CNAME: 5, MX: 15, TXT: 16, NS: 2 };

// A fake DNS: zone maps "name TYPE" to values. CNAMEs are returned alongside A/AAAA, like real DoH.
function fakeDns(zone: Record<string, string[]>, status: Record<string, number> = {}): Dns {
  return async (name, type) => {
    const answers = [...(type === 'A' || type === 'AAAA' ? (zone[`${name} CNAME`] ?? []).map((data) => ({ name, type: 5, data })) : []), ...(zone[`${name} ${type}`] ?? []).map((data) => ({ name, type: TYPES[type], data }))];
    return { status: status[name] ?? (answers.length || zone[`${name} NS`] ? 0 : 0), answers };
  };
}

function fakeHop(map: Record<string, HopResult>): Hop {
  return async (url) => map[url] ?? { error: 'connection refused' };
}

const ok = (headers: Record<string, string> = {}): HopResult => ({ status: 200, location: null, headers });
const to = (location: string, status = 308): HopResult => ({ status, location, headers: {} });
const byId = (r: { checks: { id: string; level: string; fix?: string }[] }) => Object.fromEntries(r.checks.map((c) => [c.id, c]));

describe('parseDomain', () => {
  it('strips www and finds the zone', () => {
    expect(parseDomain('www.Example.com')).toMatchObject({ name: 'example.com', www: 'www.example.com', zone: 'example.com' });
    expect(parseDomain('shop.co.uk')).toMatchObject({ name: 'shop.co.uk', www: 'www.shop.co.uk', zone: 'shop.co.uk' });
    expect(parseDomain('app.example.com')).toMatchObject({ name: 'app.example.com', www: null, zone: 'example.com' });
  });
});

describe('checkDomain', () => {
  it('passes a healthy Vercel site and names the host and DNS company', async () => {
    const dns = fakeDns({
      'example.com A': ['76.76.21.21'],
      'example.com NS': ['ada.ns.cloudflare.com.', 'bob.ns.cloudflare.com.'],
      'example.com MX': ['1 smtp.google.com.'],
      'example.com TXT': ['"v=spf1 include:_spf.google.com ~all"'],
      'www.example.com CNAME': ['cname.vercel-dns.com.'],
      'www.example.com A': ['76.76.21.61'],
    });
    const hop = fakeHop({
      'https://example.com/': ok({ 'x-vercel-id': 'iad1::abc', server: 'Vercel' }),
      'https://www.example.com/': to('https://example.com/'),
      'http://example.com/': to('https://example.com/'),
      'http://www.example.com/': to('https://www.example.com/'),
    });
    const r = await checkDomain('www.example.com', dns, hop);
    expect(r.host).toBe('Vercel');
    expect(r.dnsCompany).toBe('Cloudflare');
    expect(r.checks.filter((c) => c.level === 'fail' || c.level === 'warn')).toEqual([]);
    expect(byId(r)['email'].detail).toContain('Google Workspace');
    expect(r.apex.TXT[0]).toBe('v=spf1 include:_spf.google.com ~all');
  });

  it('flags a leftover parking record next to the host record', async () => {
    const dns = fakeDns({ 'example.com A': ['76.76.21.21', '34.102.136.180'], 'example.com NS': ['ns1.domaincontrol.com.'], 'www.example.com CNAME': ['cname.vercel-dns.com.'] });
    const hop = fakeHop({ 'https://example.com/': ok(), 'https://www.example.com/': to('https://example.com/'), 'http://example.com/': to('https://example.com/') });
    const r = await checkDomain('example.com', dns, hop);
    const c = byId(r)['records-apex'];
    expect(c.level).toBe('fail');
    expect(c.fix).toContain('34.102.136.180');
    expect(c.fix).toContain('GoDaddy');
  });

  it('flags a missing www with a host-specific fix', async () => {
    const dns = fakeDns({ 'example.com A': ['75.2.60.5'], 'example.com NS': ['dns1.p01.nsone.net.'] });
    const hop = fakeHop({ 'https://example.com/': ok({ 'x-nf-request-id': '1' }), 'http://example.com/': to('https://example.com/', 301), 'https://www.example.com/': { error: 'DNS lookup failed' } });
    const r = await checkDomain('example.com', dns, hop);
    const c = byId(r);
    expect(r.host).toBe('Netlify');
    expect(c['records-www'].level).toBe('fail');
    expect(c['records-www'].fix).toContain('netlify.app');
    expect(c['one-address'].level).toBe('fail');
    expect(c['one-address'].fix).toContain('In Netlify');
  });

  it('stops early when the domain does not exist', async () => {
    const r = await checkDomain('nope-nope.com', fakeDns({}, { 'nope-nope.com': 3 }), fakeHop({}));
    expect(r.checks).toHaveLength(1);
    expect(r.checks[0]).toMatchObject({ id: 'exists', level: 'fail' });
  });

  it('explains a broken DNSSEC (SERVFAIL)', async () => {
    const r = await checkDomain('example.com', fakeDns({ 'example.com NS': ['a.ns.cloudflare.com'] }, { 'example.com': 2 }), fakeHop({}));
    expect(r.checks[0].detail).toContain('DNSSEC');
  });

  it('spots a Cloudflare Flexible redirect loop and the host behind the proxy', async () => {
    const dns = fakeDns({ 'example.com A': ['104.21.3.4', '172.67.1.2'], 'example.com NS': ['ada.ns.cloudflare.com'], 'www.example.com A': ['104.21.3.4'] });
    const loop: HopResult = { status: 308, location: 'https://example.com/', headers: { 'x-vercel-id': 'x', server: 'cloudflare' } };
    const hop = fakeHop({ 'https://example.com/': loop, 'https://www.example.com/': to('https://example.com/'), 'http://example.com/': to('https://example.com/', 301) });
    const r = await checkDomain('example.com', dns, hop);
    expect(r.host).toBe('Vercel, behind Cloudflare’s proxy');
    const c = byId(r)['https-example.com'];
    expect(c.level).toBe('fail');
    expect(c.fix).toContain('Full (strict)');
  });

  it('says to add the domain at the host when it answers 404', async () => {
    const dns = fakeDns({ 'example.com A': ['185.199.108.153'], 'www.example.com CNAME': ['me.github.io.'] });
    const notFound: HopResult = { status: 404, location: null, headers: { server: 'GitHub.com' } };
    const hop = fakeHop({ 'https://example.com/': notFound, 'https://www.example.com/': notFound, 'http://example.com/': notFound });
    const r = await checkDomain('example.com', dns, hop);
    expect(r.host).toBe('GitHub Pages');
    expect(byId(r)['https-example.com'].fix).toContain('Settings → Pages');
  });

  it('warns when http stays on http', async () => {
    const dns = fakeDns({ 'app.example.com CNAME': ['app.onrender.com.'], 'app.example.com A': ['216.24.57.4'] });
    const hop = fakeHop({ 'https://app.example.com/': ok(), 'http://app.example.com/': ok() });
    const r = await checkDomain('app.example.com', dns, hop);
    expect(r.www).toBeNull();
    expect(r.chains).toHaveLength(2);
    expect(byId(r)['http'].level).toBe('warn');
    expect(byId(r)['one-address']).toBeUndefined();
  });

  it('marks a redirect to a blocked address as not checkable', async () => {
    const dns = fakeDns({ 'example.com A': ['76.76.21.21'], 'www.example.com CNAME': ['cname.vercel-dns.com'] });
    const hop: Hop = async (u) => (u.includes('127.0.0.1') ? { error: 'blocked' } : u === 'https://example.com/' ? to('http://127.0.0.1/') : ok());
    const r = await checkDomain('example.com', dns, hop);
    expect(byId(r)['https-example.com'].level).toBe('warn');
  });
});
