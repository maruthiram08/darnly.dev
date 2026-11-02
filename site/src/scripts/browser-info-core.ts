// Browser info: turns a user agent (plus Chrome's client hints, when there are any) into plain names.
// Pure functions, so they can be tested without a browser.

export type Hints = {
  brands?: { brand: string; version: string }[]; // fullVersionList, or brands as a fallback
  platform?: string;
  platformVersion?: string;
  mobile?: boolean;
  model?: string;
};

export type Parsed = {
  browser: string;
  version: string; // '' when unknown
  engine: string;
  os: string;
  osVersion: string; // '' when unknown
  device: 'Phone' | 'Tablet' | 'Desktop';
  model: string;
};

const BRAND_NAMES: [RegExp, string][] = [
  [/^Microsoft Edge$/i, 'Edge'],
  [/^Opera( GX)?$/i, 'Opera'],
  [/^Brave$/i, 'Brave'],
  [/^Vivaldi$/i, 'Vivaldi'],
  [/^Samsung Internet$/i, 'Samsung Internet'],
  [/^YaBrowser|Yandex$/i, 'Yandex Browser'],
  [/^Google Chrome$/i, 'Chrome'],
];

// User agent tokens, most specific first (Edge and Opera also say "Chrome", Chrome also says "Safari").
const UA_BROWSERS: [RegExp, string][] = [
  [/EdgiOS\/([\d.]+)/, 'Edge'],
  [/EdgA?\/([\d.]+)/, 'Edge'],
  [/OPR\/([\d.]+)/, 'Opera'],
  [/OPiOS\/([\d.]+)/, 'Opera'],
  [/SamsungBrowser\/([\d.]+)/, 'Samsung Internet'],
  [/YaBrowser\/([\d.]+)/, 'Yandex Browser'],
  [/Vivaldi\/([\d.]+)/, 'Vivaldi'],
  [/DuckDuckGo\/([\d.]+)/, 'DuckDuckGo'],
  [/FxiOS\/([\d.]+)/, 'Firefox'],
  [/Firefox\/([\d.]+)/, 'Firefox'],
  [/CriOS\/([\d.]+)/, 'Chrome'],
  [/Chrome\/([\d.]+)/, 'Chrome'],
  [/Version\/([\d.]+).*Safari\//, 'Safari'],
];

export function parse(ua: string, hints: Hints = {}, extra: { brave?: boolean; touchPoints?: number } = {}): Parsed {
  let browser = 'Unknown browser';
  let version = '';
  for (const [re, name] of UA_BROWSERS) {
    const m = ua.match(re);
    if (m) {
      browser = name;
      version = m[1];
      break;
    }
  }
  if (browser === 'Unknown browser' && /AppleWebKit/.test(ua) && /Mobile\//.test(ua)) browser = 'Safari (in an app)';

  // Chrome's client hints carry the exact version, and name Edge, Opera and others reliably.
  if (hints.brands?.length) {
    const real = hints.brands.filter((b) => !/Not.?A.?Brand|Chromium/i.test(b.brand));
    const named = real.find((b) => BRAND_NAMES.some(([re]) => re.test(b.brand))) ?? real[0];
    if (named) {
      const name = BRAND_NAMES.find(([re]) => re.test(named.brand))?.[1] ?? named.brand;
      browser = name;
      version = named.version;
    } else {
      const chromium = hints.brands.find((b) => /Chromium/i.test(b.brand));
      if (chromium && browser === 'Unknown browser') {
        browser = 'Chromium';
        version = chromium.version;
      }
    }
  }
  if (extra.brave && (browser === 'Chrome' || browser === 'Chromium')) browser = 'Brave';
  // A WebView inside an app (Instagram, Facebook, TikTok...) behaves differently from the real browser.
  const inApp = ua.match(/\b(Instagram|FBAN|FBAV|TikTok|musical_ly|Line|Snapchat|LinkedInApp|Twitter)\b/);
  if (inApp) {
    const app = ({ FBAN: 'Facebook', FBAV: 'Facebook', musical_ly: 'TikTok', LinkedInApp: 'LinkedIn', Twitter: 'X' } as Record<string, string>)[inApp[1]] ?? inApp[1];
    browser = `${app} in-app browser`;
  }

  const engine = /Gecko\/\d/.test(ua) && /Firefox/.test(ua)
    ? 'Gecko'
    : /(iPhone|iPad|iPod)/.test(ua) || (/Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR/.test(ua))
      ? 'WebKit'
      : /Chrome|Chromium/.test(ua)
        ? 'Blink'
        : /AppleWebKit/.test(ua)
          ? 'WebKit'
          : 'Unknown';

  let os = 'Unknown';
  let osVersion = '';
  const touch = extra.touchPoints ?? 0;
  if (/iPhone|iPod/.test(ua)) {
    os = 'iOS';
    osVersion = (ua.match(/OS (\d+[_\d]*)/)?.[1] ?? '').replace(/_/g, '.');
  } else if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch > 1)) {
    // iPads ask for desktop sites by default, so they say "Macintosh". Touch gives them away.
    os = 'iPadOS';
    osVersion = (ua.match(/OS (\d+[_\d]*)/)?.[1] ?? ua.match(/Version\/([\d.]+)/)?.[1] ?? '').replace(/_/g, '.');
  } else if (/Android/.test(ua)) {
    os = 'Android';
    osVersion = ua.match(/Android ([\d.]+)/)?.[1] ?? '';
  } else if (/CrOS/.test(ua)) {
    os = 'ChromeOS';
  } else if (/Windows/.test(ua)) {
    os = 'Windows';
    // Windows 11 still says "Windows NT 10.0"; only client hints tell them apart.
    if (/Windows NT 10/.test(ua)) osVersion = '10 or 11';
    else if (/Windows NT 6\.3/.test(ua)) osVersion = '8.1';
    else if (/Windows NT 6\.1/.test(ua)) osVersion = '7';
  } else if (/Macintosh|Mac OS X/.test(ua)) {
    os = 'macOS';
    // Browsers froze this at 10.15.7, so it is only trusted when it is older than that.
    const v = (ua.match(/Mac OS X (\d+[_.\d]*)/)?.[1] ?? '').replace(/_/g, '.');
    if (v && v !== '10.15.7') osVersion = v;
  } else if (/Linux/.test(ua)) {
    os = 'Linux';
  }

  if (hints.platform) {
    const p = hints.platform;
    const pv = hints.platformVersion ?? '';
    if (p === 'Windows') {
      os = 'Windows';
      const major = Number(pv.split('.')[0]);
      if (pv) osVersion = major >= 13 ? '11' : major > 0 ? '10' : osVersion;
    } else if (p === 'macOS') {
      os = 'macOS';
      if (pv) osVersion = pv.replace(/(\.0)+$/, '');
    } else if (p === 'Android') {
      os = 'Android';
      if (pv) osVersion = pv.replace(/(\.0)+$/, '');
    } else if (p === 'Chrome OS' || p === 'ChromeOS') {
      os = 'ChromeOS';
      if (pv) osVersion = pv;
    } else if (p === 'Linux') {
      os = 'Linux';
    }
  }

  let device: Parsed['device'] = 'Desktop';
  if (os === 'iPadOS' || /Tablet|SM-T\d|Kindle|Silk/.test(ua) || (os === 'Android' && !/Mobile/.test(ua) && hints.mobile !== true)) device = 'Tablet';
  else if (hints.mobile || /Mobi|iPhone|iPod/.test(ua)) device = 'Phone';

  let model = hints.model ?? '';
  if (!model && os === 'Android') {
    const m = ua.match(/Android [\d.]+; ([^;)]+?)(?: Build|\))/);
    if (m && m[1] !== 'K') model = m[1].trim();
  }
  if (!model && os === 'iOS') model = 'iPhone';
  if (!model && os === 'iPadOS') model = 'iPad';

  return { browser, version, engine, os, osVersion, device, model };
}

