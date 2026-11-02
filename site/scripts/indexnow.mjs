// Tells IndexNow search engines (Bing, Yandex, Seznam, Naver...) about every page in the sitemap.
// Runs from .github/workflows/indexnow.yml after each site change on main, or by hand: `npm run indexnow` in site/.
// Never part of the build, so it can't break a deploy.
//
// Reads dist/sitemap-*.xml if a build is there, otherwise the live https://darnly.dev/sitemap-index.xml.
// `npm run indexnow -- --dry-run` prints the URLs without sending them.
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = 'darnly.dev';
const KEY = '81482878266902640d1cb34de558b363'; // must match public/<KEY>.txt
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const dryRun = process.argv.includes('--dry-run');

const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);

async function fromDist() {
  const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  let files;
  try {
    files = readdirSync(dist).filter((f) => /^sitemap-\d+\.xml$/.test(f));
  } catch {
    return [];
  }
  return files.flatMap((f) => locs(readFileSync(join(dist, f), 'utf8')));
}

async function fromLive() {
  const get = async (u) => {
    const res = await fetch(u);
    if (!res.ok) throw new Error(`${u}: HTTP ${res.status}`);
    return res.text();
  };
  const index = locs(await get(`https://${HOST}/sitemap-index.xml`));
  const pages = [];
  for (const sitemap of index) pages.push(...locs(await get(sitemap)));
  return pages;
}

let urls = await fromDist();
const source = urls.length ? 'dist/' : `https://${HOST}/sitemap-index.xml`;
if (!urls.length) urls = await fromLive();
urls = [...new Set(urls)].filter((u) => new URL(u).host === HOST);
if (!urls.length) {
  console.error('No URLs found in the sitemap.');
  process.exit(1);
}
console.log(`${urls.length} URLs from ${source}`);

if (dryRun) {
  console.log(urls.join('\n'));
  process.exit(0);
}

// IndexNow takes up to 10,000 URLs per request.
for (let i = 0; i < urls.length; i += 10000) {
  const urlList = urls.slice(i, i + 10000);
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList }),
  });
  // 200 and 202 both mean accepted; 202 means the key is still being checked.
  console.log(`IndexNow: HTTP ${res.status} for ${urlList.length} URLs`);
  if (!res.ok) {
    console.error(await res.text());
    process.exit(1);
  }
}
