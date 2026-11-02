// Builds the icon finder's search index: one small JSON file per icon set and style in public/icons/.
// The packages are not site dependencies (they are big), so install them somewhere else and point at them:
//   mkdir /tmp/ic && cd /tmp/ic && npm i lucide-static @tabler/icons heroicons @phosphor-icons/core
//   node site/bin/build-icon-index.mjs /tmp/ic/node_modules
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const nm = process.argv[2];
if (!nm) throw new Error('Pass the node_modules folder that has the icon packages.');
const out = join(dirname(fileURLToPath(import.meta.url)), '../public/icons');
mkdirSync(out, { recursive: true });

const version = (p) => JSON.parse(readFileSync(join(nm, p, 'package.json'), 'utf8')).version;
// Keeps only what's inside <svg>, minus comments and Tabler's invisible 24x24 box.
const body = (svg) =>
  svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/<path stroke="none" d="M0 0h24v24H0z" fill="none"\s*\/>/g, '')
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><')
    .replace(/\s*\/>/g, '/>')
    .trim();
const tagStr = (tags) => [...new Set((tags || []).map((t) => String(t).toLowerCase()).filter((t) => !t.startsWith('*')))].join(' ');

function write(file, meta, icons) {
  icons.sort((a, b) => a[0].localeCompare(b[0]));
  const json = JSON.stringify({ ...meta, icons });
  writeFileSync(join(out, file), json);
  console.log(file, icons.length, 'icons', (json.length / 1024).toFixed(0) + ' KB');
}

// Lucide
{
  const tags = JSON.parse(readFileSync(join(nm, 'lucide-static/tags.json'), 'utf8'));
  const icons = Object.keys(tags).map((n) => [n, tagStr(tags[n]), body(readFileSync(join(nm, 'lucide-static/icons', n + '.svg'), 'utf8'))]);
  write('lucide-outline.json', { set: 'lucide', style: 'outline', version: version('lucide-static'), viewBox: '0 0 24 24', stroke: 2 }, icons);
}

// Tabler
{
  const meta = JSON.parse(readFileSync(join(nm, '@tabler/icons/icons.json'), 'utf8'));
  for (const [style, dir, stroke] of [['outline', 'outline', 2], ['filled', 'filled', 0]]) {
    const icons = readdirSync(join(nm, '@tabler/icons/icons', dir))
      .filter((f) => f.endsWith('.svg'))
      .map((f) => {
        const n = f.slice(0, -4);
        const m = meta[n] || {};
        return [n, tagStr([...(m.tags || []), m.category]), body(readFileSync(join(nm, '@tabler/icons/icons', dir, f), 'utf8'))];
      });
    write(`tabler-${style}.json`, { set: 'tabler', style, version: version('@tabler/icons'), viewBox: '0 0 24 24', stroke }, icons);
  }
}

// Heroicons (24px)
for (const [style, dir, stroke] of [['outline', 'outline', 1.5], ['filled', 'solid', 0]]) {
  const base = join(nm, 'heroicons/24', dir);
  const icons = readdirSync(base)
    .filter((f) => f.endsWith('.svg'))
    .map((f) => [f.slice(0, -4), '', body(readFileSync(join(base, f), 'utf8'))]);
  write(`heroicons-${style}.json`, { set: 'heroicons', style, version: version('heroicons'), viewBox: '0 0 24 24', stroke }, icons);
}

// Phosphor
{
  const { icons: list } = await import(pathToFileURL(join(nm, '@phosphor-icons/core/dist/index.mjs')).href);
  for (const [style, suffix] of [['outline', ''], ['filled', '-fill']]) {
    const dir = style === 'outline' ? 'regular' : 'fill';
    const icons = list.map((i) => [i.name, tagStr([...i.tags, ...i.categories]), body(readFileSync(join(nm, '@phosphor-icons/core/assets', dir, i.name + suffix + '.svg'), 'utf8'))]);
    write(`phosphor-${style}.json`, { set: 'phosphor', style, version: version('@phosphor-icons/core'), viewBox: '0 0 256 256', stroke: 0 }, icons);
  }
}