// "131.0.6778.86" -> "131", for the headline; the full one goes in the report.
export function major(version: string): string {
  return version.split('.')[0] ?? '';
}

// Tailwind's default breakpoints, so a vibecoder can say "it breaks at md".
export function tailwindBreakpoint(width: number): string {
  if (width >= 1536) return '2xl';
  if (width >= 1280) return 'xl';
  if (width >= 1024) return 'lg';
  if (width >= 768) return 'md';
  if (width >= 640) return 'sm';
  return 'base (under sm)';
}

// "+05:30" style offset for a time zone at a given moment.
export function utcOffset(minutesEast: number): string {
  const sign = minutesEast >= 0 ? '+' : '-';
  const m = Math.abs(minutesEast);
  return `UTC${sign}${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// Two-letter country code to its flag emoji ("IN" -> 🇮🇳). Cloudflare's special codes get none.
export function flag(code: string): string {
  if (!/^[A-Z]{2}$/.test(code) || code === 'XX' || code === 'T1') return '';
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export type Row = { label: string; value: string };

// The block that gets pasted into a bug report.
export function markdown(rows: Row[], when: string): string {
  return ['**Browser and device**', '', ...rows.map((r) => `- **${r.label}:** ${r.value}`), '', `_Checked ${when} with https://darnly.dev/tools/browser-info/_`].join('\n');
}

export function plain(rows: Row[], when: string): string {
  return ['Browser and device', ...rows.map((r) => `${r.label}: ${r.value}`), `Checked ${when} with https://darnly.dev/tools/browser-info/`].join('\n');
}
